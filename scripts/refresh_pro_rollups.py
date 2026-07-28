#!/usr/bin/env python3
"""
Refresh PRO daily rollups.

Usage:
  .venv/bin/python scripts/refresh_pro_rollups.py --incremental
  .venv/bin/python scripts/refresh_pro_rollups.py --force
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import date, timedelta


def _ensure_direct_connection() -> None:
    """Switch DASHBOARD_DATABASE_URL to a direct (non-pooler) connection.

    The Neon connection pooler times out long-running transactions (the PRO
    rollup INSERT can take 30-60 minutes on a full rebuild).  The direct
    endpoint has no such limit.  We derive it by removing '-pooler' from the
    hostname if present.
    """
    url = os.getenv("DASHBOARD_DATABASE_URL", "").strip()
    if not url:
        url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        return
    # Neon pooler hostnames look like: ep-<name>-pooler.<region>.aws.neon.tech
    # Direct hostnames look like:      ep-<name>.<region>.aws.neon.tech
    direct = url.replace("-pooler.", ".", 1)
    if direct != url:
        os.environ["DASHBOARD_DATABASE_URL"] = direct
        print(f"[refresh] Switched to direct connection (stripped pooler suffix).")


def _terminate_advisory_lock_holders(lock_key: int) -> None:
    """Terminate any backends holding the PRO rollup advisory lock.

    The app server's background thread holds this lock while running its own
    (potentially pooler-killed) rollup.  If we don't evict it, the forced
    GH Actions rebuild spins for 120s and then gives up silently.
    """
    import psycopg
    from psycopg.rows import dict_row

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.config import get_settings

    settings = get_settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        conn.autocommit = True
        with conn.cursor() as cur:
            # pg_try_advisory_xact_lock(bigint) stores the key split into
            # classid (high 32 bits) and objid (low 32 bits) in pg_locks.
            cur.execute(
                """
                SELECT a.pid
                FROM pg_locks l
                JOIN pg_stat_activity a ON a.pid = l.pid
                WHERE l.locktype = 'advisory'
                  AND l.classid = %(hi)s::int
                  AND l.objid = %(lo)s::int
                  AND l.pid != pg_backend_pid()
                """,
                {
                    "hi": (lock_key >> 32) & 0xFFFFFFFF,
                    "lo": lock_key & 0xFFFFFFFF,
                },
            )
            holders = [row["pid"] for row in cur.fetchall()]
            for pid in holders:
                print(f"[refresh] Terminating backend PID {pid} holding rollup advisory lock.")
                cur.execute("SELECT pg_terminate_backend(%s)", (pid,))


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh PRO daily rollups.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--incremental",
        action="store_true",
        help="Refresh the recent PRO rollup window instead of rebuilding all history.",
    )
    mode.add_argument(
        "--force",
        action="store_true",
        help="Rebuild PRO rollups from the first available PRO pitch date.",
    )
    parser.add_argument(
        "--chunk-days",
        type=int,
        default=30,
        help="Number of source-data days per transaction during a forced rebuild (default: 30).",
    )
    return parser.parse_args()


def _pro_date_bounds() -> tuple[date, date]:
    import psycopg
    from psycopg.rows import dict_row

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.config import get_settings

    settings = get_settings()
    with psycopg.connect(settings.database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT MIN(session_date)::date AS min_date, MAX(session_date)::date AS max_date
                FROM public.pro_pitch_events
                WHERE school_code = 'PRO'
                  AND session_date IS NOT NULL
                """
            )
            row = cur.fetchone() or {}
    min_date = row.get("min_date")
    max_date = row.get("max_date")
    if not isinstance(min_date, date) or not isinstance(max_date, date):
        raise RuntimeError("No dated PRO pitches are available for rollup refresh.")
    return min_date, max_date


def main() -> int:
    args = _parse_args()
    force = args.force or not args.incremental

    _ensure_direct_connection()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.main import _refresh_pro_daily_rollup, _PRO_ROLLUP_ADVISORY_LOCK_KEY  # noqa: WPS433

    if force:
        _terminate_advisory_lock_holders(_PRO_ROLLUP_ADVISORY_LOCK_KEY)

    try:
        if force:
            chunk_days = max(1, min(int(args.chunk_days), 90))
            min_date, max_date = _pro_date_bounds()
            chunks: list[tuple[date, date]] = []
            chunk_start = min_date
            while chunk_start <= max_date:
                chunk_end = min(max_date, chunk_start + timedelta(days=chunk_days - 1))
                chunks.append((chunk_start, chunk_end))
                chunk_start = chunk_end + timedelta(days=1)
            print(
                f"[refresh] Rebuilding {min_date} through {max_date} "
                f"in {len(chunks)} chunk(s) of up to {chunk_days} days.",
                flush=True,
            )
            for index, (chunk_start, chunk_end) in enumerate(chunks, start=1):
                print(
                    f"[refresh] Chunk {index}/{len(chunks)}: {chunk_start} through {chunk_end}",
                    flush=True,
                )
                _refresh_pro_daily_rollup(
                    force=True,
                    raise_on_failure=True,
                    refresh_start_override=chunk_start,
                    refresh_end_override=chunk_end,
                    refresh_dependents=index == len(chunks),
                )
        else:
            _refresh_pro_daily_rollup(force=False, raise_on_failure=True)
    except Exception as exc:
        print(f"[refresh] ERROR: {exc}", file=sys.stderr)
        return 1

    mode_label = "full" if force else "incremental"
    print(f"Refreshed PRO rollups ({mode_label}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
