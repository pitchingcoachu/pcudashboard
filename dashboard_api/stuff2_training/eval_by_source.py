#!/usr/bin/env python3
"""Evaluate the already-trained Stuff+ 2.0 models' correlation separately
for PRO (delta_run_exp) vs LEAGUE (pv100) rows, using the SAME held-out
pitcher split logic as training, so results are apples-to-apples with the
combined numbers already reported."""
import os
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.model_selection import GroupShuffleSplit

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
MODEL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")

PITCH_TYPES = ["Fastball", "Sinker", "Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"]
OFFSPEED_TYPES = {"Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"}
LEVELS = ["D1", "D2", "D3", "JUCO", "NAIA", "AAA", "MLB"]
BASE_FEATURES = ["relspeed", "ivb", "hb_mirrored", "spinrate", "extension", "relheight", "relside"]
OFFSPEED_EXTRA_FEATURES = [
    "velo_gap_fastball", "ivb_sep_fastball", "hb_sep_fastball",
    "velo_gap_sinker", "ivb_sep_sinker", "hb_sep_sinker",
]


def _feature_columns(pitch_type):
    cols = list(BASE_FEATURES)
    if pitch_type in OFFSPEED_TYPES:
        cols += OFFSPEED_EXTRA_FEATURES
    return cols


for pitch_type in PITCH_TYPES:
    path = os.path.join(DATA_DIR, f"{pitch_type.lower()}.parquet")
    model_path = os.path.join(MODEL_DIR, f"{pitch_type.lower()}.json")
    if not (os.path.exists(path) and os.path.exists(model_path)):
        continue
    df = pd.read_parquet(path)
    feature_cols = _feature_columns(pitch_type)
    df["batter_hand_code"] = df["batterside_norm"].map({"Left": -1, "Right": 1}).fillna(0).astype(int)
    for level in LEVELS:
        df[f"level_{level}"] = (df["level"] == level).astype(int)
    level_cols = [f"level_{lvl}" for lvl in LEVELS]
    all_cols = feature_cols + ["batter_hand_code"] + level_cols
    df = df.dropna(subset=feature_cols + ["target"])

    X = df[all_cols].astype(float)
    y = df["target"].astype(float)
    groups = df["pitcher"].astype(str)
    splitter = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=42)
    _, valid_idx = next(splitter.split(X, y, groups=groups))
    valid = df.iloc[valid_idx]
    X_valid = X.iloc[valid_idx]

    model = xgb.XGBRegressor()
    model.load_model(model_path)
    pred = model.predict(X_valid)
    valid = valid.assign(pred=pred)

    for source in ("delta_run_exp", "pv100"):
        sub = valid[valid["target_source"] == source]
        if len(sub) < 50:
            continue
        corr = np.corrcoef(sub["pred"], sub["target"])[0, 1]
        print(f"{pitch_type:12s} {source:15s} n={len(sub):8d} corr={corr:.4f}")
