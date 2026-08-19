#!/usr/bin/env python3
"""
Stuff+ 2.0 -- training data extraction.

Pulls pitch-level rows from both pitch_events (college/LEAGUE) and
pro_pitch_events (PRO/MLB), classifies pitch type via the same
_pitch_type_family logic already used in dashboard_api/app/main.py,
computes each pitcher's own average Fastball/Sinker shape (for the
fastball-relative features off-speed pitches need), and labels each row
with its TRAINING TARGET:

  - PRO rows: real Statcast delta_run_exp (per-pitch run expectancy delta),
    kept only where it's actually populated (~50% of PRO rows) -- no
    fallback to any estimated/heuristic value, so every training label is a
    genuinely measured outcome.
  - LEAGUE (college) rows: PV/100's underlying per-pitch value, computed via
    the SAME _calc_pitch_value() function main.py already uses for the
    live PV/100 column (imported directly, not reimplemented, so training
    can't silently drift from what the dashboard actually shows). This is a
    fixed linear-weights outcome scoring system (StrikeCalled=-0.03,
    HomeRun=+1.40, etc. plus a count-leverage adjustment) -- not an attempt
    at true baserunner-aware run expectancy, which isn't buildable from this
    schema (no baserunner-occupancy columns exist).

Both targets are stored in a single `target` column per row (also keeping
`target_source` = "delta_run_exp" | "pv100" so training can weight/inspect
them separately if needed), plus the legacy `csw` label is still computed
for diagnostic comparison.

Output: one parquet file per pitch type under stuff2_training/data/,
containing model-ready feature columns + target/target_source/csw + level +
school_code (kept for diagnostics, not used as a training feature besides
`level`).

Usage:
  python3 extract_dataset.py
"""

from __future__ import annotations

import os
import re
import sys
import time

import numpy as np
import pandas as pd
import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from dashboard_api.app.config import get_settings  # noqa: E402
from dashboard_api.app.main import (  # noqa: E402
    PRO_MLB_ONLY_TEAM_CODES,
    PRO_TEAM_CODE_OVERLAP,
    _calc_pitch_value,
)

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
os.makedirs(OUTPUT_DIR, exist_ok=True)

_PITCH_TYPE_MAP = {
    "fastball": "Fastball", "fourseamfastball": "Fastball", "4seamfastball": "Fastball",
    "fourseam": "Fastball", "ff": "Fastball", "fa": "Fastball",
    "sinker": "Sinker", "oneseamfastball": "Sinker", "twoseamfastball": "Sinker",
    "twoseamfasball": "Sinker", "twoseam": "Sinker", "si": "Sinker", "ft": "Sinker",
    "cutter": "Cutter", "fc": "Cutter",
    "slider": "Slider", "sl": "Slider",
    "sweeper": "Sweeper", "st": "Sweeper",
    "curveball": "Curveball", "curve": "Curveball", "cu": "Curveball", "kc": "Curveball",
    "slurve": "Curveball", "sv": "Curveball",
    "changeup": "ChangeUp", "change": "ChangeUp", "ch": "ChangeUp", "circlechange": "ChangeUp",
    "splitter": "Splitter", "split": "Splitter", "splitfinger": "Splitter", "sp": "Splitter", "fs": "Splitter",
}
PITCH_TYPES = ["Fastball", "Sinker", "Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"]
OFFSPEED_TYPES = ["Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"]

_LEAGUE_CSW_CALLS = {"StrikeCalled", "StrikeSwinging"}
_LEAGUE_VALID_CALLS = {
    "BallCalled", "StrikeCalled", "InPlay", "FoulBallNotFieldable", "StrikeSwinging",
    "BallinDirt", "HitByPitch", "FoulBallFieldable", "BallIntentional",
    "AutomaticBall", "AutomaticStrike", "foulBallNotFieldable",
}
_PRO_CSW_CALLS = {"Called Strike", "Swinging Strike", "Swinging Strike (Blocked)"}
_PRO_VALID_CALLS = {
    "Ball", "Foul", "Called Strike", "In play, out(s)", "Swinging Strike",
    "In play, no out", "In play, run(s)", "Ball In Dirt", "Foul Tip",
    "Swinging Strike (Blocked)", "Hit By Pitch", "Foul Bunt", "Missed Bunt",
    "Pitchout", "Intent Ball", "Swinging Pitchout",
}


def _pitch_family(value) -> str:
    token = re.sub(r"[^a-z0-9]+", "", str(value or "").strip().lower())
    return _PITCH_TYPE_MAP.get(token, "Other")


def _norm_hand(value) -> str:
    v = str(value or "").strip().upper()
    if v.startswith("L"):
        return "Left"
    if v.startswith("R"):
        return "Right"
    return ""


def _to_num(series: pd.Series) -> pd.Series:
    return pd.to_numeric(series, errors="coerce")


def _fetch_league(conn) -> pd.DataFrame:
    print("[extract] Fetching LEAGUE rows...")
    t0 = time.monotonic()
    sql = """
        SELECT
          pitcher, taggedpitchtype, pitchcall, pitcherthrows, batterside,
          level, school_code,
          relspeed_num AS relspeed, ivb_num AS ivb, hb_num AS hb,
          spinrate, extension, relheight, relside,
          playresult, korbb, balls, strikes, outsonplay
        FROM public.pitch_events
        WHERE school_code = 'LEAGUE'
          AND level IN ('D1', 'D2', 'D3', 'JUCO', 'NAIA')
          AND relspeed_num IS NOT NULL AND ivb_num IS NOT NULL AND hb_num IS NOT NULL
          AND pitcherthrows IS NOT NULL AND pitchcall IS NOT NULL
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    df = pd.DataFrame(rows)
    print(f"[extract] LEAGUE: {len(df)} rows in {time.monotonic() - t0:.1f}s")
    for col in ("spinrate", "extension", "relheight", "relside"):
        df[col] = _to_num(df[col])
    df["level"] = df["level"].astype(str)
    return df


def _fetch_pro(conn) -> pd.DataFrame:
    print("[extract] Fetching PRO rows...")
    t0 = time.monotonic()
    # Only rows with a REAL delta_run_exp -- no fallback to any estimated
    # value, per the confirmed plan: PRO trains on genuinely measured run
    # value only, never a heuristic standing in for it.
    sql = """
        SELECT
          pitcher, taggedpitchtype, pitchcall, pitcherthrows, batterside,
          school_code, pitcherteam, sport_id, delta_run_exp,
          relspeed, inducedvertbreak AS ivb, horzbreak AS hb,
          spinrate, extension, relheight, relside
        FROM public.pro_pitch_events
        WHERE school_code = 'PRO'
          AND relspeed IS NOT NULL AND inducedvertbreak IS NOT NULL AND horzbreak IS NOT NULL
          AND pitcherthrows IS NOT NULL AND pitchcall IS NOT NULL
          AND delta_run_exp IS NOT NULL
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    df = pd.DataFrame(rows)
    print(f"[extract] PRO: {len(df)} rows in {time.monotonic() - t0:.1f}s")

    team = df["pitcherteam"].astype(str).str.strip().str.upper()
    mlb_only = set(PRO_MLB_ONLY_TEAM_CODES)
    overlap = set(PRO_TEAM_CODE_OVERLAP)
    is_mlb_only = team.isin(mlb_only)
    is_overlap_mlb = team.isin(overlap) & (df["sport_id"].fillna(0).astype(int) == 1)
    df["level"] = np.where(is_mlb_only | is_overlap_mlb, "MLB", "AAA")
    df = df.drop(columns=["pitcherteam", "sport_id"])
    return df


def _label_csw(df: pd.DataFrame, valid_calls: set[str], csw_calls: set[str]) -> pd.DataFrame:
    df = df[df["pitchcall"].isin(valid_calls)].copy()
    df["csw"] = df["pitchcall"].isin(csw_calls).astype(int)
    return df


def _build_pitcher_base_averages(df: pd.DataFrame) -> pd.DataFrame:
    """One row per pitcher: their own average Fastball/Sinker (ivb, hb, velo),
    with hb mirrored to righty-space (negate for Right, matching the
    convention used everywhere else in this codebase -- hb_adj_sum etc.)
    before averaging, so cross-hand comparisons and separations are
    consistent."""
    base = df[df["pitch_type"].isin(["Fastball", "Sinker"])].copy()
    base["hb_mirrored"] = np.where(base["pitcherthrows_norm"] == "Right", -base["hb"], base["hb"])
    agg = (
        base.groupby(["pitcher", "pitch_type"])
        .agg(
            base_velo=("relspeed", "mean"),
            base_ivb=("ivb", "mean"),
            base_hb_mirrored=("hb_mirrored", "mean"),
            base_n=("relspeed", "count"),
        )
        .reset_index()
    )
    agg = agg[agg["base_n"] >= 10]
    wide = agg.pivot(index="pitcher", columns="pitch_type", values=["base_velo", "base_ivb", "base_hb_mirrored", "base_n"])
    wide.columns = [f"{metric}_{pt.lower()}" for metric, pt in wide.columns]
    wide = wide.reset_index()
    return wide


def process_source(df: pd.DataFrame, source: str) -> pd.DataFrame:
    df["pitch_type"] = df["taggedpitchtype"].map(_pitch_family)
    df["pitcherthrows_norm"] = df["pitcherthrows"].map(_norm_hand)
    df["batterside_norm"] = df["batterside"].map(_norm_hand)
    df = df[df["pitch_type"] != "Other"]
    df = df[df["pitcherthrows_norm"].isin(["Left", "Right"])]

    if source == "league":
        df = _label_csw(df, _LEAGUE_VALID_CALLS, _LEAGUE_CSW_CALLS)
        df["target"] = df.apply(
            lambda r: _calc_pitch_value(
                pitch_call=r["pitchcall"],
                play_result=r["playresult"],
                korbb=r["korbb"],
                balls=r["balls"],
                strikes=r["strikes"],
                outs=None,
                outs_on_play=r["outsonplay"],
                school_code=r["school_code"],
            ),
            axis=1,
        )
        # Stuff+ 2.0 should grade the PITCH, not reward the pitcher for the
        # batter's/defense's outcome -- flip sign so higher target = better
        # for the pitcher, matching how CSW/delta_run_exp are already
        # oriented (both: higher = better pitch). _calc_pitch_value defines
        # positive as favoring the HITTER (see its own docstring comment),
        # so negate it here.
        df["target"] = -df["target"]
        df["target_source"] = "pv100"
    else:
        df = _label_csw(df, _PRO_VALID_CALLS, _PRO_CSW_CALLS)
        # delta_run_exp: positive = run expectancy increased (favors the
        # batter), same "favors hitter" sign convention as _calc_pitch_value
        # -- negate for the same reason, so higher target = better for the
        # pitcher across both sources.
        df["target"] = -df["delta_run_exp"].astype(float)
        df["target_source"] = "delta_run_exp"

    df["hb_mirrored"] = np.where(df["pitcherthrows_norm"] == "Right", -df["hb"], df["hb"])

    base_avgs = _build_pitcher_base_averages(df)
    df = df.merge(base_avgs, on="pitcher", how="left")

    for base in ("fastball", "sinker"):
        df[f"velo_gap_{base}"] = df["relspeed"] - df[f"base_velo_{base}"]
        df[f"ivb_sep_{base}"] = df["ivb"] - df[f"base_ivb_{base}"]
        df[f"hb_sep_{base}"] = df["hb_mirrored"] - df[f"base_hb_mirrored_{base}"]

    df["source"] = source
    return df


def main() -> int:
    settings = get_settings()
    # Separate connection per fetch, autocommit -- the LEAGUE fetch alone
    # takes ~2 minutes, and the pandas processing between fetches (no DB
    # calls) was leaving a shared connection idle-in-transaction long enough
    # to trip Neon's idle-in-transaction timeout before the PRO query ran.
    league_cache = os.path.join(OUTPUT_DIR, "_raw_league_cache.parquet")
    if os.path.exists(league_cache):
        print(f"[extract] Reusing cached LEAGUE raw fetch: {league_cache}")
        league_raw = pd.read_parquet(league_cache)
    else:
        with psycopg.connect(settings.database_url, autocommit=True) as conn:
            league_raw = _fetch_league(conn)
        league_raw.to_parquet(league_cache, index=False)
    league_df = process_source(league_raw, "league")

    pro_cache = os.path.join(OUTPUT_DIR, "_raw_pro_cache.parquet")
    if os.path.exists(pro_cache):
        print(f"[extract] Reusing cached PRO raw fetch: {pro_cache}")
        pro_raw = pd.read_parquet(pro_cache)
    else:
        with psycopg.connect(settings.database_url, autocommit=True) as conn:
            pro_raw = _fetch_pro(conn)
        pro_raw.to_parquet(pro_cache, index=False)
    pro_df = process_source(pro_raw, "pro")

    combined = pd.concat([league_df, pro_df], ignore_index=True)
    print(f"[extract] Combined rows after pitch-type/hand filtering: {len(combined)}")
    print("[extract] Rows by pitch_type:")
    print(combined["pitch_type"].value_counts())
    print("[extract] Rows by level:")
    print(combined["level"].value_counts())
    print(f"[extract] Overall CSW rate: {combined['csw'].mean():.4f}")

    for pitch_type in PITCH_TYPES:
        subset = combined[combined["pitch_type"] == pitch_type].copy()
        out_path = os.path.join(OUTPUT_DIR, f"{pitch_type.lower()}.parquet")
        subset.to_parquet(out_path, index=False)
        print(f"[extract] Wrote {len(subset)} rows -> {out_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
