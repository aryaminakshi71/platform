-- Central company + subscription registry
-- Aggregates tenants from SchoolAI, SpectrumAI, DiagnoAI and NucleoAI.

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app text NOT NULL,                 -- schoolai | spectrumai | diagnoai | nucleoai
  org_id text NOT NULL,              -- the app's own organization id
  name text NOT NULL,
  slug text,
  plan text,
  subscription_status text,
  contact_email text,
  contact_phone text,
  city text,
  stripe_customer_id text,
  stripe_subscription_id text,
  app_created_at timestamptz,
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (app, org_id)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  plan text,
  status text,
  amount numeric(12, 2),
  currency text NOT NULL DEFAULT 'INR',
  interval text,
  started_at timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  stripe_subscription_id text,
  synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_app ON companies (app);
CREATE INDEX IF NOT EXISTS idx_companies_plan ON companies (plan);
CREATE INDEX IF NOT EXISTS idx_subscriptions_company ON subscriptions (company_id);
