#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dashboard_api.app.main import get_conn


DDL_INDEXES = [
    """
    CREATE INDEX IF NOT EXISTS idx_pe_part_session_date
      ON public.pitch_events_part (session_date)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pe_part_session_date_brin
      ON public.pitch_events_part
      USING BRIN (session_date)
      WITH (pages_per_range = 64)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pe_part_school_date_created_id
      ON public.pitch_events_part (school_code, session_date, created_at, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pe_part_school_date_session_type_norm
      ON public.pitch_events_part
      (school_code, session_date, (regexp_replace(lower(COALESCE(NULLIF(TRIM(COALESCE(session_type, sessiontype)), ''), '')), '\\s+', '', 'g')))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pe_part_school_date_team_codes
      ON public.pitch_events_part (school_code, session_date, pitcherteam, batterteam)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pe_part_school_date_pitcher_norm
      ON public.pitch_events_part
      (school_code, session_date, (regexp_replace(lower(COALESCE(NULLIF(TRIM(pitcher), ''), '')), '[^a-z0-9]', '', 'g')))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pe_part_school_date_batter_norm
      ON public.pitch_events_part
      (school_code, session_date, (regexp_replace(lower(COALESCE(NULLIF(TRIM(batter), ''), '')), '[^a-z0-9]', '', 'g')))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pe_part_school_date_catcher_norm
      ON public.pitch_events_part
      (school_code, session_date, (regexp_replace(lower(COALESCE(NULLIF(TRIM(catcher), ''), '')), '[^a-z0-9]', '', 'g')))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pe_part_school_date_pitch_type_norm
      ON public.pitch_events_part
      (school_code, session_date, (
        CASE
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Four-Seam' THEN 'Fastball'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Two-Seam' THEN 'Sinker'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Changeup' THEN 'ChangeUp'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Knuckleball' THEN 'Knuckleball'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Splitter' THEN 'Splitter'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Knuckle-Curve' THEN 'Curveball'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Slider' THEN 'Slider'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Curveball' THEN 'Curveball'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Sweeper' THEN 'Sweeper'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Sinker' THEN 'Sinker'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Cutter' THEN 'Cutter'
          WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), '') = 'Fastball' THEN 'Fastball'
          ELSE 'Undefined'
        END
      ))
    """,
]


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def main() -> int:
    _require_env("DASHBOARD_DATABASE_URL")
    backup_suffix = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    backup_name = f"pitch_events_unpartitioned_backup_{backup_suffix}"

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SET lock_timeout = '30s'")
            cur.execute("SET statement_timeout = '0'")
            got_lock = False
            for _ in range(180):
                cur.execute("SELECT pg_try_advisory_lock(hashtext('pitch_events_partition_migration')) AS locked")
                row = cur.fetchone() or {}
                if bool(row.get("locked")):
                    got_lock = True
                    break
                time.sleep(1.0)
            if not got_lock:
                raise RuntimeError("Could not acquire pitch_events partition migration lock (still busy).")

            cur.execute(
                """
                SELECT c.relkind, pt.partstrat
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                LEFT JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
                WHERE n.nspname = 'public' AND c.relname = 'pitch_events'
                """
            )
            current = cur.fetchone()
            if not current:
                raise RuntimeError("public.pitch_events not found")
            if current["partstrat"] is not None:
                print("public.pitch_events is already partitioned; nothing to do.")
                cur.execute("SELECT pg_advisory_unlock(hashtext('pitch_events_partition_migration'))")
                conn.commit()
                return 0

            cur.execute(
                "SELECT to_regclass('public.pitch_events_part')::text AS t, to_regclass('public.%s')::text AS b"
                % backup_name
            )
            names = cur.fetchone() or {}
            if names.get("t"):
                raise RuntimeError("public.pitch_events_part already exists; clean it up before rerunning")
            if names.get("b"):
                raise RuntimeError(f"backup table name collision: {backup_name}")

            print("Locking source table...")
            cur.execute("LOCK TABLE public.pitch_events IN ACCESS EXCLUSIVE MODE")

            cur.execute(
                """
                SELECT
                  MIN(EXTRACT(YEAR FROM session_date))::int AS min_year,
                  MAX(EXTRACT(YEAR FROM session_date))::int AS max_year
                FROM public.pitch_events
                WHERE session_date IS NOT NULL
                """
            )
            bounds = cur.fetchone() or {}
            min_year = int(bounds.get("min_year") or datetime.utcnow().year)
            max_year = int(bounds.get("max_year") or min_year)

            print(f"Creating partitioned table for years {min_year}..{max_year + 1}")
            cur.execute(
                """
                CREATE TABLE public.pitch_events_part
                (LIKE public.pitch_events INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING STORAGE INCLUDING COMMENTS)
                PARTITION BY RANGE (session_date)
                """
            )

            for year in range(min_year, max_year + 2):
                cur.execute(
                    f"""
                    CREATE TABLE public.pitch_events_part_{year}
                    PARTITION OF public.pitch_events_part
                    FOR VALUES FROM ('{year}-01-01') TO ('{year + 1}-01-01')
                    """
                )
            cur.execute(
                """
                CREATE TABLE public.pitch_events_part_default
                PARTITION OF public.pitch_events_part DEFAULT
                """
            )

            for stmt in DDL_INDEXES:
                cur.execute(stmt)

            print("Copying rows into partitioned table...")
            cur.execute(
                """
                INSERT INTO public.pitch_events_part
                SELECT * FROM public.pitch_events
                """
            )

            cur.execute(
                """
                SELECT setval(
                  pg_get_serial_sequence('public.pitch_events_part', 'id'),
                  COALESCE((SELECT MAX(id) FROM public.pitch_events_part), 1),
                  true
                )
                """
            )

            print(f"Swapping tables (backup: public.{backup_name})...")
            cur.execute(f"ALTER TABLE public.pitch_events RENAME TO {backup_name}")
            cur.execute("ALTER TABLE public.pitch_events_part RENAME TO pitch_events")
            cur.execute("ALTER SEQUENCE IF EXISTS public.pitch_events_id_seq OWNED BY public.pitch_events.id")

            cur.execute("SELECT pg_advisory_unlock(hashtext('pitch_events_partition_migration'))")

        conn.commit()

    print("Done.")
    print(f"Backup table kept as public.{backup_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
