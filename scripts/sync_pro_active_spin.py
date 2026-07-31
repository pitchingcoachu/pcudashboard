#!/usr/bin/env python3
"""Refresh pro_pitcher_active_spin from Baseball Savant player pages.

Baseball Savant doesn't expose active spin % (per pitch type) in the CSV/API
feeds this project otherwise ingests -- it's only shown on individual player
pages, embedded in a `serverVals` JS blob. This script fetches that page per
MLB pitcher, extracts the most recent season's active_spin_formatted per
pitch type, and upserts into pro_pitcher_active_spin so it can be joined
against Magnus line / movement data.

Pitcher name -> MLBAM id resolution goes through MLB's public Stats API
(exact fullName match only; ambiguous/unresolved names are skipped and
reported rather than guessed).
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from typing import Dict, List, Optional, Tuple

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


MLB_STATS_API_URL = "https://statsapi.mlb.com/api/v1/sports/1/players?season={season}"
SAVANT_PLAYER_URL = "https://baseballsavant.mlb.com/savant-player/{slug}?stats=statcast-r-pitching-mlb"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
REQUEST_TIMEOUT_SECONDS = 20
RATE_LIMIT_SECONDS = 2.0


def fetch_mlb_pitcher_lookup(season: int) -> Dict[str, Dict[str, object]]:
    url = MLB_STATS_API_URL.format(season=season)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    people = data.get("people", [])
    pitchers = [p for p in people if p.get("primaryPosition", {}).get("code") == "1"]
    return {p["fullName"]: {"id": p["id"], "nameSlug": p["nameSlug"]} for p in pitchers}


def get_distinct_mlb_pitcher_names(conn: "psycopg.Connection", since_date: str) -> List[str]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT pitcher
            FROM pro_pitch_events
            WHERE sport_id = 1 AND session_date >= %s AND game_type = 'R'
            """,
            (since_date,),
        )
        return [r[0] for r in cur.fetchall()]


def fetch_savant_page(name_slug: str) -> Tuple[str, str]:
    url = SAVANT_PLAYER_URL.format(slug=name_slug)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as resp:
        return resp.read().decode("utf-8", errors="replace"), url


def parse_active_spin(html: str) -> Optional[Dict[str, Tuple[float, int]]]:
    """Extract the most recent season's active spin % per pitch type.

    Savant embeds one block per (season, pitch type):
      {"season":YYYY,"is_sport_mlb":1,...,"api_pitch_type":"XX",...,"active_spin_formatted":NN}
    Returns {pitch_type: (active_spin_pct, season)} using each pitch type's
    latest available season (which may differ across pitch types, e.g. a
    pitch dropped from the arsenal in the current season).
    """
    by_pitch_season: Dict[str, Dict[int, float]] = {}
    for m in re.finditer(
        r'"season":(\d{4}),"is_sport_mlb":1[^}]*?"api_pitch_type":"([A-Z]+)"[^}]*?"active_spin_formatted":(\d+(?:\.\d+)?)',
        html,
    ):
        season, pitch_type, pct = int(m.group(1)), m.group(2), float(m.group(3))
        by_pitch_season.setdefault(pitch_type, {})[season] = pct

    if not by_pitch_season:
        return None

    return {
        pitch_type: (seasons[max(seasons)], max(seasons))
        for pitch_type, seasons in by_pitch_season.items()
    }


def ensure_table(conn: "psycopg.Connection") -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS pro_pitcher_active_spin (
                id BIGSERIAL PRIMARY KEY,
                mlbam_id INTEGER NOT NULL,
                pitcher_name TEXT NOT NULL,
                pitch_type TEXT NOT NULL,
                active_spin_pct DOUBLE PRECISION NOT NULL,
                savant_season INTEGER NOT NULL,
                as_of_date DATE NOT NULL DEFAULT CURRENT_DATE,
                source_url TEXT,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                UNIQUE (mlbam_id, pitch_type)
            )
            """
        )
    conn.commit()


def upsert_active_spin(
    conn: "psycopg.Connection",
    mlbam_id: int,
    pitcher_name: str,
    pitch_type: str,
    pct: float,
    season: int,
    source_url: str,
) -> bool:
    """Returns True if the row's active_spin_pct actually changed (new insert or updated value)."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT active_spin_pct FROM pro_pitcher_active_spin WHERE mlbam_id = %s AND pitch_type = %s",
            (mlbam_id, pitch_type),
        )
        row = cur.fetchone()
        previous_pct = row[0] if row else None

        cur.execute(
            """
            INSERT INTO pro_pitcher_active_spin
                (mlbam_id, pitcher_name, pitch_type, active_spin_pct, savant_season, source_url)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (mlbam_id, pitch_type)
            DO UPDATE SET active_spin_pct = EXCLUDED.active_spin_pct,
                          pitcher_name = EXCLUDED.pitcher_name,
                          savant_season = EXCLUDED.savant_season,
                          as_of_date = CURRENT_DATE,
                          source_url = EXCLUDED.source_url,
                          updated_at = now()
            """,
            (mlbam_id, pitcher_name, pitch_type, pct, season, source_url),
        )
    return previous_pct is None or previous_pct != pct


def main() -> None:
    db_url = _with_system_sslrootcert(_require_env("DASHBOARD_DATABASE_URL"))
    since_date = os.getenv("PRO_ACTIVE_SPIN_SINCE_DATE", "2025-01-01").strip()
    season = int(os.getenv("PRO_ACTIVE_SPIN_MLB_SEASON", "2026"))
    limit = int(os.getenv("PRO_ACTIVE_SPIN_LIMIT", "0")) or None

    lookup = fetch_mlb_pitcher_lookup(season)
    print(f"Loaded {len(lookup)} MLB pitchers from MLB Stats API (season={season})", file=sys.stderr)

    conn = psycopg.connect(db_url)
    ensure_table(conn)

    pitcher_names = get_distinct_mlb_pitcher_names(conn, since_date)
    print(f"Found {len(pitcher_names)} distinct MLB-level pitcher names in pro_pitch_events since {since_date}", file=sys.stderr)

    resolved: Dict[str, Dict[str, object]] = {}
    unresolved: List[str] = []
    for name in pitcher_names:
        if name in lookup:
            resolved[name] = lookup[name]
        else:
            unresolved.append(name)
    print(f"Resolved: {len(resolved)}  Unresolved: {len(unresolved)}", file=sys.stderr)

    targets = list(resolved.items())
    if limit:
        targets = targets[:limit]

    success = 0
    changed = 0
    fail = 0
    failed_names: List[str] = []
    for name, info in targets:
        try:
            html, url = fetch_savant_page(str(info["nameSlug"]))
            spin_data = parse_active_spin(html)
            if not spin_data:
                print(f"  FAIL (no data parsed): {name}", file=sys.stderr)
                fail += 1
                failed_names.append(name)
                continue
            any_changed = False
            for pitch_type, (pct, pitch_season) in spin_data.items():
                if upsert_active_spin(conn, int(info["id"]), name, pitch_type, pct, pitch_season, url):
                    any_changed = True
            conn.commit()
            success += 1
            if any_changed:
                changed += 1
        except Exception as exc:  # noqa: BLE001 - report and continue; one bad page shouldn't kill the run
            print(f"  ERROR: {name}: {exc}", file=sys.stderr)
            fail += 1
            failed_names.append(name)
            conn.rollback()
        time.sleep(RATE_LIMIT_SECONDS)

    print(
        f"\nDone. Attempted: {len(targets)}  Success: {success}  Changed: {changed}  Fail: {fail}",
        file=sys.stderr,
    )
    if failed_names:
        print(f"Failed names: {failed_names}", file=sys.stderr)

    with conn.cursor() as cur:
        cur.execute("SELECT count(*), count(DISTINCT mlbam_id) FROM pro_pitcher_active_spin")
        total_rows, total_pitchers = cur.fetchone()
    print(f"Table now has {total_rows} rows across {total_pitchers} pitchers", file=sys.stderr)

    conn.close()

    # Fail the CI job loudly if Savant's page structure appears to have broken
    # (e.g. near-total parse failure), rather than silently leaving stale data.
    if targets and fail > len(targets) * 0.5:
        print("More than half of requests failed -- Savant page structure may have changed.", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
