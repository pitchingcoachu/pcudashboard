#!/usr/bin/env python3
"""Add normalized-VAA aggregates to all pitching rollup tables."""

from __future__ import annotations

import os
import sys

import psycopg


ROLLUP_TABLES = (
    "pitch_events_daily_rollup_league",
    "pitch_events_daily_rollup_league_split",
    "pitch_events_game_rollup_league",
    "pro_pitch_events_daily_rollup",
    "pro_pitch_events_daily_rollup_split",
    "pro_pitch_events_game_rollup",
)


def main() -> int:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.config import get_settings

    with psycopg.connect(get_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '30s'")
            for table_name in ROLLUP_TABLES:
                cur.execute(
                    f"""
                    ALTER TABLE IF EXISTS public.{table_name}
                    ADD COLUMN IF NOT EXISTS nvaa_sum DOUBLE PRECISION NOT NULL DEFAULT 0.0
                    """
                )
                cur.execute(
                    f"""
                    ALTER TABLE IF EXISTS public.{table_name}
                    ADD COLUMN IF NOT EXISTS nvaa_n INT NOT NULL DEFAULT 0
                    """
                )
    print("Added nVAA aggregate columns to pitching rollups.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
