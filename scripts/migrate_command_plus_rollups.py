#!/usr/bin/env python3
"""Add plate-location aggregates (for Command+) to the daily pitching rollup tables."""

from __future__ import annotations

import os
import sys

import psycopg


PRO_ROLLUP_TABLES = (
    "pro_pitch_events_daily_rollup",
    "pro_pitch_events_daily_rollup_split",
    # pro_pitch_events_game_rollup is populated via a bare "INSERT INTO ...
    # SELECT *" from pro_pitch_events_daily_rollup_split (see
    # _refresh_pro_daily_rollup in dashboard_api/app/main.py) -- it must
    # carry the exact same columns as the split table or that passthrough
    # INSERT breaks with "more expressions than target columns".
    "pro_pitch_events_game_rollup",
)

# Each row already groups by exact balls_num/strikes_num at the DAILY
# rollup grain, but the PRO fast-path's per-pitcher/per-pitch-type read
# query (_try_pro_pitching_overview_rollup) further GROUPs BY pitcher +
# pitch_type only, summing everything else away -- so an average
# balls/strikes per bucket is needed at read time too, same as LEAGUE.
NEW_COLUMNS = (
    ("plate_side_sum", "DOUBLE PRECISION NOT NULL DEFAULT 0.0"),
    ("plate_side_n", "INT NOT NULL DEFAULT 0"),
    ("plate_height_sum", "DOUBLE PRECISION NOT NULL DEFAULT 0.0"),
    ("plate_height_n", "INT NOT NULL DEFAULT 0"),
    ("balls_sum", "DOUBLE PRECISION NOT NULL DEFAULT 0.0"),
    ("strikes_sum", "DOUBLE PRECISION NOT NULL DEFAULT 0.0"),
)
PRO_NEW_COLUMNS = NEW_COLUMNS

LEAGUE_ROLLUP_TABLES = (
    "pitch_events_daily_rollup_league",
    "pitch_events_daily_rollup_league_split",
)
LEAGUE_NEW_COLUMNS = NEW_COLUMNS


def main() -> int:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.config import get_settings

    with psycopg.connect(get_settings().database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '30s'")
            for table_name in PRO_ROLLUP_TABLES:
                for col_name, col_def in PRO_NEW_COLUMNS:
                    cur.execute(
                        f"""
                        ALTER TABLE IF EXISTS public.{table_name}
                        ADD COLUMN IF NOT EXISTS {col_name} {col_def}
                        """
                    )
            for table_name in LEAGUE_ROLLUP_TABLES:
                for col_name, col_def in LEAGUE_NEW_COLUMNS:
                    cur.execute(
                        f"""
                        ALTER TABLE IF EXISTS public.{table_name}
                        ADD COLUMN IF NOT EXISTS {col_name} {col_def}
                        """
                    )
    print("Added plate-location aggregate columns (for Command+) to pitching rollups.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
