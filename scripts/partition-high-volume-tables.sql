-- Monthly partitioning for high-volume append-only tables.
--
-- Run this once per environment when audit_logs or attendance pass ~1M rows.
-- It converts the existing table into a partitioned parent and creates
-- monthly partitions. Existing rows are moved into the right partition.
--
-- IMPORTANT: run during a maintenance window. It rewrites the table.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/partition-high-volume-tables.sql

BEGIN;

-- ── audit_logs ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_partitioned_table
       WHERE partrelid = 'public.audit_logs'::regclass
     ) THEN
    -- Rename the old table, create a partitioned parent, copy, then swap.
    ALTER TABLE public.audit_logs RENAME TO audit_logs_old;

    CREATE TABLE public.audit_logs (
      LIKE public.audit_logs_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS
    ) PARTITION BY RANGE (created_at);

    -- Create partitions for the last 12 months and the next 3.
    FOR i IN -12..3 LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.audit_logs_%s PARTITION OF public.audit_logs FOR VALUES FROM (%L) TO (%L)',
        to_char(date_trunc('month', now()) + (i || ' month')::interval, 'YYYY_MM'),
        date_trunc('month', now()) + (i || ' month')::interval,
        date_trunc('month', now()) + ((i + 1) || ' month')::interval
      );
    END LOOP;

    INSERT INTO public.audit_logs SELECT * FROM public.audit_logs_old;
    DROP TABLE public.audit_logs_old;
    RAISE NOTICE 'audit_logs partitioned';
  ELSE
    RAISE NOTICE 'audit_logs already partitioned or missing';
  END IF;
END $$;

-- ── attendance ───────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.attendance') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_partitioned_table
       WHERE partrelid = 'public.attendance'::regclass
     ) THEN
    ALTER TABLE public.attendance RENAME TO attendance_old;

    CREATE TABLE public.attendance (
      LIKE public.attendance_old INCLUDING DEFAULTS INCLUDING CONSTRAINTS
    ) PARTITION BY RANGE (date);

    FOR i IN -12..3 LOOP
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.attendance_%s PARTITION OF public.attendance FOR VALUES FROM (%L) TO (%L)',
        to_char(date_trunc('month', now()) + (i || ' month')::interval, 'YYYY_MM'),
        date_trunc('month', now()) + (i || ' month')::interval,
        date_trunc('month', now()) + ((i + 1) || ' month')::interval
      );
    END LOOP;

    INSERT INTO public.attendance SELECT * FROM public.attendance_old;
    DROP TABLE public.attendance_old;
    RAISE NOTICE 'attendance partitioned';
  ELSE
    RAISE NOTICE 'attendance already partitioned or missing';
  END IF;
END $$;

COMMIT;
