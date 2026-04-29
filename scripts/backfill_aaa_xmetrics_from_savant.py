#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import io
import os
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date
from typing import Optional

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


def _safe_int(value: object) -> Optional[int]:
    try:
        s = str(value or "").strip()
        if not s:
            return None
        return int(float(s))
    except Exception:
        return None


def _safe_float(value: object) -> Optional[float]:
    try:
        s = str(value or "").strip()
        if not s:
            return None
        return float(s)
    except Exception:
        return None


def _csv_get(url: str, timeout: int = 60) -> list[dict[str, str]]:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "pcu-pro-backfill/1.0",
            "Accept": "text/csv,application/download;q=0.9,*/*;q=0.8",
            "Referer": "https://baseballsavant.mlb.com/",
        },
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        payload = resp.read().decode("utf-8-sig", errors="replace")
    reader = csv.DictReader(io.StringIO(payload))
    return [dict(r) for r in reader]


def _fetch_savant_by_game(game_pk: int) -> dict[tuple[int, int], dict[str, Optional[float]]]:
    url = f"https://baseballsavant.mlb.com/statcast-search-minors/csv?all=true&type=details&game_pk={game_pk}"
    out: dict[tuple[int, int], dict[str, Optional[float]]] = {}
    try:
        rows = _csv_get(url)
    except Exception:
        return out
    for row in rows:
        ab = _safe_int(row.get("at_bat_number"))
        pn = _safe_int(row.get("pitch_number"))
        if ab is None or pn is None:
            continue
        xwoba = _safe_float(row.get("estimated_woba_using_speedangle"))
        woba = _safe_float(row.get("woba_value"))
        xiso = _safe_float(row.get("iso_value"))
        if xiso is None:
            xslg = _safe_float(row.get("estimated_slg_using_speedangle"))
            xba = _safe_float(row.get("estimated_ba_using_speedangle"))
            if xslg is not None and xba is not None:
                xiso = xslg - xba
        babip = _safe_float(row.get("babip_value"))
        if xwoba is None and woba is None and xiso is None and babip is None:
            continue
        out[(ab, pn)] = {
            "estimated_woba_using_speedangle": xwoba,
            "woba_value": woba,
            "iso_value": xiso,
            "babip_value": babip,
        }
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Backfill AAA pitching x-metrics from Savant by game_pk")
    ap.add_argument("--start-date", required=True, help="YYYY-MM-DD")
    ap.add_argument("--end-date", required=True, help="YYYY-MM-DD")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    start = date.fromisoformat(args.start_date)
    end = date.fromisoformat(args.end_date)
    if end < start:
        raise ValueError("end-date must be >= start-date")

    db_url = _with_system_sslrootcert(_require_env("DASHBOARD_DATABASE_URL"))

    update_sql = """
    UPDATE public.pro_pitch_events
    SET
      estimated_woba_using_speedangle = COALESCE(%(xwoba)s, estimated_woba_using_speedangle),
      woba_value = COALESCE(%(woba)s, woba_value),
      iso_value = COALESCE(%(xiso)s, iso_value),
      babip_value = COALESCE(%(babip)s, babip_value),
      updated_at = NOW()
    WHERE school_code='PRO'
      AND sport_id = 11
      AND game_pk = %(game_pk)s
      AND pitchid = %(pitch_no)s
      AND at_bat_index = %(ab_index)s
    """

    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT game_pk, at_bat_index, pitchid
            FROM public.pro_pitch_events
            WHERE school_code='PRO'
              AND sport_id=11
              AND session_date BETWEEN %s AND %s
              AND (
                estimated_woba_using_speedangle IS NULL
                OR iso_value IS NULL
                OR woba_value IS NULL
                OR babip_value IS NULL
              )
              AND pitchid IS NOT NULL
            """,
            (start.isoformat(), end.isoformat()),
        )
        missing = cur.fetchall()

        by_game: dict[int, list[tuple[int, int]]] = defaultdict(list)
        for gpk, ab, pn in missing:
            if gpk is None or ab is None or pn is None:
                continue
            by_game[int(gpk)].append((int(ab), int(pn)))

        print(f"candidate_games={len(by_game)} candidate_rows={len(missing)}")
        total_updates = 0
        total_matches = 0
        for i, (game_pk, keys) in enumerate(sorted(by_game.items()), 1):
            savant = _fetch_savant_by_game(game_pk)
            if not savant:
                continue
            matched = 0
            updated = 0
            unique_keys = list(set(keys))
            for ab_idx, pitch_no in unique_keys:
                payload = None
                for off in (0, -1, 1, -2, 2):
                    payload = savant.get((ab_idx + off, pitch_no))
                    if payload:
                        break
                if not payload:
                    continue
                matched += 1
                if not args.dry_run:
                    cur.execute(
                        update_sql,
                        {
                            "xwoba": payload.get("estimated_woba_using_speedangle"),
                            "woba": payload.get("woba_value"),
                            "xiso": payload.get("iso_value"),
                            "babip": payload.get("babip_value"),
                            "game_pk": game_pk,
                            "pitch_no": pitch_no,
                            "ab_index": ab_idx,
                        },
                    )
                    updated += max(cur.rowcount or 0, 0)
            total_matches += matched
            total_updates += updated
            if i % 25 == 0 or matched > 0:
                print(f"{i}/{len(by_game)} game_pk={game_pk} matched={matched} updated={updated}")
        if not args.dry_run:
            conn.commit()
        print(f"done matches={total_matches} updated={total_updates} dry_run={args.dry_run}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

