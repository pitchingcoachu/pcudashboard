#!/usr/bin/env python3
"""
Force-refresh PRO daily rollups.

Usage:
  .venv/bin/python scripts/refresh_pro_rollups.py
"""

from __future__ import annotations

import os
import sys


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
                SELECT pid
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


def main() -> int:
    _ensure_direct_connection()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.main import _refresh_pro_daily_rollup, _PRO_ROLLUP_ADVISORY_LOCK_KEY  # noqa: WPS433

    _terminate_advisory_lock_holders(_PRO_ROLLUP_ADVISORY_LOCK_KEY)

    try:
        _refresh_pro_daily_rollup(force=True, raise_on_failure=True)
    except Exception as exc:
        print(f"[refresh] ERROR: {exc}", file=sys.stderr)
        return 1

    print("Refreshed PRO rollups.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
