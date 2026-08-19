#!/usr/bin/env python3
"""
Stuff+ 2.0 -- pitcher-level aggregation + training.

Per-pitch outcomes (whether CSW%, run value, or PV/100) turned out to be
dominated by noise unrelated to pitch shape -- what the batter decided to
do, where a batted ball happened to land, defense. Tested three targets at
the per-pitch level (CSW%, PRO real delta_run_exp, college PV/100); all
came back with held-out correlation in the 0.00-0.07 range, confirming this
is a noise problem inherent to single-pitch outcomes, not a target-choice
problem.

This script aggregates to PITCHER x PITCH TYPE instead: for each pitcher's
pitches of a given type (minimum pitch count enforced per pitch type, see
MIN_PITCHES_BY_TYPE), compute their AVERAGE pitch characteristics and their
AVERAGE whiff rate on swings, then train on THAT. Averaging over enough
real pitches lets contact-luck/defense/sequencing noise cancel out while
the real "how nasty is this guy's slider" signal remains -- this is the
standard way public Stuff+-style models handle the same noise problem.

Target: whiff rate on swings (swinging strikes / all swings), the
lowest-noise per-pitch outcome tested so far and the standard proxy for
"raw stuff" when true run value isn't usable. Same target for both PRO and
LEAGUE this time (no source-specific target split) for consistency and
because whiff-rate is directly comparable across both.

Usage:
  python3 aggregate_and_train.py
"""

from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass

import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import GroupShuffleSplit

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
os.makedirs(MODEL_DIR, exist_ok=True)

PITCH_TYPES = ["Fastball", "Sinker", "Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"]
OFFSPEED_TYPES = {"Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"}
LEVELS = ["D1", "D2", "D3", "JUCO", "NAIA", "AAA", "MLB"]

BASE_FEATURES = ["relspeed", "ivb", "hb_mirrored", "spinrate", "extension", "relheight", "relside"]
OFFSPEED_EXTRA_FEATURES = [
    "velo_gap_fastball", "ivb_sep_fastball", "hb_sep_fastball",
    "velo_gap_sinker", "ivb_sep_sinker", "hb_sep_sinker",
]

# Lower minimum for pitch types with fewer total pitchers (Splitter, Sweeper)
# so the training set isn't gutted -- still enough pitches for the average
# whiff rate to be meaningfully more stable than a single pitch.
MIN_PITCHES_BY_TYPE = {
    "Fastball": 20, "Sinker": 20, "Cutter": 15, "Slider": 20,
    "Sweeper": 15, "Curveball": 15, "ChangeUp": 15, "Splitter": 10,
}
MIN_PITCHERS_TO_TRAIN = 100

# How many Stuff+ points one standard deviation of predicted whiff-rate
# spread is worth -- see the long comment at its point of use in main()
# below for why 12 (the original value) was too gentle in practice.
POINTS_PER_SD = 30.0

# MLB-only: pro_pitch_events has no position/role column, so a position
# player's mop-up-duty "pitching" appearance (e.g. a shortstop lobbing a
# 60mph fastball in a blowout) is indistinguishable from a real pitcher's
# row by any single column except velocity. Verified against the actual
# training data: real MLB pitchers' own average Fastball/Sinker velocity
# never drops below ~85mph (softest legitimate arms -- Kyle Hendricks
# 86.5, Alek Jacob 85.2 -- start right there), while every pitcher below
# that is a recognizable position player (Gary Sanchez, Jose Trevino,
# Austin Hedges, etc.), with a clean ~2.5mph gap separating the two
# groups. Scoped to a pitcher's OWN Fastball-or-Sinker velocity (not a
# blanket per-pitch-type cutoff) so a legitimate extreme-low-velo
# specialist who doesn't throw a fastball/sinker in that range at all
# (e.g. submarine sinkerballer Tyler Rogers, whose actual Sinker sits at
# 83.4mph but who has only 1 tracked Fastball pitch -- never reaches the
# 20-pitch minimum to even form a Fastball row) is judged by his real
# pitch, not misclassified by a pitch type he barely throws.
MLB_REAL_PITCHER_VELO_FLOOR = 84.0


def _mlb_real_pitchers(data_dir: str) -> set[str]:
    """(pitcher, level) pairs -- keyed as f"{pitcher}||{level}" -- whose own
    average Fastball or Sinker velocity at that level clears
    MLB_REAL_PITCHER_VELO_FLOOR. Only MLB rows are checked (this is an
    MLB-specific data quality issue); every non-MLB (pitcher, level) pair
    is always considered real, since college/LEAGUE data doesn't have this
    position-player-appearance problem."""
    real: set[str] = set()
    for fname in ("fastball.parquet", "sinker.parquet"):
        path = os.path.join(data_dir, fname)
        if not os.path.exists(path):
            continue
        df = pd.read_parquet(path, columns=["pitcher", "level", "relspeed"])
        mlb = df[df["level"] == "MLB"]
        if mlb.empty:
            continue
        avg_velo = mlb.groupby("pitcher")["relspeed"].mean()
        for pitcher, velo in avg_velo.items():
            if velo >= MLB_REAL_PITCHER_VELO_FLOOR:
                real.add(f"{pitcher}||MLB")
    return real

_LEAGUE_SWING_CALLS = {"StrikeSwinging", "FoulBallNotFieldable", "FoulBallFieldable", "InPlay"}
_LEAGUE_WHIFF_CALLS = {"StrikeSwinging"}
_PRO_SWING_CALLS = {
    "Foul", "Swinging Strike", "In play, out(s)", "In play, no out", "In play, run(s)",
    "Foul Tip", "Swinging Strike (Blocked)", "Foul Bunt", "Missed Bunt",
}
_PRO_WHIFF_CALLS = {"Swinging Strike", "Swinging Strike (Blocked)", "Foul Tip", "Missed Bunt"}


def _feature_columns(pitch_type: str) -> list[str]:
    cols = list(BASE_FEATURES)
    if pitch_type in OFFSPEED_TYPES:
        cols += OFFSPEED_EXTRA_FEATURES
        # Presence flags so the model can tell "this pitcher has no sinker,
        # separation filled with 0 as a neutral placeholder" apart from "this
        # pitcher's sinker separation genuinely measured 0" -- without these,
        # requiring EVERY offspeed row to have both fastball AND sinker base
        # data (the original approach) silently dropped ~79% of pitchers for
        # a pitch type like Slider, since most pitchers only throw ONE of
        # fastball/sinker as their primary heater, not both.
        cols += ["has_fastball_base", "has_sinker_base"]
    return cols


def _aggregate(df: pd.DataFrame, pitch_type: str, mlb_real_pitchers: set[str]) -> pd.DataFrame:
    swing_calls = _LEAGUE_SWING_CALLS | _PRO_SWING_CALLS
    whiff_calls = _LEAGUE_WHIFF_CALLS | _PRO_WHIFF_CALLS
    df = df.copy()
    df["is_swing"] = df["pitchcall"].isin(swing_calls)
    df["is_whiff"] = df["pitchcall"].isin(whiff_calls)

    # Drop MLB position-player mop-up appearances (see MLB_REAL_PITCHER_VELO_FLOOR
    # above) before aggregating -- across ALL pitch types, not just Fastball/Sinker,
    # since a position player's slider/curveball rows are just as unrepresentative
    # of real MLB pitch quality as their fastball rows.
    is_mlb = df["level"] == "MLB"
    is_real_pitcher = (df["pitcher"] + "||" + df["level"]).isin(mlb_real_pitchers)
    df = df[~is_mlb | is_real_pitcher]

    feature_cols = _feature_columns(pitch_type)
    min_pitches = MIN_PITCHES_BY_TYPE[pitch_type]

    # Group by pitcher AND level -- a pitcher who appears at multiple levels
    # (e.g. MLB call-up mid-dataset, or transferred schools) gets a separate
    # row per level, since their "average shape" and level-relative context
    # can genuinely differ across levels; also gives every row a single,
    # unambiguous level for the batter_hand/level feature encoding below.
    # batter_hand is NOT split here (this pitch type's "All" grade) --
    # handedness-specific aggregates are built separately below.
    def _fill_row(row: dict, g: pd.DataFrame) -> None:
        for col in feature_cols:
            if col in ("has_fastball_base", "has_sinker_base"):
                continue
            row[col] = float(g[col].mean()) if col in g.columns else None
        if pitch_type in OFFSPEED_TYPES:
            # A pitcher may only throw ONE of fastball/sinker as their
            # primary heater -- requiring BOTH base_velo_fastball and
            # base_velo_sinker to be present (the original approach)
            # silently dropped ~79% of pitchers for a pitch type like
            # Slider. Zero-fill the missing side's separations (neutral,
            # not "bad") and flag which base(s) are real via
            # has_fastball_base/has_sinker_base so the model can tell
            # a genuine 0 separation apart from "no data here."
            has_fb = pd.notna(row.get("velo_gap_fastball"))
            has_si = pd.notna(row.get("velo_gap_sinker"))
            row["has_fastball_base"] = 1.0 if has_fb else 0.0
            row["has_sinker_base"] = 1.0 if has_si else 0.0
            for prefix in ("fastball", "sinker"):
                for metric in ("velo_gap", "ivb_sep", "hb_sep"):
                    key = f"{metric}_{prefix}"
                    if pd.isna(row.get(key)):
                        row[key] = 0.0

    groups = []
    for (pitcher, level), g in df.groupby(["pitcher", "level"]):
        n = len(g)
        if n < min_pitches:
            continue
        n_swings = int(g["is_swing"].sum())
        if n_swings < max(5, min_pitches // 3):
            continue
        row = {
            "pitcher": pitcher,
            "level": level,
            "n_pitches": n,
            "n_swings": n_swings,
            "whiff_rate": float(g["is_whiff"].sum()) / n_swings,
            "batterside_norm": "",  # aggregated across both -- the "All" row
        }
        _fill_row(row, g)
        # A pitcher with NEITHER a real fastball nor sinker base on record
        # is KEPT (not dropped) -- has_fastball_base=has_sinker_base=0.0
        # plus zero-filled separation features is a real, meaningful input
        # pattern ("this pitcher's offspeed pitch has no measurable
        # fastball/sinker context"), and the model needs to actually see it
        # during training to produce a calibrated score for it at inference
        # time, rather than extrapolating into an unseen input region.
        groups.append(row)

        # Handedness-specific aggregates, only when there's enough of each
        # to be meaningful -- these become ADDITIONAL rows with the same
        # pitcher/level/features but scoped to one batter side, so the
        # model still learns platoon effects via the batter_hand_code
        # feature, just on pitcher-level (not per-pitch) aggregates now.
        for hand in ("Left", "Right"):
            gh = g[g["batterside_norm"] == hand]
            if len(gh) < max(10, min_pitches // 2):
                continue
            n_swings_h = int(gh["is_swing"].sum())
            if n_swings_h < 5:
                continue
            row_h = {
                "pitcher": pitcher,
                "level": level,
                "n_pitches": len(gh),
                "n_swings": n_swings_h,
                "whiff_rate": float(gh["is_whiff"].sum()) / n_swings_h,
                "batterside_norm": hand,
            }
            _fill_row(row_h, gh)
            groups.append(row_h)

    return pd.DataFrame(groups)


@dataclass
class TrainResult:
    pitch_type: str
    n_rows: int
    n_pitchers: int
    rmse: float
    target_std: float
    corr: float
    level_avg_pred: dict
    level_pred_std: dict
    level_n: dict


def _prep_frame(df: pd.DataFrame, pitch_type: str) -> tuple[pd.DataFrame, list[str]]:
    feature_cols = _feature_columns(pitch_type)
    df = df.copy()
    df["batter_hand_code"] = df["batterside_norm"].map({"Left": -1, "Right": 1}).fillna(0).astype(int)
    for level in LEVELS:
        df[f"level_{level}"] = (df["level"] == level).astype(int)
    level_cols = [f"level_{lvl}" for lvl in LEVELS]
    all_cols = feature_cols + ["batter_hand_code"] + level_cols
    df = df.dropna(subset=feature_cols + ["whiff_rate"])
    return df, all_cols


def _train_one(pitch_type: str, mlb_real_pitchers: set[str]) -> TrainResult | None:
    path = os.path.join(DATA_DIR, f"{pitch_type.lower()}.parquet")
    if not os.path.exists(path):
        print(f"[agg] {pitch_type}: no data file, skipping")
        return None
    raw = pd.read_parquet(path)
    agg = _aggregate(raw, pitch_type, mlb_real_pitchers)
    n_pitchers = agg["pitcher"].nunique()
    print(f"[agg] {pitch_type}: {len(agg)} aggregate rows from {n_pitchers} distinct pitchers")
    if n_pitchers < MIN_PITCHERS_TO_TRAIN:
        print(f"[agg] {pitch_type}: below {MIN_PITCHERS_TO_TRAIN}-pitcher minimum, skipping")
        return None

    df, feature_cols = _prep_frame(agg, pitch_type)
    X = df[feature_cols].astype(float)
    y = df["whiff_rate"].astype(float)
    groups = df["pitcher"].astype(str)
    # weight by n_swings so a pitcher with 300 swings counts more than one
    # with 8 -- their average whiff rate is a more reliable estimate.
    weights = df["n_swings"].astype(float)

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, valid_idx = next(splitter.split(X, y, groups=groups))
    X_train, X_valid = X.iloc[train_idx], X.iloc[valid_idx]
    y_train, y_valid = y.iloc[train_idx], y.iloc[valid_idx]
    w_train = weights.iloc[train_idx]

    # Shallower trees, fewer estimators than the per-pitch attempt -- far
    # fewer training ROWS now (pitcher-level, not pitch-level), so a big
    # model would just overfit.
    model = xgb.XGBRegressor(
        n_estimators=200,
        max_depth=3,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        objective="reg:squarederror",
        eval_metric="rmse",
        early_stopping_rounds=20,
        n_jobs=4,
    )
    t0 = time.monotonic()
    model.fit(X_train, y_train, sample_weight=w_train, eval_set=[(X_valid, y_valid)], verbose=False)
    print(f"[train] {pitch_type}: fit in {time.monotonic() - t0:.1f}s, best_iteration={model.best_iteration}")

    pred_valid = model.predict(X_valid)
    rmse = float(((pred_valid - y_valid) ** 2).mean() ** 0.5)
    target_std = float(y_valid.std())
    corr = float(np.corrcoef(pred_valid, y_valid)[0, 1]) if len(y_valid) > 1 else float("nan")
    print(f"[train] {pitch_type}: n_valid={len(y_valid)} RMSE={rmse:.4f} target_std={target_std:.4f} corr(pred,actual)={corr:.4f}")

    level_avg_pred: dict[str, float] = {}
    level_pred_std: dict[str, float] = {}
    level_n: dict[str, int] = {}
    for level in LEVELS:
        level_rows = df[(df["level"] == level) & (df["batterside_norm"] == "")]
        if len(level_rows) < 20:
            continue
        # Predict on every REAL aggregate row for this level and average
        # the predictions -- NOT predict once on a single synthetic row
        # built from each feature's median independently. The latter (the
        # original approach here) silently assumes the median of every
        # feature co-occurs in one real pitcher, which doesn't generally
        # hold when features are correlated -- verified directly: for
        # Fastball/MLB the median-row prediction was 0.194 vs. the true
        # mean-of-real-rows prediction of 0.214, a ~10% relative gap (see
        # command_training/aggregate_and_train.py for a case, same root
        # bug, where this produced a much larger and more visible error).
        preds = model.predict(level_rows[feature_cols].astype(float))
        level_avg_pred[level] = float(preds.mean())
        # Also capture the model's OWN prediction spread at this level (not
        # just its mean) -- see main()'s calibration-scale comment for why
        # this replaces target_std as the scale denominator.
        level_pred_std[level] = float(preds.std())
        level_n[level] = int(len(level_rows))

    model.save_model(os.path.join(MODEL_DIR, f"{pitch_type.lower()}.json"))

    return TrainResult(
        pitch_type=pitch_type,
        n_rows=len(df),
        n_pitchers=n_pitchers,
        rmse=rmse,
        target_std=target_std,
        corr=corr,
        level_avg_pred=level_avg_pred,
        level_pred_std=level_pred_std,
        level_n=level_n,
    )


def main() -> int:
    mlb_real_pitchers = _mlb_real_pitchers(DATA_DIR)
    print(f"[agg] MLB real-pitcher filter: {len(mlb_real_pitchers)} (pitcher, level) rows kept")

    results: list[TrainResult] = []
    for pitch_type in PITCH_TYPES:
        result = _train_one(pitch_type, mlb_real_pitchers)
        if result is not None:
            results.append(result)

    calibration = {
        "target": "whiff_rate_on_swings",
        "aggregation": "pitcher_x_level (plus batter-hand-specific sub-rows)",
        "feature_columns_base": BASE_FEATURES,
        "feature_columns_offspeed_extra": OFFSPEED_EXTRA_FEATURES,
        "levels": LEVELS,
        "per_pitch_type": {},
    }
    for r in results:
        level_calibration = {}
        for lvl, avg in r.level_avg_pred.items():
            pred_std = r.level_pred_std.get(lvl, 0.0)
            # Scale denominator is the GEOMETRIC MEAN of pred_std (the
            # model's own prediction spread) and target_std (the raw
            # target's spread) -- not either alone. Dividing by target_std
            # (the original approach) silently compressed the visible
            # score spread: most of target_std is real per-pitcher noise
            # the model correctly does NOT predict (corr~0.33 for
            # Fastball), so "30 points per SD" was only worth ~11-12
            # points per SD of what the model actually outputs. But
            # dividing by pred_std alone (tried first) overcorrected --
            # verified directly: real MLB pitchers ranged from 37.7 to
            # 229.9, far wider than any public Stuff+-style model shows,
            # because pred_std is the spread across already-averaged
            # PITCHER rows, and applying that raw scale to noisier
            # individual real-pitcher estimates blows up small-sample
            # variance along with genuine signal. The geometric mean is a
            # standard, principled middle ground between "trust the
            # model's full achievable spread" and "trust the raw
            # (noise-inflated) target spread," landing the calibration
            # between the two failure modes observed on either side.
            std_for_scale = (pred_std * r.target_std) ** 0.5 if pred_std > 0 and r.target_std > 0 else max(pred_std, r.target_std, 1e-6)
            level_calibration[lvl] = {
                "avg_pred": avg,
                "n": r.level_n.get(lvl, 0),
                "shift": -avg,
                "scale": (POINTS_PER_SD / max(std_for_scale, 1e-6)),
            }
        calibration["per_pitch_type"][r.pitch_type] = {
            "n_rows": r.n_rows,
            "n_pitchers": r.n_pitchers,
            "rmse": r.rmse,
            "target_std": r.target_std,
            "corr": r.corr,
            "level_calibration": level_calibration,
        }

    calibration_path = os.path.join(MODEL_DIR, "calibration.json")
    with open(calibration_path, "w") as f:
        json.dump(calibration, f, indent=2)
    print(f"[train] Wrote calibration -> {calibration_path}")

    print("\n[train] Summary:")
    for r in results:
        print(f"  {r.pitch_type}: n_rows={r.n_rows} n_pitchers={r.n_pitchers} RMSE={r.rmse:.4f} target_std={r.target_std:.4f} corr={r.corr:.4f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
