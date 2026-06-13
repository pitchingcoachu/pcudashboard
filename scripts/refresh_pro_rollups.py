#!/usr/bin/env python3
"""
Force-refresh PRO daily rollups.

Usage:
  .venv/bin/python scripts/refresh_pro_rollups.py
"""

from __future__ import annotations

import os
import sys


def main() -> int:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    from dashboard_api.app.main import _refresh_pro_daily_rollup  # noqa: WPS433

    _refresh_pro_daily_rollup(force=True)
    print("Refreshed PRO rollups.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
