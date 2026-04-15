#!/usr/bin/env python3
"""
Force-refresh non-PRO daily rollups (LEAGUE + all college school_code datasets).

Usage:
  .venv/bin/python scripts/refresh_college_rollups.py
  .venv/bin/python scripts/refresh_college_rollups.py --school GCU
"""

from __future__ import annotations

import argparse
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--school", default="", help="Optional school_code to refresh (e.g. GCU, PCU, LEAGUE)")
    args = parser.parse_args()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.main import _refresh_league_daily_rollup  # noqa: WPS433

    school = (args.school or "").strip().upper() or None
    _refresh_league_daily_rollup(force=True, school_code=school)
    if school:
        print(f"Refreshed college rollup for {school}.")
    else:
        print("Refreshed college rollups for all non-PRO school codes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
