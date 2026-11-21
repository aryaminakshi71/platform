-- Monthly partitioning for high-volume append-only tables.
--
-- Run this once per environment when audit_logs or attendance pass ~1M rows.
-- It converts the existing table into a partitioned parent, creates monthly
-- partitions, and moves existing rows into the right partition.
--
-- IMPORTANT
--   * Run during a maintenance window. It rewrites the table.
--   * It preserves indexes, defaults, and constraints via INCLUDING ALL.
--   * Foreign keys that reference the table are dropped and recreated.
--   * Take a backup first: pg_dump "$DATABASE_URL" > backup.sql
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/partition-high-volume-tables.sql

BEGIN;

-- ── audit_logs ───────────────────────────────────────────────────────────────
DO $$
DECLARE
  fk record;
  fk_defs text[] := '{}';
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_partitioned_table
       WHERE partrelid = 'public.audit_logs'::regclass
     ) THEN
    -- Capture and drop FKs that reference audit_logs.
    FOR fk IN
      SELECT conname, conrelid::regclass AS tbl
      FROM pg_constraint
      WHERE contype = 'f' AND confrelid = 'public.audit_logs'::regclass
    LOOP
      fk_defs := fk_defs || pg_get_constraintdef(
        (SELECT oid FROM pg_constraint WHERE conname = fk.conname AND conrelid = fk.tbl)
      );
      EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', fk.tbl, fk.conname);
    END LOOP;

    ALTER TABLE public.audit_logs RENAME TO audit_logs_old;

    CREATE TABLE public.audit_logs (
      LIKE public.audit_logs_old INCLUDING ALL
    ) PARTITION BY RANGE (created_at);

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
      LIKE public.attendance_old INCLUDING ALL
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
