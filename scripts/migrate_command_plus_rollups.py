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

# PRO tables already GROUP BY balls_num/strikes_num, so each row's own
# balls_num/strikes_num IS the exact count -- only location sums are needed.
PRO_NEW_COLUMNS = (
    ("plate_side_sum", "DOUBLE PRECISION NOT NULL DEFAULT 0.0"),
    ("plate_side_n", "INT NOT NULL DEFAULT 0"),
    ("plate_height_sum", "DOUBLE PRECISION NOT NULL DEFAULT 0.0"),
    ("plate_height_n", "INT NOT NULL DEFAULT 0"),
)

LEAGUE_ROLLUP_TABLES = (
    "pitch_events_daily_rollup_league",
    "pitch_events_daily_rollup_league_split",
)

# LEAGUE tables do NOT group by count, so Command+ needs an average
# balls/strikes per bucket in addition to the location sums.
LEAGUE_NEW_COLUMNS = PRO_NEW_COLUMNS + (
    ("balls_sum", "DOUBLE PRECISION NOT NULL DEFAULT 0.0"),
    ("strikes_sum", "DOUBLE PRECISION NOT NULL DEFAULT 0.0"),
)


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
