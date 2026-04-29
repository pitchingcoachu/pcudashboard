#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import glob
import math
import os
import re
import random
import time
import urllib.parse
from dataclasses import dataclass
from typing import Dict, Iterable, List, Optional, Tuple

import psycopg
from psycopg import errors as pg_errors


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
    # Keep consistent with sync_pro_mlb_stats.py behavior in local macOS envs.
    query["sslmode"] = ["require"]
    query.pop("sslrootcert", None)
    new_query = urllib.parse.urlencode(query, doseq=True)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, new_query, parsed.fragment))


def _safe_int(v: object) -> Optional[int]:
    try:
        s = str(v or "").strip()
        if not s:
            return None
        return int(float(s))
    except Exception:
        return None


def _safe_float(v: object) -> Optional[float]:
    try:
        s = str(v or "").strip()
        if not s:
            return None
        return float(s)
    except Exception:
        return None


def _norm_key(k: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", k.strip().lower()).strip("_")


def _pick(row: Dict[str, object], *keys: str) -> object:
    for key in keys:
        if key in row:
            return row.get(key)
    return None


def _pick_float(row: Dict[str, object], *keys: str) -> Optional[float]:
    return _safe_float(_pick(row, *keys))


@dataclass
class SavantRow:
    game_pk: int
    at_bat_number: int
    pitch_number: int
    estimated_woba_using_speedangle: Optional[float]
    woba_value: Optional[float]
    iso_value: Optional[float]
    babip_value: Optional[float]
    delta_run_exp: Optional[float]
    hit_distance_sc: Optional[float]
    hc_x: Optional[float]
    hc_y: Optional[float]
    spray_direction: Optional[float]
    bat_speed: Optional[float]
    vertical_attack_angle: Optional[float]
    horizontal_attack_angle: Optional[float]
    contact_position_x: Optional[float]
    contact_position_y: Optional[float]
    contact_position_z: Optional[float]
    vx0: Optional[float]
    vy0: Optional[float]
    vz0: Optional[float]
    ax: Optional[float]
    ay: Optional[float]
    az: Optional[float]


def _as_feet(value: Optional[float]) -> Optional[float]:
    if value is None:
        return None
    v = float(value)
    # Savant exports sometimes provide these in inches.
    return v / 12.0 if abs(v) > 15 else v


def _iter_savant_rows(path: str) -> Iterable[SavantRow]:
    with open(path, "r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            return
        for raw in reader:
            row = {_norm_key(k): v for k, v in raw.items()}
            game_pk = _safe_int(_pick(row, "game_pk", "gamepk"))
            at_bat_number = _safe_int(
                _pick(
                    row,
                    "at_bat_number",
                    "at_bat_num",
                    "at_bat_no",
                    "at_bat_index",
                    "at_bat",
                )
            )
            pitch_number = _safe_int(
                _pick(
                    row,
                    "pitch_number",
                    "pitch_num",
                    "pitch_no",
                    "pitch_of_pa",
                    "pitchnumber",
                )
            )
            if game_pk is None or at_bat_number is None or pitch_number is None:
                continue
            estimated_woba = _pick_float(
                row,
                "estimated_woba_using_speedangle",
                "xwoba",
                "estimated_woba",
            )
            woba_value = _pick_float(row, "woba_value", "woba")
            iso_value = _pick_float(row, "iso_value", "xiso")
            if iso_value is None:
                estimated_slg = _pick_float(row, "estimated_slg_using_speedangle", "xslg")
                estimated_ba = _pick_float(row, "estimated_ba_using_speedangle", "xba")
                if estimated_slg is not None and estimated_ba is not None:
                    iso_value = estimated_slg - estimated_ba

            yield SavantRow(
                game_pk=game_pk,
                at_bat_number=at_bat_number,
                pitch_number=pitch_number,
                estimated_woba_using_speedangle=estimated_woba,
                woba_value=woba_value,
                iso_value=iso_value,
                babip_value=_pick_float(row, "babip_value"),
                delta_run_exp=_safe_float(row.get("delta_run_exp")),
                hit_distance_sc=_safe_float(row.get("hit_distance_sc")),
                hc_x=_safe_float(row.get("hc_x")),
                hc_y=_safe_float(row.get("hc_y")),
                spray_direction=None,
                bat_speed=_safe_float(_pick(row, "bat_speed", "batspeed")),
                vertical_attack_angle=_safe_float(_pick(row, "attack_angle", "vertical_attack_angle", "verticalattackangle")),
                horizontal_attack_angle=_safe_float(
                    _pick(row, "attack_direction", "horizontal_attack_angle", "horizontalattackangle")
                ),
                contact_position_x=_as_feet(
                    _safe_float(
                        _pick(
                            row,
                            "contact_position_x",
                            "contactpositionx",
                            "contact_x",
                            "intercept_ball_minus_batter_pos_x_inches",
                            "intercept_ball_minus_batter_pos_x",
                        )
                    )
                ),
                contact_position_y=_as_feet(
                    _safe_float(
                        _pick(
                            row,
                            "contact_position_y",
                            "contactpositiony",
                            "contact_y",
                            "intercept_ball_minus_batter_pos_y_inches",
                            "intercept_ball_minus_batter_pos_y",
                        )
                    )
                ),
                contact_position_z=_as_feet(
                    _safe_float(
                        _pick(
                            row,
                            "contact_position_z",
                            "contactpositionz",
                            "contact_z",
                            "intercept_ball_minus_batter_pos_z_inches",
                            "intercept_ball_minus_batter_pos_z",
                        )
                    )
                ),
                vx0=_safe_float(_pick(row, "vx0", "v_x0", "vx_0")),
                vy0=_safe_float(_pick(row, "vy0", "v_y0", "vy_0")),
                vz0=_safe_float(_pick(row, "vz0", "v_z0", "vz_0")),
                ax=_safe_float(_pick(row, "ax", "a_x")),
                ay=_safe_float(_pick(row, "ay", "a_y")),
                az=_safe_float(_pick(row, "az", "a_z")),
            )


DDL = """
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS estimated_woba_using_speedangle DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS woba_value DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS iso_value DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS babip_value DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS delta_run_exp DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS hit_distance_sc DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS hc_x DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS hc_y DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS spray_direction DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS bat_speed DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS vertical_attack_angle DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS horizontal_attack_angle DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS contact_position_x DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS contact_position_y DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS contact_position_z DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS vx0 DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS vy0 DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS vz0 DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS ax DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS ay DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events
  ADD COLUMN IF NOT EXISTS az DOUBLE PRECISION;
"""


UPDATE_SQL = """
UPDATE public.pro_pitch_events
SET
  estimated_woba_using_speedangle = %(estimated_woba_using_speedangle)s,
  woba_value = %(woba_value)s,
  iso_value = %(iso_value)s,
  babip_value = %(babip_value)s,
  delta_run_exp = %(delta_run_exp)s,
  hit_distance_sc = %(hit_distance_sc)s,
  hc_x = %(hc_x)s,
  hc_y = %(hc_y)s,
  spray_direction = %(spray_direction)s,
  bat_speed = %(bat_speed)s,
  vertical_attack_angle = %(vertical_attack_angle)s,
  horizontal_attack_angle = %(horizontal_attack_angle)s,
  contact_position_x = %(contact_position_x)s,
  contact_position_y = %(contact_position_y)s,
  contact_position_z = %(contact_position_z)s,
  vx0 = %(vx0)s,
  vy0 = %(vy0)s,
  vz0 = %(vz0)s,
  ax = %(ax)s,
  ay = %(ay)s,
  az = %(az)s,
  updated_at = NOW()
WHERE school_code = 'PRO'
  AND game_pk = %(game_pk)s
  AND at_bat_index = %(at_bat_number)s
  AND pitchid = %(pitch_number)s
"""


def _execute_with_retry(cur: psycopg.Cursor, sql: str, params: dict, *, max_attempts: int = 8) -> int:
    attempt = 0
    while True:
        try:
            cur.execute(sql, params)
            return max(cur.rowcount or 0, 0)
        except (
            psycopg.errors.DeadlockDetected,
            psycopg.errors.LockNotAvailable,
            psycopg.errors.SerializationFailure,
        ):
            attempt += 1
            if attempt >= max_attempts:
                raise
            # Exponential backoff + jitter to avoid lockstep retries across jobs.
            sleep_s = min(2.5, 0.12 * (2 ** (attempt - 1))) + random.uniform(0.0, 0.2)
            time.sleep(sleep_s)


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich PRO rows from Savant CSV columns")
    parser.add_argument(
        "--paths",
        nargs="+",
        default=["data/pro_savant_raw/mlb/*.csv", "data/pro_savant_raw/milb/*.csv"],
        help="CSV paths/globs",
    )
    parser.add_argument("--batch-size", type=int, default=2000)
    args = parser.parse_args()

    db_url = _with_system_sslrootcert(_require_env("DASHBOARD_DATABASE_URL"))

    files: List[str] = []
    for p in args.paths:
        matches = sorted(glob.glob(p))
        if matches:
            files.extend(matches)
        elif os.path.exists(p):
            files.append(p)
    files = sorted(set(files))
    if not files:
        print("no csv files matched")
        return 1

    total_rows = 0
    total_updates = 0
    total_non_null = 0
    total_dedup_skipped = 0
    global_seen_keys: set[tuple[int, int, int]] = set()

    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            try:
                cur.execute("SET lock_timeout = '2s'")
                cur.execute(DDL)
                conn.commit()
            except pg_errors.LockNotAvailable:
                # Columns are already present in production; continue if DDL lock is contended.
                conn.rollback()
                print("ddl_lock_timeout: skipping DDL and continuing with enrichment")

        with conn.cursor() as cur:
            for path in files:
                file_rows = 0
                file_updates = 0
                unmatched = 0
                rows_by_game: Dict[int, List[SavantRow]] = {}
                for row in _iter_savant_rows(path):
                    rows_by_game.setdefault(row.game_pk, []).append(row)

                # Resolve a stable at_bat_number -> at_bat_index offset per game.
                game_offsets: Dict[int, int] = {}
                for game_pk, game_rows in rows_by_game.items():
                    cur.execute(
                        """
                        SELECT at_bat_index, pitchid
                        FROM public.pro_pitch_events
                        WHERE school_code = 'PRO'
                          AND game_pk = %s
                        """,
                        (game_pk,),
                    )
                    key_set: set[Tuple[int, int]] = set()
                    for ab_idx, pitch_no in cur.fetchall():
                        if ab_idx is None or pitch_no is None:
                            continue
                        key_set.add((int(ab_idx), int(pitch_no)))
                    if not key_set:
                        game_offsets[game_pk] = 0
                        continue
                    score_by_offset: Dict[int, int] = {}
                    for offset in (-2, -1, 0, 1, 2):
                        score = 0
                        for r in game_rows:
                            if (r.at_bat_number + offset, r.pitch_number) in key_set:
                                score += 1
                        score_by_offset[offset] = score
                    best_offset = max(score_by_offset.items(), key=lambda kv: (kv[1], -abs(kv[0])))[0]
                    game_offsets[game_pk] = best_offset

                for game_pk, game_rows in rows_by_game.items():
                    game_offset = int(game_offsets.get(game_pk, 0))
                    for row in game_rows:
                        dedupe_key = (row.game_pk, row.at_bat_number, row.pitch_number)
                        if dedupe_key in global_seen_keys:
                            total_dedup_skipped += 1
                            continue
                        global_seen_keys.add(dedupe_key)
                        payload = {
                            "game_pk": row.game_pk,
                            "at_bat_number": (row.at_bat_number + game_offset),
                            "pitch_number": row.pitch_number,
                            "estimated_woba_using_speedangle": row.estimated_woba_using_speedangle,
                            "woba_value": row.woba_value,
                            "iso_value": row.iso_value,
                            "babip_value": row.babip_value,
                            "delta_run_exp": row.delta_run_exp,
                            "hit_distance_sc": row.hit_distance_sc,
                            "hc_x": row.hc_x,
                            "hc_y": row.hc_y,
                            "spray_direction": None,
                            "bat_speed": row.bat_speed,
                            "vertical_attack_angle": row.vertical_attack_angle,
                            "horizontal_attack_angle": row.horizontal_attack_angle,
                            "contact_position_x": row.contact_position_x,
                            "contact_position_y": row.contact_position_y,
                            "contact_position_z": row.contact_position_z,
                            "vx0": row.vx0,
                            "vy0": row.vy0,
                            "vz0": row.vz0,
                            "ax": row.ax,
                            "ay": row.ay,
                            "az": row.az,
                        }
                        # Derive stable spray direction (degrees off center field line, 0=center).
                        # Uses Statcast hit coordinate frame when available.
                        hx = payload.get("hc_x")
                        hy = payload.get("hc_y")
                        if hx is not None and hy is not None:
                            vx = float(hx) - 125.42
                            vy = 198.27 - float(hy)
                            if vy > 0:
                                payload["spray_direction"] = float(abs(math.degrees(math.atan2(vx, vy))))
                        file_rows += 1
                        total_rows += 1
                        if any(
                            payload[k] is not None
                            for k in (
                                "estimated_woba_using_speedangle",
                                "woba_value",
                                "iso_value",
                                "babip_value",
                                "delta_run_exp",
                                "bat_speed",
                                "vertical_attack_angle",
                                "horizontal_attack_angle",
                                "contact_position_x",
                                "contact_position_y",
                                "contact_position_z",
                                "vx0",
                                "vy0",
                                "vz0",
                                "ax",
                                "ay",
                                "az",
                            )
                        ):
                            total_non_null += 1
                        # Exact key match only:
                        # game_pk + at_bat_number(+game_offset) + pitch_number
                        updated = _execute_with_retry(cur, UPDATE_SQL, payload)
                        if updated == 0:
                            unmatched += 1
                        file_updates += updated
                        total_updates += updated
                conn.commit()
                print(f"{path}: rows={file_rows} updated={file_updates} unmatched={unmatched}")

    print(
        "done: "
        f"csv_rows={total_rows} "
        f"updated_rows={total_updates} "
        f"rows_with_any_stat={total_non_null} "
        f"dedup_skipped={total_dedup_skipped}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
