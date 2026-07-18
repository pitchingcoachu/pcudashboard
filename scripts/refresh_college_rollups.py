#!/usr/bin/env python3
"""
Force-refresh non-PRO daily rollups (LEAGUE + all college school_code datasets).

Usage:
  .venv/bin/python scripts/refresh_college_rollups.py
  .venv/bin/python scripts/refresh_college_rollups.py --school GCU
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--school", default="", help="Optional school_code to refresh (e.g. GCU, PCU, LEAGUE)")
    parser.add_argument("--window-start", default="", help="Optional refresh window start, YYYY-MM-DD")
    parser.add_argument("--window-end", default="", help="Optional refresh window end, YYYY-MM-DD")
    parser.add_argument("--batch-days", type=int, default=0, help="Refresh in date batches of this many days")
    args = parser.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.main import _refresh_league_daily_rollup  # noqa: WPS433

    school = (args.school or "").strip().upper() or None
    window_start = _parse_date(args.window_start)
    window_end = _parse_date(args.window_end)
    if args.batch_days and args.batch_days > 0:
        if not school:
            raise ValueError("--batch-days requires --school")
        if not window_start:
            raise ValueError("--batch-days requires --window-start")
        final_end = window_end or date.today()
        cur = window_start
        while cur <= final_end:
            batch_end = min(cur + timedelta(days=args.batch_days - 1), final_end)
            print(f"Refreshing {school} rollup {cur.isoformat()} through {batch_end.isoformat()}...")
            _refresh_league_daily_rollup(
                force=True,
                school_code=school,
                raise_on_failure=True,
                window_start=cur,
                window_end=batch_end,
            )
            cur = batch_end + timedelta(days=1)
    else:
        _refresh_league_daily_rollup(
            force=True,
            school_code=school,
            raise_on_failure=True,
            window_start=window_start,
            window_end=window_end,
        )
    if school:
        print(f"Refreshed college rollup for {school}.")
    else:
        print("Refreshed college rollups for all non-PRO school codes.")
    return 0


def _parse_date(value: str) -> date | None:
    value = (value or "").strip()
    if not value:
        return None
    return datetime.strptime(value, "%Y-%m-%d").date()


if __name__ == "__main__":
    raise SystemExit(main())
