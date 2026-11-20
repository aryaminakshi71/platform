/**
 * Platform Registry API
 *
 * Live view of companies, subscriptions, earnings and app health.
 * Run: bun platform/registry/server.ts
 * Port: 4100 (override with REGISTRY_PORT)
 */

const PORT = Number(process.env.REGISTRY_PORT ?? 4100);
const DB = process.env.REGISTRY_DB ?? "platform_registry";

const HEALTH_URLS: Record<string, string> = {
  schoolai: process.env.SCHOOLAI_HEALTH ?? "http://127.0.0.1:3070/api/health",
  spectrumai: process.env.SPECTRUMAI_HEALTH ?? "http://127.0.0.1:3080/api/health",
  diagnoai: process.env.DIAGNOAI_HEALTH ?? "http://127.0.0.1:3101/api/rpc/health/check",
  nucleoai: process.env.NUCLEOAI_HEALTH ?? "http://127.0.0.1:3001/api/health",
};

function readEnvDb(dir: string): string {
  try {
    const text = require("node:fs").readFileSync(`${dir}/.env`, "utf8");
    const line = text.split("\n").find((l: string) => l.startsWith("DATABASE_URL"));
    return line ? line.split("=").slice(1).join("=").trim().replace(/^"|"$/g, "") : "";
  } catch {
    return "";
  }
}

const APP_DBS: Record<string, string> = {
  schoolai: readEnvDb("/Users/aryaminakshi/Developer/school-mis"),
  spectrumai: readEnvDb("/Users/aryaminakshi/Developer/autism"),
  diagnoai: readEnvDb("/Users/aryaminakshi/Developer/LabRegisters/saas-starter"),
  nucleoai: readEnvDb("/Users/aryaminakshi/Developer/complete apps/Nucleo-one"),
};

const APP_ENTITIES: Record<string, Array<{ label: string; sql: string }>> = {
  schoolai: [
    { label: "Students", sql: "select count(*) from students where organization_id='{org}'" },
    { label: "Teachers", sql: "select count(*) from teachers where organization_id='{org}'" },
    { label: "Classes", sql: "select count(*) from classes where organization_id='{org}'" },
    { label: "Fee payments", sql: "select count(*) from fee_payments where organization_id='{org}'" },
    { label: "Attendance", sql: "select count(*) from attendance where organization_id='{org}'" },
  ],
  spectrumai: [
    { label: "Patients", sql: "select count(*) from patients where organization_id='{org}'" },
    { label: "Goals", sql: "select count(*) from goals where organization_id='{org}'" },
    { label: "Sessions", sql: "select count(*) from sessions where organization_id='{org}'" },
    { label: "Assessments", sql: "select count(*) from assessments where organization_id='{org}'" },
  ],
  diagnoai: [
    { label: "Patients", sql: "select count(*) from patients where organization_id='{org}'" },
    { label: "Orders", sql: "select count(*) from orders where organization_id='{org}'" },
    { label: "Samples", sql: "select count(*) from samples where organization_id='{org}'" },
    { label: "Results", sql: "select count(*) from results r join samples s on s.id=r.sample_id where s.organization_id='{org}'" },
    { label: "Reports", sql: "select count(*) from reports where organization_id='{org}'" },
    { label: "Invoices", sql: "select count(*) from invoices where organization_id='{org}'" },
  ],
  nucleoai: [
    { label: "Contacts", sql: "select count(*) from contacts where organization_id='{org}'" },
    { label: "Leads", sql: "select count(*) from leads where organization_id='{org}'" },
    { label: "Deals", sql: "select count(*) from deals where organization_id='{org}'" },
    { label: "Tickets", sql: "select count(*) from tickets where organization_id='{org}'" },
    { label: "Invoices", sql: "select count(*) from invoices where organization_id='{org}'" },
    { label: "Projects", sql: "select count(*) from projects where organization_id='{org}'" },
  ],
};

function psqlDb(db: string, sql: string): any[] {
  const proc = Bun.spawnSync(["psql", db, "-t", "-A", "-F", "\x1f", "-c", sql], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) throw new Error(proc.stderr.toString() || "psql failed");
  return proc.stdout
    .toString()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.split("\x1f"));
}

function psql(sql: string): any[] {
  const proc = Bun.spawnSync(["psql", "-d", DB, "-t", "-A", "-F", "\x1f", "-c", sql], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(proc.stderr.toString() || "psql failed");
  }
  return proc.stdout
    .toString()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => l.split("\x1f"));
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type",
      "access-control-allow-methods": "GET,POST,OPTIONS",
    },
  });
}

function esc(v: unknown) {
  return String(v ?? "").replace(/'/g, "''");
}

async function checkHealth(app: string) {
  const url = HEALTH_URLS[app];
  if (!url) return { app, up: false, latencyMs: null, error: "no url" };
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return { app, up: res.ok, status: res.status, latencyMs: Date.now() - started };
  } catch (e) {
    return { app, up: false, latencyMs: Date.now() - started, error: String(e) };
  }
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "content-type",
          "access-control-allow-methods": "GET,POST,OPTIONS",
        },
      });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "platform-registry", time: new Date().toISOString() });
    }

    if (url.pathname === "/api/registry/stats") {
      const rows = psql(
        "select app, count(*)::int, coalesce(sum(mrr),0)::float, " +
          "count(*) filter (where is_demo)::int, count(*) filter (where not is_demo)::int, " +
          "coalesce(sum(mrr) filter (where not is_demo),0)::float, " +
          "coalesce(sum(mrr) filter (where is_demo),0)::float " +
          "from companies group by app order by app",
      );
      const byApp = rows.map((r) => ({
        app: r[0],
        companies: Number(r[1]),
        mrr: Number(r[2]),
        demo: Number(r[3]),
        real: Number(r[4]),
        realMrr: Number(r[5]),
        demoMrr: Number(r[6]),
      }));
      const totalCompanies = byApp.reduce((a, b) => a + b.companies, 0);
      const realCompanies = byApp.reduce((a, b) => a + b.real, 0);
      const realMrr = byApp.reduce((a, b) => a + b.realMrr, 0);
      const demoMrr = byApp.reduce((a, b) => a + b.demoMrr, 0);
      return json({
        totalCompanies,
        realCompanies,
        demoCompanies: totalCompanies - realCompanies,
        mrr: realMrr,
        arr: realMrr * 12,
        demoMrr,
        demoArr: demoMrr * 12,
        currency: "INR",
        byApp,
        updatedAt: new Date().toISOString(),
      });
    }

    if (url.pathname === "/api/registry/companies") {
      const mode = url.searchParams.get("demo") ?? "one";
      let where = "";
      if (mode === "none") where = "where not is_demo";
      const rows = psql(
        "select app, name, plan, subscription_status, contact_email, contact_phone, city, " +
          "org_id, is_demo, mrr, app_created_at from companies " +
          where +
          " order by is_demo asc, app, name",
      );
      let companies = rows.map((r) => ({
        app: r[0],
        name: r[1],
        plan: r[2],
        status: r[3],
        email: r[4],
        phone: r[5],
        city: r[6],
        orgId: r[7],
        isDemo: r[8] === "t",
        mrr: Number(r[9] ?? 0),
        createdAt: r[10],
      }));
      if (mode === "one") {
        const seen = new Set<string>();
        companies = companies.filter((c) => {
          if (!c.isDemo) return true;
          if (seen.has(c.app)) return false;
          seen.add(c.app);
          return true;
        });
      }
      return json({ companies, count: companies.length });
    }

    if (url.pathname === "/api/registry/status") {
      const apps = Object.keys(HEALTH_URLS);
      const results = await Promise.all(apps.map((a) => checkHealth(a)));
      return json({ apps: results, checkedAt: new Date().toISOString() });
    }

    if (url.pathname === "/api/registry/company" && req.method === "POST") {
      const b = (await req.json()) as any;
      if (!b.app || !b.orgId || !b.name) {
        return json({ error: "app, orgId and name are required" }, 400);
      }
      psql(
        "insert into companies (app, org_id, name, slug, plan, subscription_status, contact_email, " +
          "contact_phone, city, stripe_customer_id, stripe_subscription_id, is_demo, mrr, currency, source, synced_at) values (" +
          `'${esc(b.app)}','${esc(b.orgId)}','${esc(b.name)}','${esc(b.slug)}','${esc(b.plan ?? "free")}',` +
          `'${esc(b.status ?? "active")}','${esc(b.email)}','${esc(b.phone)}','${esc(b.city)}',` +
          `'${esc(b.stripeCustomerId)}','${esc(b.stripeSubscriptionId)}',${b.isDemo ? "true" : "false"},` +
          `${Number(b.mrr ?? 0)},'${esc(b.currency ?? "INR")}','webhook',now()) ` +
          "on conflict (app, org_id) do update set name=excluded.name, plan=excluded.plan, " +
          "subscription_status=excluded.subscription_status, contact_email=excluded.contact_email, " +
          "contact_phone=excluded.contact_phone, city=excluded.city, mrr=excluded.mrr, synced_at=now()",
      );
      return json({ ok: true });
    }

    if (url.pathname === "/api/registry/subscription" && req.method === "POST") {
      const b = (await req.json()) as any;
      if (!b.app || !b.orgId) return json({ error: "app and orgId are required" }, 400);
      const [company] = psql(
        `select id from companies where app='${esc(b.app)}' and org_id='${esc(b.orgId)}' limit 1`,
      );
      if (!company) return json({ error: "company not found" }, 404);
      psql(
        "insert into subscriptions (company_id, plan, status, amount, currency, interval, started_at, " +
          "current_period_end, cancel_at_period_end, stripe_subscription_id, mrr, synced_at) values (" +
          `'${esc(company[0])}','${esc(b.plan)}','${esc(b.status ?? "active")}',${Number(b.amount ?? 0)},` +
          `'${esc(b.currency ?? "INR")}','${esc(b.interval ?? "month")}',` +
          `${b.startedAt ? `'${esc(b.startedAt)}'::timestamptz` : "now()"},` +
          `${b.currentPeriodEnd ? `'${esc(b.currentPeriodEnd)}'::timestamptz` : "null"},` +
          `${b.cancelAtPeriodEnd ? "true" : "false"},'${esc(b.stripeSubscriptionId)}',` +
          `${Number(b.mrr ?? b.amount ?? 0)},now())`,
      );
      return json({ ok: true });
    }

    const dataMatch = url.pathname.match(
      /^\/api\/registry\/company\/([^/]+)\/([^/]+)\/data$/,
    );
    if (dataMatch) {
      const [, app, orgId] = dataMatch;
      const db = APP_DBS[app];
      if (!db) return json({ error: "unknown app" }, 404);
      const entities = APP_ENTITIES[app] ?? [];
      const safeOrg = orgId.replace(/'/g, "''");
      try {
        const union = entities
          .map(
            (e, i) =>
              `select ${i} as idx, (${e.sql.replace(/\{org\}/g, safeOrg)}) as n`,
          )
          .join(" union all ");
        const rows = psqlDb(db, union);
        const byIdx = new Map(rows.map((r) => [r[0], Number(r[1] ?? 0)]));
        const counts = entities.map((e, i) => ({
          label: e.label,
          count: byIdx.get(String(i)) ?? 0,
        }));
        return json({ app, orgId, entities: counts });
      } catch (err) {
        return json({ app, orgId, entities: [], error: String(err) }, 500);
      }
    }

    return json({ error: "not found" }, 404);
  },
});

console.log(`Platform registry API on http://localhost:${server.port}`);
