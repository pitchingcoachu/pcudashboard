#!/usr/bin/env python3
"""
Command+ -- pitcher-level aggregation + training.

Sibling of dashboard_api/stuff2_training/aggregate_and_train.py. Same
pitcher x level aggregate-then-train approach (per-pitch outcomes are too
noisy on their own -- see that module's docstring for the full rationale,
verified there and not re-derived here), trained on LOCATION + CONTEXT
features (plate_side_mirrored, plate_height, balls, strikes, batter hand,
level) instead of pitch shape.

Target is RUN VALUE (extract_dataset.py's `target` column: PRO's real
delta_run_exp, LEAGUE's PV/100 linear-weights value, both sign-adjusted so
higher = better for the pitcher), NOT whiff-rate-on-swings like Stuff+ 2.0
uses. Whiff-rate-on-swings is the wrong target for a LOCATION model: it
only measures pitches that got swung at, and swing-or-not is itself the
main signal of location quality -- verified directly during development
that it scored a pitch thrown 2.5ft outside the zone HIGHER than a
well-located down-and-away corner pitch, because the few chases an
obviously-not-competitive pitch draws are disproportionately whiffs,
while a genuinely well-located pitch draws more contact (which counts
against it under a whiff-only target) simply because it's competitive.
Run value scores every pitch -- ball, called strike, chase-whiff, contact
-- on one consistent scale, so it doesn't have that conditioning bias.

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
LEVELS = ["D1", "D2", "D3", "JUCO", "NAIA", "AAA", "MLB"]

# No pitch-shape features and no fastball/sinker-relative separation
# features here (that's Stuff+ 2.0's job) -- Command+ is scoped purely to
# location + the context that changes what a "good" location is.
#
# edge_dist_h/edge_dist_v (zone-relative distance-to-nearest-edge, signed
# positive=inside/negative=outside -- see extract_dataset.py's
# _edge_distance docstring) are used INSTEAD OF raw plate_side_mirrored/
# plate_height. Verified directly: with raw coordinates in the feature
# set alongside balls/strikes, the model gave location almost no weight
# (plate_side_mirrored ~2.6%, plate_height ~5.4% feature importance vs.
# balls+strikes ~62%) and its response to plate_side was nearly flat --
# essentially no location signal at all. Binning real run-value by
# edge-distance instead shows the physically-expected shape (best near
# the zone edge, worse toward dead-center or deep outside), so the
# engineered feature gives the model something real to find.
FEATURES = ["edge_dist_h", "edge_dist_v", "balls", "strikes"]

MIN_PITCHES_BY_TYPE = {
    "Fastball": 20, "Sinker": 20, "Cutter": 15, "Slider": 20,
    "Sweeper": 15, "Curveball": 15, "ChangeUp": 15, "Splitter": 10,
}
MIN_PITCHERS_TO_TRAIN = 100

# Same points-per-SD calibration scale as Stuff+ 2.0 (see that module's
# long comment for why 12 was too gentle in practice) -- kept identical so
# Command+ and Stuff+ scores are on a directly comparable 100-average scale.
POINTS_PER_SD = 30.0

# Same MLB position-player data-quality issue as Stuff+ 2.0 (see that
# module's long comment) applies here too -- a position player's PITCH
# LOCATION during a mop-up appearance is just as unrepresentative of real
# MLB command as their pitch shape is, so the same velocity-based filter
# (checked against Stuff+ 2.0's already-extracted fastball/sinker data,
# not re-derived here) is reused unchanged.
MLB_REAL_PITCHER_VELO_FLOOR = 84.0


def _mlb_real_pitchers() -> set[str]:
    """Reuses stuff2_training's already-extracted fastball/sinker parquet
    files (same DB, same rows, already cached on disk) purely to compute
    the real-pitcher velocity filter -- Command+'s own extracted data has
    no velocity column at all (by design, it's location-only), so this is
    the one place command_training reaches into stuff2_training's data
    directory rather than duplicating a second multi-hundred-MB fetch."""
    stuff2_data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "stuff2_training", "data")
    real: set[str] = set()
    for fname in ("fastball.parquet", "sinker.parquet"):
        path = os.path.join(stuff2_data_dir, fname)
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


def _aggregate(df: pd.DataFrame, mlb_real_pitchers: set[str], min_pitches: int) -> pd.DataFrame:
    df = df.copy()

    is_mlb = df["level"] == "MLB"
    is_real_pitcher = (df["pitcher"] + "||" + df["level"]).isin(mlb_real_pitchers)
    df = df[~is_mlb | is_real_pitcher]

    # Target: run value (`target`, already sign-adjusted -- higher = better
    # for the pitcher -- by extract_dataset.py), NOT whiff-rate-on-swings.
    # Whiff-rate-on-swings is the WRONG target for a location model: it
    # only measures pitches that got swung at, and swing-or-not is itself
    # the main signal of location quality -- a pitch thrown 2.5ft outside
    # the zone is rarely swung at, but the few chases it DOES draw are
    # disproportionately whiffs (a batter fooled that badly usually misses
    # entirely), so whiff-rate-on-swings scored obvious non-competitive
    # locations as "good command" and well-located competitive pitches
    # (which draw more contact, naturally) as worse -- verified directly:
    # a pitch 2.5ft outside scored HIGHER than a down-and-away corner pitch
    # with the whiff-rate target in place. Run value scores EVERY pitch
    # (ball, called strike, chase-whiff, contact) on one consistent scale,
    # so it doesn't have this conditioning bias.
    groups = []
    for (pitcher, level), g in df.groupby(["pitcher", "level"]):
        n = len(g)
        if n < min_pitches:
            continue
        row = {
            "pitcher": pitcher,
            "level": level,
            "n_pitches": n,
            "target_value": float(g["target"].mean()),
            "batterside_norm": "",  # aggregated across both -- the "All" row
        }
        for col in FEATURES:
            row[col] = float(g[col].mean())
        groups.append(row)

        # Handedness-specific sub-rows, same as Stuff+ 2.0 -- command
        # against lefties vs righties can genuinely differ (a pitcher who
        # commands away from same-side batters well may not glove-side
        # righties as well), so the model needs to see hand-scoped rows
        # to learn platoon-specific location value via batter_hand_code.
        for hand in ("Left", "Right"):
            gh = g[g["batterside_norm"] == hand]
            if len(gh) < max(10, min_pitches // 2):
                continue
            row_h = {
                "pitcher": pitcher,
                "level": level,
                "n_pitches": len(gh),
                "target_value": float(gh["target"].mean()),
                "batterside_norm": hand,
            }
            for col in FEATURES:
                row_h[col] = float(gh[col].mean())
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


def _prep_frame(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    df = df.copy()
    df["batter_hand_code"] = df["batterside_norm"].map({"Left": -1, "Right": 1}).fillna(0).astype(int)
    for level in LEVELS:
        df[f"level_{level}"] = (df["level"] == level).astype(int)
    level_cols = [f"level_{lvl}" for lvl in LEVELS]
    all_cols = FEATURES + ["batter_hand_code"] + level_cols
    df = df.dropna(subset=FEATURES + ["target_value"])
    return df, all_cols


def _train_one(pitch_type: str, mlb_real_pitchers: set[str]) -> TrainResult | None:
    path = os.path.join(DATA_DIR, f"{pitch_type.lower()}.parquet")
    if not os.path.exists(path):
        print(f"[agg] {pitch_type}: no data file, skipping")
        return None
    raw = pd.read_parquet(path)
    min_pitches = MIN_PITCHES_BY_TYPE[pitch_type]
    agg = _aggregate(raw, mlb_real_pitchers, min_pitches)
    n_pitchers = agg["pitcher"].nunique()
    print(f"[agg] {pitch_type}: {len(agg)} aggregate rows from {n_pitchers} distinct pitchers")
    if n_pitchers < MIN_PITCHERS_TO_TRAIN:
        print(f"[agg] {pitch_type}: below {MIN_PITCHERS_TO_TRAIN}-pitcher minimum, skipping")
        return None

    df, feature_cols = _prep_frame(agg)
    X = df[feature_cols].astype(float)
    y = df["target_value"].astype(float)
    groups = df["pitcher"].astype(str)
    # weight by n_pitches (not n_swings -- target is per-PITCH run value,
    # defined for every pitch regardless of swing) so a pitcher with 300
    # tracked pitches counts more than one with 20.
    weights = df["n_pitches"].astype(float)

    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, valid_idx = next(splitter.split(X, y, groups=groups))
    X_train, X_valid = X.iloc[train_idx], X.iloc[valid_idx]
    y_train, y_valid = y.iloc[train_idx], y.iloc[valid_idx]
    w_train = weights.iloc[train_idx]

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

    # Calibration anchor ("100 = average") is computed on the TRUE
    # per-PITCH population -- every individual tracked pitch, predicted
    # and averaged directly -- NOT on the pitcher-level aggregate rows
    # used for training/fitting. Verified this distinction is NOT a minor
    # rounding difference for Command+: predicting on aggregate rows (even
    # correctly, averaged over every real aggregate row rather than a
    # synthetic median row) gave a mean prediction of -0.0018, while the
    # TRUE per-pitch mean was -0.0142 -- an order of magnitude apart,
    # because one-row-per-pitcher averaging is a fundamentally different
    # population than one-row-per-pitch averaging whenever pitch volume
    # varies across pitchers (which it always does). Real pitchers' own
    # scores are computed by averaging THEIR pitches, so the calibration
    # anchor needs to be the same kind of average to make "100" meaningful
    # -- otherwise, as observed directly, essentially no real pitcher
    # lands anywhere near 100 even though the model and shift/scale math
    # are individually correct.
    raw_features = raw.dropna(subset=FEATURES)
    level_avg_pred: dict[str, float] = {}
    level_pred_std: dict[str, float] = {}
    level_n: dict[str, int] = {}
    for level in LEVELS:
        agg_level_rows = df[(df["level"] == level) & (df["batterside_norm"] == "")]
        if len(agg_level_rows) < 20:
            continue
        pitch_level_rows = raw_features[raw_features["level"] == level]
        if len(pitch_level_rows) < 20:
            continue
        pred_chunks = []
        X_level = pitch_level_rows[FEATURES].copy()
        X_level["batter_hand_code"] = 0
        for lvl in LEVELS:
            X_level[f"level_{lvl}"] = 1 if lvl == level else 0
        X_level = X_level[feature_cols].astype(float).to_numpy()
        # Predict in chunks -- predicting the full ~1.2M-row MLB fastball
        # set in one call segfaulted during development on this xgboost
        # build; chunking avoided it and costs nothing (predict is O(n)).
        for start in range(0, len(X_level), 50_000):
            pred_chunks.append(model.predict(X_level[start:start + 50_000]))
        preds = np.concatenate(pred_chunks) if pred_chunks else np.array([])
        level_avg_pred[level] = float(preds.mean()) if len(preds) else 0.0
        # Model's own per-PITCH prediction spread at this level -- used as
        # the scale denominator instead of target_std (see main()'s
        # calibration-scale comment; same fix as stuff2_training).
        level_pred_std[level] = float(preds.std()) if len(preds) else 0.0
        level_n[level] = int(len(agg_level_rows))

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
    mlb_real_pitchers = _mlb_real_pitchers()
    print(f"[agg] MLB real-pitcher filter: {len(mlb_real_pitchers)} (pitcher, level) rows kept")

    results: list[TrainResult] = []
    for pitch_type in PITCH_TYPES:
        result = _train_one(pitch_type, mlb_real_pitchers)
        if result is not None:
            results.append(result)

    calibration = {
        "target": "run_value_pro_delta_run_exp_league_pv100",
        "aggregation": "pitcher_x_level (plus batter-hand-specific sub-rows)",
        "feature_columns": FEATURES,
        "levels": LEVELS,
        "per_pitch_type": {},
    }
    for r in results:
        level_calibration = {}
        for lvl, avg in r.level_avg_pred.items():
            # Scale denominator is the geometric mean of the model's own
            # per-pitch prediction spread (level_pred_std) and the raw
            # target's spread (target_std) -- see
            # stuff2_training/aggregate_and_train.py's identical fix and
            # comment for the full rationale: dividing by target_std alone
            # silently compresses the visible score spread (most of it is
            # real per-pitcher noise the model doesn't/shouldn't predict),
            # but dividing by pred_std alone overcorrects (verified on
            # Stuff+ 2.0: real MLB pitchers spread from 37.7 to 229.9,
            # implausibly wide) since pred_std is the spread across
            # already-averaged pitcher rows and doesn't account for the
            # extra noise in a real, possibly-smaller individual sample.
            pred_std = r.level_pred_std.get(lvl, 0.0)
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
