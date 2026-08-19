#!/usr/bin/env python3
"""
Command+ -- training data extraction.

Sibling of dashboard_api/stuff2_training/extract_dataset.py, same sources
(pitch_events for college/LEAGUE, pro_pitch_events for PRO/MLB+AAA), same
pitch-type classification, same target definition (PRO: real
delta_run_exp; LEAGUE: PV/100's underlying linear-weights value via
main.py's own _calc_pitch_value, imported directly) -- but the FEATURES
are location + context (plate_side, plate_height, balls, strikes, batter
hand, level) instead of pitch shape (velocity, movement, spin). Command+
is meant to answer "how good was this location, given the count/pitch
type/batter hand," independent of how nasty the pitch's shape is -- that
question is what Stuff+ 2.0 already answers.

LEAGUE's platelocside/platelocheight are stored as TEXT (unlike relspeed,
which has a pre-computed relspeed_num generated column) -- extracted here
with the SAME regex pattern Postgres itself uses for relspeed_num
(confirmed via information_schema.columns.generation_expression), so the
parsing is provably identical to the one already-proven-correct numeric
cast elsewhere in this schema.

Output: one parquet file per pitch type under command_training/data/,
containing plate_side/plate_height/balls/strikes/batter hand/level +
target/target_source/csw.

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

# Identical to stuff2_training/extract_dataset.py's _PITCH_TYPE_MAP -- kept
# as its own copy (not imported) so this script has no dependency on the
# Stuff+ 2.0 training pipeline and can be run/maintained independently.
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

# Same strike-zone boundaries the dashboard itself uses (main.py's
# ZONE_LEFT/RIGHT/BOTTOM/TOP) -- kept as a literal copy rather than
# imported, since main.py's constants aren't in a lightweight-importable
# location and this is a fixed, essentially-never-changing rule definition.
ZONE_LEFT = -0.88
ZONE_RIGHT = 0.88
ZONE_BOTTOM = 1.5
ZONE_TOP = 3.6

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


def _edge_distance(coord: pd.Series, low: float, high: float) -> pd.Series:
    """Signed distance to the nearest zone edge along ONE axis: positive
    and larger = further inside the zone (safely away from either edge,
    e.g. dead-center); positive and small = just inside, near an edge;
    negative = outside the zone, more negative the further outside.

    This exists because raw plate_side/plate_height turned out to carry
    almost no signal on their own once balls/strikes are also in the
    model (feature importance ~2-5% vs. balls/strikes' ~60% combined) --
    verified directly: the raw-coordinate model was nearly flat across
    plate_side and had a non-monotonic, physically-nonsensical response
    to plate_height. Binning actual run-value by THIS edge-distance
    feature instead shows the expected real shape: value rises sharply
    from deep-outside up through the edge, peaks just inside near the
    edge (the classic "corner" location), then declines again toward
    the exact middle of the zone -- i.e. corners good, middle bad, both
    outside-the-zone extremes bad, matching real scouting intuition."""
    return np.minimum(coord - low, high - coord)


def _fetch_league(conn) -> pd.DataFrame:
    print("[extract] Fetching LEAGUE rows...")
    t0 = time.monotonic()
    # platelocside_num/platelocheight_num don't exist as generated columns
    # (confirmed via information_schema.columns) -- extracted inline here
    # with the SAME regex Postgres itself uses for relspeed_num (confirmed
    # via generation_expression), so this parsing is provably identical to
    # an already-proven-correct numeric cast on this schema.
    sql = """
        SELECT
          pitcher, taggedpitchtype, pitchcall, pitcherthrows, batterside,
          level, school_code, balls, strikes,
          ((regexp_match(COALESCE(platelocside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1])::double precision AS plate_side,
          ((regexp_match(COALESCE(platelocheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1])::double precision AS plate_height,
          playresult, korbb, outsonplay
        FROM public.pitch_events
        WHERE school_code = 'LEAGUE'
          AND level IN ('D1', 'D2', 'D3', 'JUCO', 'NAIA')
          AND platelocside IS NOT NULL AND platelocheight IS NOT NULL
          AND pitcherthrows IS NOT NULL AND pitchcall IS NOT NULL
          AND balls IS NOT NULL AND strikes IS NOT NULL
    """
    with conn.cursor(row_factory=dict_row) as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    df = pd.DataFrame(rows)
    print(f"[extract] LEAGUE: {len(df)} rows in {time.monotonic() - t0:.1f}s")
    for col in ("plate_side", "plate_height", "balls", "strikes"):
        df[col] = _to_num(df[col])
    df = df[df["plate_side"].notna() & df["plate_height"].notna()]
    df["level"] = df["level"].astype(str)
    return df


def _fetch_pro(conn) -> pd.DataFrame:
    print("[extract] Fetching PRO rows...")
    t0 = time.monotonic()
    # Only rows with a REAL delta_run_exp -- no fallback to any estimated
    # value, matching stuff2_training's same PRO target policy.
    sql = """
        SELECT
          pitcher, taggedpitchtype, pitchcall, pitcherthrows, batterside,
          school_code, pitcherteam, sport_id, delta_run_exp,
          balls, strikes,
          platelocside AS plate_side, platelocheight AS plate_height
        FROM public.pro_pitch_events
        WHERE school_code = 'PRO'
          AND platelocside IS NOT NULL AND platelocheight IS NOT NULL
          AND pitcherthrows IS NOT NULL AND pitchcall IS NOT NULL
          AND balls IS NOT NULL AND strikes IS NOT NULL
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


def process_source(df: pd.DataFrame, source: str) -> pd.DataFrame:
    df["pitch_type"] = df["taggedpitchtype"].map(_pitch_family)
    df["pitcherthrows_norm"] = df["pitcherthrows"].map(_norm_hand)
    df["batterside_norm"] = df["batterside"].map(_norm_hand)
    df = df[df["pitch_type"] != "Other"]
    df = df[df["pitcherthrows_norm"].isin(["Left", "Right"])]
    # Sane physical bounds -- drops obvious bad-tracking rows (e.g. a
    # plate_side/plate_height reading of 0 from a failed capture) without
    # touching legitimately extreme-but-real locations.
    df = df[df["balls"].between(0, 3) & df["strikes"].between(0, 2)]
    df = df[df["plate_side"].between(-4, 4) & df["plate_height"].between(-2, 8)]

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
        # Same sign flip as stuff2_training: _calc_pitch_value defines
        # positive as favoring the HITTER, so negate -> higher target =
        # better for the pitcher (i.e. a better-located pitch).
        df["target"] = -df["target"]
        df["target_source"] = "pv100"
    else:
        df = _label_csw(df, _PRO_VALID_CALLS, _PRO_CSW_CALLS)
        df["target"] = -df["delta_run_exp"].astype(float)
        df["target_source"] = "delta_run_exp"

    # Mirror plate_side to a single handedness convention (righty-space,
    # same convention stuff2_training uses for hb_mirrored) so a location
    # feature means the same thing regardless of which arm the pitcher
    # throws with -- e.g. "glove-side" is always the same sign.
    df["plate_side_mirrored"] = np.where(df["pitcherthrows_norm"] == "Right", -df["plate_side"], df["plate_side"])

    # Zone-relative edge-distance features (see _edge_distance's docstring
    # for why raw coordinates alone don't work) -- the model's actual
    # location inputs.
    df["edge_dist_h"] = _edge_distance(df["plate_side_mirrored"], ZONE_LEFT, ZONE_RIGHT)
    df["edge_dist_v"] = _edge_distance(df["plate_height"], ZONE_BOTTOM, ZONE_TOP)

    df["source"] = source
    return df


def main() -> int:
    settings = get_settings()
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
