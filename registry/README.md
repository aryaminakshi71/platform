# Platform Registry

One place to see **every company (tenant) and subscription** across the four apps.

## What it does

- `schema.sql` — creates `companies` and `subscriptions` in the `platform_registry` database.
- `sync.py` — reads each app's own database and upserts tenants + subscriptions:
  - **SchoolAI** → `organizations` (plan, subscription_status, stripe ids)
  - **SpectrumAI** → `organization` (plan from metadata)
  - **DiagnoAI** → `organizations` + `billing_subscriptions`
  - **NucleoAI** → `organizations` (plan, subscription_status, stripe ids)
- Writes `admin-dashboard/companies.html` — a self-contained table of all companies.

## Run

```bash
# one-time
psql -d postgres -c "CREATE DATABASE platform_registry;"
psql -d platform_registry -f platform/registry/schema.sql

# every sync
python3 platform/registry/sync.py
```

Open `admin-dashboard/companies.html` (or the "Companies & Subscriptions" button
on the portfolio dashboard).

## Schedule it

Add to crontab so the registry stays current:

```cron
*/30 * * * * cd /Users/aryaminakshi/Developer && python3 platform/registry/sync.py >> /tmp/registry-sync.log 2>&1
```

## Schema

`companies` — one row per tenant per app (`app`, `org_id` unique together):
name, slug, plan, subscription_status, contact email/phone, city, Stripe ids.

`subscriptions` — plan, status, period dates, cancel flag, linked to a company.

## Notes

- The sync is **read-only** against the apps; it never writes to their databases.
- Subscription data lives in different places per app (org columns vs a billing
  table), so the sync normalises both into `companies.plan` + `subscriptions`.
- For real-time capture, add a webhook from each app's billing handler to POST
  into a small registry API; the batch sync is the low-effort version.


## Live API + dashboard

```bash
bun platform/registry/server.ts        # http://localhost:4100
python3 -m http.server 4101 -d admin-dashboard   # open http://127.0.0.1:4101/live.html
```

Endpoints:

| Endpoint | Purpose |
|---|---|
| `GET /health` | registry health |
| `GET /api/registry/stats` | companies, real MRR, demo MRR, per-app |
| `GET /api/registry/companies?demo=one` | one demo per app + all real |
| `GET /api/registry/status` | pings each app's health URL |
| `POST /api/registry/company` | real-time tenant upsert (webhook) |
| `POST /api/registry/subscription` | real-time subscription upsert |

`admin-dashboard/live.html` shows real MRR, demo MRR, per-app health dots and
the company table, refreshing every 30s.

## Demo vs real

- **Real** = the tenant has a Stripe customer id (or was posted by the webhook
  with `isDemo: false`).
- **Demo** = everything else. The dashboard shows **one demo per app** by default
  so the demo stays clean; real companies always show.

## Real-time webhook

`platform/packages/registry/src/index.ts` exports `notifyRegistryCompany` and
`notifyRegistrySubscription`. DiagnoAI already calls the company webhook when it
auto-creates an org. To wire the other apps, call the same helper from their
signup / billing handlers (or POST to `/api/registry/company` directly).

The batch sync remains the fallback and runs every 30 minutes.


## Per-company data

Click any company name in `live.html` to see its live data from that app's own
database:

| App | Shown |
|---|---|
| SchoolAI | students, teachers, classes, fee payments, attendance |
| SpectrumAI | patients, goals, sessions, assessments |
| DiagnoAI | patients, orders, samples, results, reports, invoices |
| NucleoAI | contacts, leads, deals, tickets, invoices, projects |

Endpoint: `GET /api/registry/company/:app/:orgId/data`.

Note: SchoolAI's data tables are not org-scoped, so its counts are whole-database.

## Webhook status

| App | Real-time org webhook |
|---|---|
| DiagnoAI | wired (org auto-create) |
| SpectrumAI | wired (`organizationCreation.afterCreate`) |
| NucleoAI | wired (`organizationCreation.afterCreate`) |
| SchoolAI | wired (`organization` plugin `afterCreate`) |

All four also fall back to the 30-minute batch sync.
