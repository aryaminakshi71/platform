# Performance Guide

What was changed to make the four apps fast, and what to do next as data grows.

## Applied now

### 1. Indexes on every foreign key, `organization_id`, and `created_at`

Every app was missing indexes on most foreign keys and on the multi-tenant
`organization_id` column. That turns joins and tenant-scoped list queries into
sequential scans as tables grow.

| App | Indexes added |
|---|---|
| SchoolAI | 120 |
| SpectrumAI | 82 |
| DiagnoAI | 77 |
| NucleoAI | 253 |

Re-run any time (idempotent):

```bash
DATABASE_URL=... bash platform/scripts/add-missing-indexes.sh --apply
```

### 2. Trigram indexes for `ILIKE '%search%'`

B-tree indexes cannot serve leading-wildcard searches. `pg_trgm` GIN indexes
make name/email/MRN search fast.

| App | Trigram indexes |
|---|---|
| SchoolAI | 6 |
| SpectrumAI | 9 |
| DiagnoAI | 6 |
| NucleoAI | 15 |

```bash
DATABASE_URL=... bash platform/scripts/add-trigram-indexes.sh --apply
```

### 3. Neon pooler-safe connection settings

Neon's PgBouncer pooler runs in transaction mode and does not support prepared
statements. SchoolAI and DiagnoAI now detect `-pooler.` in the URL and set
`prepare: false`, and cap the pool at 5 connections per instance.

### 4. Dashboard queries parallelised / collapsed

- **SchoolAI** `/api/dashboard/stats`: 6 sequential queries → `Promise.all`.
- **SpectrumAI** dashboard: 3 previous-period queries → `Promise.all`.
- **DiagnoAI** `/dashboard/metrics`: 5 sequential `count()` queries → 1 query
  with `COUNT(*) FILTER (WHERE …)`.
- **NucleoAI** dashboard: pipeline + revenue and contacts + deals → `Promise.all`.

### 5. Caching already in place

SchoolAI, SpectrumAI, and NucleoAI use Upstash Redis (`getOrCache`) for
dashboard and list endpoints with 1–5 minute TTLs. DiagnoAI has no cache yet.

## Also applied

### 6. DiagnoAI caching

`apps/api/src/lib/cache.ts` uses Upstash Redis when configured, otherwise a
bounded in-process TTL cache. Wired into dashboard metrics (2 min) and the test
catalog (5 min).

### 7. SQL-aggregated dashboards

SpectrumAI and NucleoAI dashboards no longer load every contact/deal into
memory. They use `COUNT(*) FILTER (WHERE …)` and `SUM(...) FILTER (...)` and a
single `GROUP BY stage` for the pipeline.

### 8. `updated_at` triggers

`set_updated_at()` + `BEFORE UPDATE` triggers on every table with an
`updated_at` column (45 / 37 / 36 / 111 across the four apps).

### 9. Read-replica support

`getReadDb()` in every app routes dashboard/analytics reads to
`DATABASE_READ_URL` when set, falling back to the primary. Dashboards already
use it.

### 10. Cursor pagination

`apps/api/src/lib/pagination.ts` provides `encodeCursor`/`decodeCursor`.
NucleoAI's `/leads` and `/audit` accept an optional `cursor` and return
`nextCursor`; offset pagination still works when no cursor is sent.

### 11. Operational scripts

Each app now has:

```bash
bun run db:optimize   # indexes + trigram + updated_at triggers
bun run db:health     # size, cache hit ratio, unused indexes, slow queries
```

## Read replica setup

1. In the Neon dashboard, create a read replica of the primary branch.
2. Copy its connection string into `DATABASE_READ_URL` in `.env`.
3. Restart the API. Dashboard/analytics reads now go to the replica.

## Partitioning

`platform/scripts/partition-high-volume-tables.sql` converts `audit_logs` and
`attendance` to monthly range partitions. Run it during a maintenance window
once those tables pass ~1M rows. It is guarded so it only runs once.

## Monitoring

- `bun run db:health` — size, cache hit ratio, connections, unused indexes,
  slow queries (when `pg_stat_statements` is available).
- **In-app query stats** — DiagnoAI exposes `GET /api/rpc/health/dbStats`
  with count, avg, p95, max, and the slowest recent queries. Set
  `SLOW_QUERY_MS` (default 500) to tune the slow-query threshold.
- Enable `pg_stat_statements` in the Neon dashboard for query-level stats.
- Watch Neon's connection count, CPU, and slow-query panels.

## Verifying

```bash
# missing FK indexes (should be 0)
psql "$DATABASE_URL" -c "
SELECT count(*) FROM pg_constraint c
JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
WHERE c.contype='f' AND c.connamespace='public'::regnamespace
AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid=c.conrelid AND a.attnum=ANY(i.indkey));"

# trigram indexes
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_indexes WHERE indexname LIKE 'idx_trgm_%';"

# updated_at triggers
psql "$DATABASE_URL" -c "SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_%_updated_at';"
```
