#!/usr/bin/env python3
"""One-off: backfill Jacob deGrom's 15 starts from 2021 into pro_mlb_pitch_events_raw
using the same pipeline as sync_pro_mlb_stats.py, then enrich from statcast_degrom.
"""
from __future__ import annotations

import os
import sys
import time
import urllib.parse
from dataclasses import asdict

# Reuse all logic from the main sync script
sys.path.insert(0, os.path.dirname(__file__))
from sync_pro_mlb_stats import (
    _fetch_game_pitches,
    _with_system_sslrootcert,
    UPSERT,
)

import json
import psycopg
from psycopg.types.json import Jsonb

DEGROM_GAME_PKS = [
    (634606, "2021-04-05"),
    (632201, "2021-04-10"),
    (634485, "2021-04-17"),
    (634429, "2021-04-23"),
    (634310, "2021-04-28"),
    (634184, "2021-05-09"),
    (634023, "2021-05-25"),
    (633926, "2021-05-31"),
    (633821, "2021-06-05"),
    (633771, "2021-06-11"),
    (633630, "2021-06-16"),
    (633760, "2021-06-21"),
    (633539, "2021-06-26"),
    (633418, "2021-07-01"),
    (633395, "2021-07-07"),
]

ENRICH_SQL = """
UPDATE public.pro_mlb_pitch_events_raw r
SET
  estimated_woba_using_speedangle = s.s_estimated_woba,
  woba_value                      = s.s_woba_value,
  iso_value                       = s.s_iso_value,
  babip_value                     = s.s_babip_value,
  delta_pitcher_run_exp           = COALESCE(r.delta_pitcher_run_exp, s.s_delta_run_exp),
  zone                            = COALESCE(r.zone, s.s_zone),
  updated_at                      = NOW()
FROM (
  SELECT
    game_pk,
    at_bat_number,
    pitch_number,
    estimated_woba          AS s_estimated_woba,
    woba_value              AS s_woba_value,
    iso_value               AS s_iso_value,
    babip_value             AS s_babip_value,
    delta_pitcher_run_exp   AS s_delta_run_exp,
    zone                    AS s_zone
  FROM statcast_degrom
) s
WHERE r.school_code = 'PRO'
  AND r.game_pk      = s.game_pk
  AND r.at_bat_index = s.at_bat_number
  AND r.pitch_number = s.pitch_number
  AND r.pitcher_id   = 594798
"""


def _require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def main() -> int:
    db_url = _with_system_sslrootcert(_require_env("DASHBOARD_DATABASE_URL"))

    with psycopg.connect(db_url) as conn:
        # Table already exists — skip DDL
        print("Skipping DDL (table already exists).")

        total_pitches = 0
        total_upserted = 0

        for game_pk, game_date in DEGROM_GAME_PKS:
            print(f"Fetching game {game_pk} ({game_date})...", end=" ", flush=True)
            try:
                _feed, rows = _fetch_game_pitches(game_pk, fallback_sport_id=1)
            except Exception as exc:
                print(f"ERROR: {exc}")
                continue

            pitches = [r for r in rows if r.is_pitch]
            total_pitches += len(pitches)

            payloads = []
            for r in rows:
                d = asdict(r)
                d["raw_json"] = Jsonb(d["raw_json"])
                # psycopg3 won't coerce empty string to NULL for date columns
                if not d.get("game_date"):
                    d["game_date"] = None
                payloads.append(d)

            with conn.cursor() as cur:
                cur.executemany(UPSERT, payloads)
                upserted = cur.rowcount
            conn.commit()
            total_upserted += max(upserted, 0)
            print(f"{len(rows)} events ({len(pitches)} pitches), {upserted} upserted")
            time.sleep(0.15)

        print(f"\nAPI sync done: {total_pitches} pitches across {len(DEGROM_GAME_PKS)} games, {total_upserted} rows upserted")

        # Now enrich from statcast_degrom
        print("Enriching from statcast_degrom...", end=" ", flush=True)
        with conn.cursor() as cur:
            cur.execute(ENRICH_SQL)
            enriched = cur.rowcount
        conn.commit()
        print(f"{enriched} rows enriched with Statcast fields")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
