#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dashboard_api.app.main import get_conn


DDL_INDEXES = [
    # Conflict target for sync upserts on partitioned table.
    """
    CREATE UNIQUE INDEX IF NOT EXISTS idx_pro_pep_uq_game_play_event_session_date
      ON public.pro_pitch_events_part (game_pk, play_id, event_index, session_date)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_session_date
      ON public.pro_pitch_events_part (session_date)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_session_date_brin
      ON public.pro_pitch_events_part
      USING BRIN (session_date)
      WITH (pages_per_range = 64)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_date_order
      ON public.pro_pitch_events_part (session_date, game_pk, at_bat_index, event_index, id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_date_sport
      ON public.pro_pitch_events_part (session_date, sport_id)
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_date_batterteam
      ON public.pro_pitch_events_part (session_date, (UPPER(COALESCE(NULLIF(TRIM(batterteam), ''), ''))))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_date_pitcherteam
      ON public.pro_pitch_events_part (session_date, (UPPER(COALESCE(NULLIF(TRIM(pitcherteam), ''), ''))))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_date_pitcherthrows
      ON public.pro_pitch_events_part (session_date, (COALESCE(NULLIF(TRIM(pitcherthrows), ''), '')))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_date_batterside
      ON public.pro_pitch_events_part (session_date, (COALESCE(NULLIF(TRIM(batterside), ''), '')))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_date_pitcher_norm
      ON public.pro_pitch_events_part
      (session_date, (lower(regexp_replace(COALESCE(NULLIF(TRIM(pitcher), ''), ''), '[^a-z0-9]', '', 'g'))))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_date_batter_norm
      ON public.pro_pitch_events_part
      (session_date, (lower(regexp_replace(COALESCE(NULLIF(TRIM(batter), ''), ''), '[^a-z0-9]', '', 'g'))))
    """,
    """
    CREATE INDEX IF NOT EXISTS idx_pro_pep_date_pitch_type_norm
      ON public.pro_pitch_events_part
      (session_date, (
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


def _with_system_sslrootcert(db_url: str) -> str:
    lower = db_url.lower()
    if "sslrootcert=" in lower:
        return db_url
    joiner = "&" if "?" in db_url else "?"
    return f"{db_url}{joiner}sslrootcert=system"


def main() -> int:
    _require_env("DASHBOARD_DATABASE_URL")
    backup_suffix = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    backup_name = f"pro_pitch_events_unpartitioned_backup_{backup_suffix}"

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SET lock_timeout = '30s'")
            cur.execute("SET statement_timeout = '0'")
            cur.execute("SELECT pg_advisory_lock(hashtext('pro_pitch_events_partition_migration'))")

            cur.execute(
                """
                SELECT c.relkind, pt.partstrat
                FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                LEFT JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
                WHERE n.nspname = 'public' AND c.relname = 'pro_pitch_events'
                """
            )
            current = cur.fetchone()
            if not current:
                raise RuntimeError("public.pro_pitch_events not found")
            if current["partstrat"] is not None:
                print("public.pro_pitch_events is already partitioned; nothing to do.")
                cur.execute("SELECT pg_advisory_unlock(hashtext('pro_pitch_events_partition_migration'))")
                conn.commit()
                return 0

            cur.execute(
                "SELECT to_regclass('public.pro_pitch_events_part')::text AS t, to_regclass('public.%s')::text AS b"
                % backup_name
            )
            names = cur.fetchone() or {}
            if names.get("t"):
                raise RuntimeError("public.pro_pitch_events_part already exists; clean it up before rerunning")
            if names.get("b"):
                raise RuntimeError(f"backup table name collision: {backup_name}")

            print("Locking source table...")
            cur.execute("LOCK TABLE public.pro_pitch_events IN ACCESS EXCLUSIVE MODE")

            cur.execute(
                """
                SELECT
                  MIN(EXTRACT(YEAR FROM session_date))::int AS min_year,
                  MAX(EXTRACT(YEAR FROM session_date))::int AS max_year
                FROM public.pro_pitch_events
                WHERE session_date IS NOT NULL
                """
            )
            bounds = cur.fetchone() or {}
            min_year = int(bounds.get("min_year") or datetime.utcnow().year)
            max_year = int(bounds.get("max_year") or min_year)

            print(f"Creating partitioned table for years {min_year}..{max_year + 1}")
            cur.execute(
                """
                CREATE TABLE public.pro_pitch_events_part
                (LIKE public.pro_pitch_events INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING STORAGE INCLUDING COMMENTS)
                PARTITION BY RANGE (session_date)
                """
            )

            for year in range(min_year, max_year + 2):
                cur.execute(
                    f"""
                    CREATE TABLE public.pro_pitch_events_part_{year}
                    PARTITION OF public.pro_pitch_events_part
                    FOR VALUES FROM ('{year}-01-01') TO ('{year + 1}-01-01')
                    """
                )
            cur.execute(
                """
                CREATE TABLE public.pro_pitch_events_part_default
                PARTITION OF public.pro_pitch_events_part DEFAULT
                """
            )

            for stmt in DDL_INDEXES:
                cur.execute(stmt)

            print("Copying rows into partitioned table...")
            cur.execute(
                """
                INSERT INTO public.pro_pitch_events_part
                SELECT * FROM public.pro_pitch_events
                """
            )

            cur.execute(
                """
                SELECT setval(
                  pg_get_serial_sequence('public.pro_pitch_events_part', 'id'),
                  COALESCE((SELECT MAX(id) FROM public.pro_pitch_events_part), 1),
                  true
                )
                """
            )

            print(f"Swapping tables (backup: public.{backup_name})...")
            cur.execute(f"ALTER TABLE public.pro_pitch_events RENAME TO {backup_name}")
            cur.execute("ALTER TABLE public.pro_pitch_events_part RENAME TO pro_pitch_events")
            cur.execute("ALTER SEQUENCE IF EXISTS public.pro_pitch_events_id_seq OWNED BY public.pro_pitch_events.id")

            cur.execute("SELECT pg_advisory_unlock(hashtext('pro_pitch_events_partition_migration'))")

        conn.commit()

    print("Done.")
    print(f"Backup table kept as public.{backup_name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
