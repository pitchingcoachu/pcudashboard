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
import time


def _ensure_direct_connection() -> None:
    url = os.getenv("DASHBOARD_DATABASE_URL", "").strip() or os.getenv("DATABASE_URL", "").strip()
    if not url:
        return
    direct = url.replace("-pooler.", ".", 1)
    if direct != url:
        os.environ["DASHBOARD_DATABASE_URL"] = direct
        print("[refresh] Switched to direct connection (stripped pooler suffix).")


def _school_date_bounds(school_code: str | None) -> list[tuple[str, date, date]]:
    import psycopg
    from psycopg.rows import dict_row

    from dashboard_api.app.config import get_settings

    where_school = "AND UPPER(TRIM(school_code)) = %(school_code)s" if school_code else ""
    params = {"school_code": school_code} if school_code else {}
    with psycopg.connect(get_settings().database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                  UPPER(TRIM(school_code)) AS school_code,
                  MIN(session_date)::date AS min_date,
                  MAX(session_date)::date AS max_date
                FROM public.pitch_events
                WHERE school_code IS NOT NULL
                  AND TRIM(school_code) <> ''
                  AND UPPER(TRIM(school_code)) <> 'PRO'
                  AND session_date IS NOT NULL
                  {where_school}
                GROUP BY UPPER(TRIM(school_code))
                ORDER BY 1
                """,
                params,
            )
            return [
                (str(row["school_code"]), row["min_date"], row["max_date"])
                for row in cur.fetchall()
                if isinstance(row.get("min_date"), date) and isinstance(row.get("max_date"), date)
            ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--school", default="", help="Optional school_code to refresh (e.g. GCU, PCU, LEAGUE)")
    parser.add_argument("--window-start", default="", help="Optional refresh window start, YYYY-MM-DD")
    parser.add_argument("--window-end", default="", help="Optional refresh window end, YYYY-MM-DD")
    parser.add_argument("--batch-days", type=int, default=0, help="Refresh in date batches of this many days")
    parser.add_argument("--retries", type=int, default=2, help="Retries per batch after a transient database failure")
    parser.add_argument(
        "--keep-pooler",
        action="store_true",
        help="Keep the configured pooled database endpoint instead of switching to the direct endpoint",
    )
    args = parser.parse_args()
    if not args.keep_pooler:
        _ensure_direct_connection()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.main import _refresh_league_daily_rollup  # noqa: WPS433

    school = (args.school or "").strip().upper() or None
    window_start = _parse_date(args.window_start)
    window_end = _parse_date(args.window_end)
    if args.batch_days and args.batch_days > 0:
        scopes = _school_date_bounds(school)
        if not scopes:
            raise RuntimeError("No dated non-PRO pitch data found for the requested scope.")
        for scope_school, source_start, source_end in scopes:
            refresh_start = max(source_start, window_start) if window_start else source_start
            final_end = min(source_end, window_end) if window_end else source_end
            if refresh_start > final_end:
                continue
            cur = refresh_start
            while cur <= final_end:
                batch_end = min(cur + timedelta(days=args.batch_days - 1), final_end)
                print(f"Refreshing {scope_school} rollup {cur.isoformat()} through {batch_end.isoformat()}...")
                for attempt in range(max(0, args.retries) + 1):
                    try:
                        _refresh_league_daily_rollup(
                            force=True,
                            school_code=scope_school,
                            raise_on_failure=True,
                            window_start=cur,
                            window_end=batch_end,
                        )
                        break
                    except Exception:
                        if attempt >= max(0, args.retries):
                            raise
                        delay_seconds = min(30, 5 * (attempt + 1))
                        print(
                            f"Retrying {scope_school} {cur.isoformat()} through {batch_end.isoformat()} "
                            f"after database failure ({attempt + 1}/{args.retries})..."
                        )
                        time.sleep(delay_seconds)
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
