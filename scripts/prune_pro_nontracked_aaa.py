#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import urllib.parse

import psycopg


def _require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _with_system_sslrootcert(db_url: str) -> str:
    value = (db_url or "").strip()
    if not value:
        return value
    parsed = urllib.parse.urlsplit(value)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    query["sslmode"] = ["require"]
    query.pop("sslrootcert", None)
    new_query = urllib.parse.urlencode(query, doseq=True)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, new_query, parsed.fragment))


def _norm_name(value: str) -> str:
    raw = str(value or "").strip().lower()
    return "".join(ch for ch in raw if ch.isalnum())


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Delete PRO AAA rows where neither pitcher nor batter is in tracked list"
    )
    parser.add_argument(
        "--tracked-players",
        required=True,
        help="Comma-separated names (matches pitcher OR batter).",
    )
    args = parser.parse_args()

    tracked = sorted({_norm_name(x) for x in str(args.tracked_players).split(",") if _norm_name(x)})
    if not tracked:
        print("No tracked players provided; refusing to delete.")
        return 2

    db_url = _with_system_sslrootcert(_require_env("DASHBOARD_DATABASE_URL"))
    deleted_norm = 0
    deleted_raw = 0

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                DELETE FROM public.pro_pitch_events
                 WHERE school_code = 'PRO'
                   AND sport_id = 11
                   AND regexp_replace(lower(coalesce(trim(pitcher), '')), '[^a-z0-9]', '', 'g') <> ALL(%s::text[])
                   AND regexp_replace(lower(coalesce(trim(batter), '')), '[^a-z0-9]', '', 'g') <> ALL(%s::text[])
                """,
                (tracked, tracked),
            )
            deleted_norm = int(cur.rowcount or 0)

            cur.execute(
                """
                DELETE FROM public.pro_mlb_pitch_events_raw
                 WHERE school_code = 'PRO'
                   AND sport_id = 11
                   AND regexp_replace(lower(coalesce(trim(pitcher_name), '')), '[^a-z0-9]', '', 'g') <> ALL(%s::text[])
                   AND regexp_replace(lower(coalesce(trim(batter_name), '')), '[^a-z0-9]', '', 'g') <> ALL(%s::text[])
                """,
                (tracked, tracked),
            )
            deleted_raw = int(cur.rowcount or 0)
        conn.commit()

    print(f"done: deleted_pro_pitch_events={deleted_norm} deleted_pro_mlb_pitch_events_raw={deleted_raw}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

