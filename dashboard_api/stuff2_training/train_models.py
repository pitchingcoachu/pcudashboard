#!/usr/bin/env python3
"""
Stuff+ 2.0 -- model training.

Trains one XGBoost regressor per pitch type, predicting a per-pitch
outcome-value TARGET from real pitch characteristics -- no hand-set target
shapes, no hardcoded separation constants:

  - PRO rows: real Statcast delta_run_exp (negated so higher = better for
    the pitcher), measured outcome data, no heuristic fallback.
  - LEAGUE (college) rows: PV/100's underlying linear-weights pitch value
    (negated the same way), computed via main.py's own _calc_pitch_value().

Off-speed pitch types get additional fastball/sinker-relative features
(velo gap, IVB/HB separation from the SAME pitcher's own average
fastball/sinker) so they're graded in relation to that pitcher's own
arsenal, not in a vacuum.

Level (D1/D2/D3/JUCO/NAIA/AAA/MLB) and batter handedness are both included
as model INPUT features (not separate models) -- see the plan discussion:
this lets the model share learning across levels/handedness splits rather
than fragmenting already-limited data (e.g. NAIA Splitter) into unusably
small buckets.

After fitting, predictions are calibrated so each level's own average
predicted target (holding all else at that level's typical values) maps to
Stuff+ 2.0 = 100, matching the existing Stuff+ / Ctrl+ "100 = average"
convention in this codebase. Since target scale differs materially between
delta_run_exp (PRO) and pv100 (LEAGUE), calibration is computed and applied
per level independently -- there is no cross-source rescaling assumption.

Usage:
  python3 train_models.py
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
from sklearn.metrics import mean_squared_error

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

MIN_ROWS_TO_TRAIN = 500


@dataclass
class TrainResult:
    pitch_type: str
    n_rows: int
    n_train: int
    n_valid: int
    rmse: float
    target_std: float
    corr: float
    level_avg_pred: dict
    level_n: dict


def _feature_columns(pitch_type: str) -> list[str]:
    cols = list(BASE_FEATURES)
    if pitch_type in OFFSPEED_TYPES:
        cols += OFFSPEED_EXTRA_FEATURES
    return cols


def _prep_frame(df: pd.DataFrame, pitch_type: str) -> tuple[pd.DataFrame, list[str]]:
    feature_cols = _feature_columns(pitch_type)
    df = df.copy()

    df["batter_hand_code"] = df["batterside_norm"].map({"Left": -1, "Right": 1}).fillna(0).astype(int)
    for level in LEVELS:
        df[f"level_{level}"] = (df["level"] == level).astype(int)
    level_cols = [f"level_{lvl}" for lvl in LEVELS]

    all_feature_cols = feature_cols + ["batter_hand_code"] + level_cols

    required = feature_cols
    df = df.dropna(subset=required + ["target"])
    return df, all_feature_cols


def _train_one(pitch_type: str) -> TrainResult | None:
    path = os.path.join(DATA_DIR, f"{pitch_type.lower()}.parquet")
    if not os.path.exists(path):
        print(f"[train] {pitch_type}: no data file at {path}, skipping")
        return None
    df = pd.read_parquet(path)
    df, feature_cols = _prep_frame(df, pitch_type)
    n_rows = len(df)
    print(f"[train] {pitch_type}: {n_rows} usable rows (target_source counts: {df['target_source'].value_counts().to_dict()})")
    if n_rows < MIN_ROWS_TO_TRAIN:
        print(f"[train] {pitch_type}: below {MIN_ROWS_TO_TRAIN}-row minimum, skipping")
        return None

    X = df[feature_cols].astype(float)
    y = df["target"].astype(float)
    groups = df["pitcher"].astype(str)

    # Group-split by PITCHER, not by row -- otherwise the same pitcher's
    # pitches leak across train/validation and the model looks better than
    # it really is at generalizing to a pitcher it hasn't seen.
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    train_idx, valid_idx = next(splitter.split(X, y, groups=groups))
    X_train, X_valid = X.iloc[train_idx], X.iloc[valid_idx]
    y_train, y_valid = y.iloc[train_idx], y.iloc[valid_idx]

    model = xgb.XGBRegressor(
        n_estimators=400,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=30,
        objective="reg:squarederror",
        eval_metric="rmse",
        early_stopping_rounds=25,
        n_jobs=4,
    )
    t0 = time.monotonic()
    model.fit(X_train, y_train, eval_set=[(X_valid, y_valid)], verbose=False)
    print(f"[train] {pitch_type}: fit in {time.monotonic() - t0:.1f}s, best_iteration={model.best_iteration}")

    pred_valid = model.predict(X_valid)
    rmse = float(mean_squared_error(y_valid, pred_valid) ** 0.5)
    target_std = float(y_valid.std())
    # Correlation between predicted and actual target on held-out pitchers --
    # the real signal-quality check. A model with zero real skill would
    # correlate near 0; RMSE alone can look deceptively small if the target
    # itself has low variance, so report both.
    corr = float(np.corrcoef(pred_valid, y_valid)[0, 1]) if len(y_valid) > 1 else float("nan")
    print(f"[train] {pitch_type}: RMSE={rmse:.4f} target_std={target_std:.4f} corr(pred,actual)={corr:.4f}")

    # Calibration: for each level, predict the target using that level's
    # real median feature values (holding batter_hand at 0/"All") and
    # compute the multiplier so that level's average pitch scores
    # Stuff+2.0 = 100. Per-level, per-pitch-type -- no cross-source
    # (delta_run_exp vs pv100) rescaling assumption.
    level_avg_pred: dict[str, float] = {}
    level_n: dict[str, int] = {}
    for level in LEVELS:
        level_rows = df[df["level"] == level]
        if len(level_rows) < 50:
            continue
        medians = level_rows[feature_cols].median()
        level_avg_pred[level] = float(model.predict(pd.DataFrame([medians]))[0])
        level_n[level] = int(len(level_rows))

    model.save_model(os.path.join(MODEL_DIR, f"{pitch_type.lower()}.json"))

    return TrainResult(
        pitch_type=pitch_type,
        n_rows=n_rows,
        n_train=len(X_train),
        n_valid=len(X_valid),
        rmse=rmse,
        target_std=target_std,
        corr=corr,
        level_avg_pred=level_avg_pred,
        level_n=level_n,
    )


def main() -> int:
    results: list[TrainResult] = []
    for pitch_type in PITCH_TYPES:
        result = _train_one(pitch_type)
        if result is not None:
            results.append(result)

    calibration = {
        "feature_columns_base": BASE_FEATURES,
        "feature_columns_offspeed_extra": OFFSPEED_EXTRA_FEATURES,
        "levels": LEVELS,
        "per_pitch_type": {},
    }
    for r in results:
        # Multiplier such that a pitch predicted at that level's average
        # target lands on Stuff+2.0 = 100. avg_pred can be negative (a bad
        # average pitch) or straddle zero, so this is an ADDITIVE shift to
        # zero-center on the level average, then scaled to a ~100-anchored,
        # ~10-15pt-per-SD spread using target_std as the scale reference
        # (matches "1 SD =~ 10-15 Stuff+ points" the way public Stuff+
        # models are typically described) rather than a pure multiplicative
        # scale, which breaks when avg_pred is near zero.
        level_calibration = {}
        for lvl, avg in r.level_avg_pred.items():
            level_calibration[lvl] = {
                "avg_pred": avg,
                "n": r.level_n.get(lvl, 0),
                "shift": -avg,
                "scale": 12.0 / max(r.target_std, 1e-6),
            }
        calibration["per_pitch_type"][r.pitch_type] = {
            "n_rows": r.n_rows,
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
        print(f"  {r.pitch_type}: n={r.n_rows} RMSE={r.rmse:.4f} target_std={r.target_std:.4f} corr={r.corr:.4f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
