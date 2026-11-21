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

## Recommended next

### Short term

1. **Add Redis to DiagnoAI** — copy the `getOrCache` helper and cache the test
   catalog (140 rows, rarely changes) and dashboard metrics for 5 minutes.
2. **Replace `select().from(contacts)` in dashboards** with SQL aggregation
   (`COUNT`, `SUM`, `FILTER`) so large orgs don't load every row into memory.
   The 5-minute cache hides this today but not at scale.
3. **Add `updated_at` triggers** if you rely on `updated_at` for sync.

### Medium term

4. **Read replica for analytics** — point dashboard/report queries at a Neon
   read replica so they don't compete with writes.
5. **Cursor pagination** for large lists (leads, audit logs, attendance)
   instead of `OFFSET`, which gets slower as the offset grows.
6. **Partition `audit_logs` and `attendance` by month** once they pass a few
   million rows.
7. **Connection pooling via Hyperdrive** in production (Cloudflare) instead of
   direct Neon connections.

### Ongoing

8. **`pg_stat_statements`** — enable it and review the top 20 queries weekly.
9. **`EXPLAIN (ANALYZE, BUFFERS)`** on any endpoint that feels slow; look for
   `Seq Scan` on large tables.
10. **Monitor Neon metrics** — connection count, CPU, and slow queries in the
    Neon dashboard.

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
```
