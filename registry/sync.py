"""Sync tenants + subscriptions from all four apps into the central registry.

Reads each app's DATABASE_URL, pulls organizations (and billing_subscriptions
where present), upserts into the `platform_registry` database, and writes a
self-contained `admin-dashboard/companies.html`.

Run: python3 platform/registry/sync.py
"""

import html
import json
import os
import subprocess
from datetime import datetime

ROOT = "/Users/aryaminakshi/Developer"
REGISTRY_DB = "platform_registry"

PLAN_PRICES = {
    "schoolai": {"starter": 999, "growth": 2999, "pro": 5999, "enterprise": 0},
    "spectrumai": {"solo": 999, "clinic": 1499, "growth": 1999, "enterprise": 0},
    "diagnoai": {"starter": 2999, "growth": 6999, "pro": 14999, "enterprise": 0},
    "nucleoai": {"starter": 499, "growth": 999, "pro": 1499, "enterprise": 0},
}

DEMO_PATTERNS = (
    "demo", "test", "sample", "flow demo", "lis demo", "inv demo", "ord demo",
    "res demo", "qc demo", "dash tester", "net demo", "browse", "human lab",
    "login test", "spectrum tester", "autism tester", "school tester", "acme",
)

APPS = [
    {
        "key": "schoolai",
        "name": "SchoolAI",
        "dir": f"{ROOT}/school-mis",
        "org_table": "organizations",
    },
    {
        "key": "spectrumai",
        "name": "SpectrumAI",
        "dir": f"{ROOT}/autism",
        "org_table": "organization",
    },
    {
        "key": "diagnoai",
        "name": "DiagnoAI",
        "dir": f"{ROOT}/LabRegisters/saas-starter",
        "org_table": "organizations",
    },
    {
        "key": "nucleoai",
        "name": "NucleoAI",
        "dir": f"{ROOT}/complete apps/Nucleo-one",
        "org_table": "organizations",
    },
]


def db_url(app_dir: str) -> str:
    with open(os.path.join(app_dir, ".env")) as f:
        for line in f:
            if line.startswith("DATABASE_URL"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise RuntimeError(f"No DATABASE_URL in {app_dir}/.env")


def psql(url: str, sql: str):
    out = subprocess.run(
        ["psql", url, "-t", "-A", "-F", "\x1f", "-c", sql],
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        return []
    rows = []
    for line in out.stdout.splitlines():
        if line.strip():
            rows.append(line.split("\x1f"))
    return rows


def columns(url: str, table: str):
    rows = psql(
        url,
        "select column_name from information_schema.columns "
        f"where table_schema='public' and table_name='{table}' order by ordinal_position",
    )
    return [r[0] for r in rows]


def esc(v: str) -> str:
    return (v or "").replace("'", "''")


def seed_schoolai():
    """Insert one sample school if SchoolAI has no organizations."""
    app = [a for a in APPS if a["key"] == "schoolai"][0]
    url = db_url(app["dir"])
    rows = psql(url, "select count(*) from organizations")
    if rows and rows[0][0] not in ("0", ""):
        return
    psql(
        url,
        "INSERT INTO organizations (id, name, slug, plan, subscription_status, email, city, created_at, updated_at) "
        "VALUES (gen_random_uuid(), 'Green Valley Public School', 'green-valley', 'growth', 'active', "
        "'admin@greenvalley.edu', 'Gurgaon', now(), now())",
    )
    print("  schoolai: seeded sample org")


def sync_app(app):
    url = db_url(app["dir"])
    cols = columns(url, app["org_table"])
    if not cols:
        print(f"  {app['key']}: no {app['org_table']} table")
        return []

    def pick(*names):
        for n in names:
            if n in cols:
                return n
        return None

    id_c = pick("id")
    name_c = pick("name")
    slug_c = pick("slug")
    plan_c = pick("plan")
    status_c = pick("subscription_status", "status")
    email_c = pick("email", "contact_email")
    phone_c = pick("phone", "contact_phone")
    city_c = pick("city")
    cust_c = pick("stripe_customer_id")
    sub_c = pick("stripe_subscription_id")
    created_c = pick("created_at")

    def col_expr(c):
        return f"coalesce({c}::text,'')" if c else "''"

    select = ", ".join(
        col_expr(c)
        for c in [id_c, name_c, slug_c, plan_c, status_c, email_c, phone_c, city_c, cust_c, sub_c, created_c]
    )
    rows = psql(url, f"select {select} from {app['org_table']}")

    companies = []
    for r in rows:
        r = (r + [""] * 11)[:11]
        companies.append(
            {
                "app": app["key"],
                "app_name": app["name"],
                "org_id": r[0],
                "name": r[1] or r[2] or r[0],
                "slug": r[2],
                "plan": r[3] or "free",
                "status": r[4] or "active",
                "email": r[5],
                "phone": r[6],
                "city": r[7],
                "stripe_customer_id": r[8],
                "stripe_subscription_id": r[9],
                "created_at": r[10],
            }
        )

    # DiagnoAI has a separate billing_subscriptions table
    subs = []
    if columns(url, "billing_subscriptions"):
        sub_rows = psql(
            url,
            "select organization_id, plan, status, current_period_start, "
            "current_period_end, cancel_at_period_end from billing_subscriptions",
        )
        for s in sub_rows:
            s = (s + [""] * 6)[:6]
            subs.append(
                {
                    "org_id": s[0],
                    "plan": s[1],
                    "status": s[2],
                    "started_at": s[3],
                    "current_period_end": s[4],
                    "cancel_at_period_end": s[5] in ("t", "true"),
                }
            )

    prices = PLAN_PRICES.get(app["key"], {})
    for c in companies:
        # Real = has a Stripe customer (a paying tenant). Everything else is demo.
        c["is_demo"] = not bool(c.get("stripe_customer_id"))
        c["mrr"] = prices.get((c["plan"] or "").lower(), 0)
    for s in subs:
        s["mrr"] = prices.get((s["plan"] or "").lower(), 0)

    print(f"  {app['key']}: {len(companies)} companies, {len(subs)} subscriptions")
    return companies, subs


def upsert(companies, subs):
    lines = ["BEGIN;"]
    for c in companies:
        lines.append(
            "INSERT INTO companies (app, org_id, name, slug, plan, subscription_status, "
            "contact_email, contact_phone, city, stripe_customer_id, stripe_subscription_id, "
            "app_created_at, synced_at, is_demo, mrr, currency, source) VALUES ("
            f"'{esc(c['app'])}','{esc(c['org_id'])}','{esc(c['name'])}','{esc(c['slug'])}',"
            f"'{esc(c['plan'])}','{esc(c['status'])}','{esc(c['email'])}','{esc(c['phone'])}',"
            f"'{esc(c['city'])}','{esc(c['stripe_customer_id'])}','{esc(c['stripe_subscription_id'])}',"
            f"NULLIF('{esc(c['created_at'])}','')::timestamptz, now(), "
            f"{'true' if c.get('is_demo') else 'false'}, {c.get('mrr', 0)}, 'INR', 'sync') "
            "ON CONFLICT (app, org_id) DO UPDATE SET name=EXCLUDED.name, slug=EXCLUDED.slug, "
            "plan=EXCLUDED.plan, subscription_status=EXCLUDED.subscription_status, "
            "contact_email=CASE WHEN companies.source='webhook' AND companies.contact_email <> '' THEN companies.contact_email ELSE EXCLUDED.contact_email END, "
            "contact_phone=CASE WHEN companies.source='webhook' AND companies.contact_phone <> '' THEN companies.contact_phone ELSE EXCLUDED.contact_phone END, "
            "city=EXCLUDED.city, stripe_customer_id=EXCLUDED.stripe_customer_id, "
            "stripe_subscription_id=EXCLUDED.stripe_subscription_id, "
            "is_demo=CASE WHEN companies.source='webhook' THEN companies.is_demo ELSE EXCLUDED.is_demo END, "
            "mrr=CASE WHEN companies.source='webhook' THEN companies.mrr ELSE EXCLUDED.mrr END, "
            "synced_at=now();"
        )
    lines.append("DELETE FROM subscriptions;")
    for s in subs:
        lines.append(
            "INSERT INTO subscriptions (company_id, plan, status, started_at, current_period_end, "
            "cancel_at_period_end, synced_at, mrr) SELECT id, "
            f"'{esc(s['plan'])}','{esc(s['status'])}',"
            f"NULLIF('{esc(s['started_at'])}','')::timestamptz,"
            f"NULLIF('{esc(s['current_period_end'])}','')::timestamptz,"
            f"{'true' if s['cancel_at_period_end'] else 'false'}, now(), {s.get('mrr', 0)} "
            f"FROM companies WHERE app='diagnoai' AND org_id='{esc(s['org_id'])}';"
        )
    # Remove companies that no longer exist in their app DB (keep webhook rows
    # that may not have been synced yet).
    for app in APPS:
        org_ids = [c["org_id"] for c in companies if c["app"] == app["key"]]
        if org_ids:
            placeholders = ",".join(f"'{esc(o)}'" for o in org_ids)
            lines.append(
                f"DELETE FROM companies WHERE app='{esc(app['key'])}' "
                f"AND org_id NOT IN ({placeholders});"
            )
    lines.append("COMMIT;")
    sql = "\n".join(lines)
    out = subprocess.run(
        ["psql", "-d", REGISTRY_DB, "-v", "ON_ERROR_STOP=1"],
        input=sql,
        capture_output=True,
        text=True,
    )
    if out.returncode != 0:
        print(out.stderr[-800:])
    else:
        print("registry updated")


def render_html():
    out = subprocess.run(
        [
            "psql",
            "-d",
            REGISTRY_DB,
            "-t",
            "-A",
            "-F",
            "\x1f",
            "-c",
            "select app, name, plan, subscription_status, contact_email, contact_phone, city, org_id "
            "from companies order by app, name",
        ],
        capture_output=True,
        text=True,
    )
    rows = [l.split("\x1f") for l in out.stdout.splitlines() if l.strip()]
    total = len(rows)
    by_app = {}
    for r in rows:
        by_app[r[0]] = by_app.get(r[0], 0) + 1

    trs = []
    for r in rows:
        r = (r + [""] * 8)[:8]
        trs.append(
            "<tr>"
            f"<td>{html.escape(r[0])}</td>"
            f"<td>{html.escape(r[1])}</td>"
            f"<td>{html.escape(r[2])}</td>"
            f"<td>{html.escape(r[3])}</td>"
            f"<td>{html.escape(r[4])}</td>"
            f"<td>{html.escape(r[5])}</td>"
            f"<td>{html.escape(r[6])}</td>"
            f"<td class='mono'>{html.escape(r[7])}</td>"
            "</tr>"
        )

    cards = "".join(
        f"<div class='card'><div class='label'>{html.escape(k)}</div><div class='value'>{v}</div></div>"
        for k, v in sorted(by_app.items())
    )

    page = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Companies & Subscriptions — Platform</title>
<style>
:root{{--bg:#0b1020;--card:#141a2e;--line:#232b45;--text:#e7ecf7;--muted:#8b95b2;--accent:#6366f1}}
*{{box-sizing:border-box}}body{{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text)}}
header{{padding:24px 32px;border-bottom:1px solid var(--line)}}h1{{font-size:20px;margin:0}}.sub{{color:var(--muted);font-size:13px;margin-top:4px}}
.grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;padding:20px 32px}}
.card{{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}}
.label{{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}}.value{{font-size:24px;font-weight:800;margin-top:4px}}
table{{width:calc(100% - 64px);margin:0 32px 32px;border-collapse:collapse;font-size:13px}}
th,td{{text-align:left;padding:10px 12px;border-bottom:1px solid var(--line)}}th{{color:var(--muted);font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.04em}}
tr:hover td{{background:#0f1526}}.mono{{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--muted)}}
</style></head><body>
<header><h1>Companies &amp; Subscriptions</h1><div class="sub">Synced {datetime.now().strftime('%Y-%m-%d %H:%M')} · {total} companies across 4 apps</div></header>
<div class="grid"><div class="card"><div class="label">Total companies</div><div class="value">{total}</div></div>{cards}</div>
<table><thead><tr><th>App</th><th>Company</th><th>Plan</th><th>Status</th><th>Email</th><th>Phone</th><th>City</th><th>Org ID</th></tr></thead>
<tbody>{''.join(trs) or '<tr><td colspan="8">No companies yet.</td></tr>'}</tbody></table>
</body></html>"""
    path = f"{ROOT}/admin-dashboard/companies.html"
    open(path, "w").write(page)
    print(f"wrote {path}")


if __name__ == "__main__":
    seed_schoolai()
    all_companies, all_subs = [], []
    for app in APPS:
        try:
            companies, subs = sync_app(app)
            all_companies += companies
            all_subs += subs
        except Exception as e:
            print(f"  {app['key']}: ERROR {e}")
    upsert(all_companies, all_subs)
    render_html()
