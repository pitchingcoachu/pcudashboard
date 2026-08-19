"""
Command+ -- a real, data-trained pitch-LOCATION-quality model, sibling to
Stuff+ 2.0 (see dashboard_api/app/stuff2.py). Where Stuff+ 2.0 grades a
pitch's SHAPE (velocity, movement, spin) independent of where it was
thrown, Command+ grades its LOCATION (plate_side, plate_height) given the
count and batter handedness it was thrown in, independent of pitch shape.
Same target for both PRO and LEAGUE, same pitcher x level aggregate-then-
train methodology, same 100-average per-level calibration -- see
dashboard_api/command_training/ for the full extraction/training pipeline
and dashboard_api/app/command_models/ for the trained model + calibration
artifacts this module loads.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Dict, List, Optional

import xgboost as xgb

logger = logging.getLogger("dashboard_api")

_MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "command_models")

PITCH_TYPES = ["Fastball", "Sinker", "Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"]
LEVELS = ["D1", "D2", "D3", "JUCO", "NAIA", "AAA", "MLB"]

FEATURES = ["edge_dist_h", "edge_dist_v", "balls", "strikes"]

# Same strike-zone boundaries as command_training/extract_dataset.py (and
# the dashboard's own main.py ZONE_LEFT/RIGHT/BOTTOM/TOP) -- must stay in
# sync with training, since edge_dist_h/edge_dist_v are computed from
# these at both training and inference time.
ZONE_LEFT = -0.88
ZONE_RIGHT = 0.88
ZONE_BOTTOM = 1.5
ZONE_TOP = 3.6


def _edge_distance(coord: float, low: float, high: float) -> float:
    return min(coord - low, high - coord)

_lock = threading.Lock()
_models: Dict[str, xgb.XGBRegressor] = {}
_calibration: Optional[Dict[str, Any]] = None


def _load() -> None:
    global _calibration
    if _calibration is not None and len(_models) == len(PITCH_TYPES):
        return
    with _lock:
        if _calibration is not None and len(_models) == len(PITCH_TYPES):
            return
        try:
            cal_path = os.path.join(_MODELS_DIR, "calibration.json")
            with open(cal_path) as f:
                _calibration = json.load(f)
            for pitch_type in PITCH_TYPES:
                model_path = os.path.join(_MODELS_DIR, f"{pitch_type.lower()}.json")
                if not os.path.exists(model_path):
                    logger.error("command: model file missing: %s", model_path)
                    continue
                model = xgb.XGBRegressor()
                model.load_model(model_path)
                _models[pitch_type] = model
        except Exception:
            # Same silent-failure trap Stuff+ 2.0 had until it bit us in
            # production (blank Stuff+ everywhere, no error anywhere) --
            # log loudly and re-raise here from the start.
            logger.exception("command: failed to load models from %s", _MODELS_DIR)
            raise


def is_available() -> bool:
    try:
        _load()
    except Exception:
        return False
    return bool(_models) and _calibration is not None


def _is_num(value: Any) -> bool:
    try:
        if value is None:
            return False
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def _norm_hand(value: Any) -> str:
    v = str(value or "").strip().upper()
    if v.startswith("L"):
        return "Left"
    if v.startswith("R"):
        return "Right"
    return ""


def _apply_calibration(avg_pred: float, level_cal: Dict[str, Any]) -> float:
    shift = level_cal.get("shift", 0.0)
    scale = level_cal.get("scale", 1.0)
    command = 100.0 + ((avg_pred + shift) * scale)
    return round(command, 1)


def _level_calibration(pitch_type: str, level: str) -> Optional[Dict[str, Any]]:
    if _calibration is None:
        return None
    cal = _calibration.get("per_pitch_type", {}).get(pitch_type, {})
    level_entries = cal.get("level_calibration", {})
    level_cal = level_entries.get(level)
    if level_cal is None and level_entries:
        level_cal = max(level_entries.values(), key=lambda v: v.get("n", 0))
    return level_cal


def compute_command_by_pitch_type(
    rows: List[Dict[str, Any]],
    level: str,
) -> Dict[str, float]:
    """`rows`: dicts with pitch_type, plate_side, plate_height, is_lefty,
    balls, strikes, and optionally batterside. plate_side is in the SAME
    raw (un-mirrored) convention as the rest of this codebase's location
    features (positive = arm-side for a pitcher throwing right-handed) --
    mirrored internally to righty-space to match training, same idea as
    Stuff+ 2.0's hb_adj mirroring.

    level should be one of LEVELS; an unrecognized value falls back to the
    calibration entry with the most training pitchers.

    Returns {pitch_type: command_value}, rounded to 1 decimal, only for
    pitch types with enough data in `rows` to compute a value."""
    if not rows:
        return {}
    try:
        _load()
    except Exception:
        return {}
    if not _models or _calibration is None:
        return {}

    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        pt = row.get("pitch_type")
        if pt not in _models:
            continue
        by_type.setdefault(pt, []).append(row)

    out: Dict[str, float] = {}
    for pitch_type, type_rows in by_type.items():
        model = _models[pitch_type]
        feature_rows: List[List[float]] = []
        for row in type_rows:
            if not (
                _is_num(row.get("plate_side"))
                and _is_num(row.get("plate_height"))
                and _is_num(row.get("balls"))
                and _is_num(row.get("strikes"))
            ):
                continue
            is_lefty = bool(row.get("is_lefty"))
            plate_side = float(row["plate_side"])
            # Mirror to righty-space, same convention as training
            # (plate_side_mirrored = -plate_side for a righty pitcher).
            plate_side_mirrored = -plate_side if not is_lefty else plate_side
            plate_height = float(row["plate_height"])
            edge_dist_h = _edge_distance(plate_side_mirrored, ZONE_LEFT, ZONE_RIGHT)
            edge_dist_v = _edge_distance(plate_height, ZONE_BOTTOM, ZONE_TOP)
            batter_hand_code = {"Left": -1, "Right": 1}.get(_norm_hand(row.get("batterside")), 0)
            level_one_hot = [1 if level == lvl else 0 for lvl in LEVELS]
            feats = [edge_dist_h, edge_dist_v, float(row["balls"]), float(row["strikes"])]
            feature_rows.append(feats + [batter_hand_code] + level_one_hot)

        if not feature_rows:
            continue

        preds = model.predict(feature_rows)
        avg_pred = float(sum(preds) / len(preds))

        level_cal = _level_calibration(pitch_type, level)
        if level_cal is None:
            continue
        out[pitch_type] = _apply_calibration(avg_pred, level_cal)

    return out


def compute_command_from_rollup_averages(
    buckets: List[Dict[str, Any]],
    level: str,
) -> Dict[str, float]:
    """Rollup-path variant of compute_command_by_pitch_type: instead of
    scoring individual raw pitches, scores one representative "average
    pitch" per (pitch_type, is_lefty, batter_hand, balls, strikes) bucket
    from pre-aggregated rollup sums (see plate_side_sum/plate_side_n/
    plate_height_sum/plate_height_n on pro_pitch_events_daily_rollup* and
    pitch_events_daily_rollup_league*).

    `buckets`: dicts with pitch_type, plate_side (already averaged),
    plate_height (already averaged), is_lefty, balls, strikes, and
    optionally batterside, weight (pitch count for this bucket -- used to
    weight this bucket's prediction into the pitch type's overall average;
    defaults to 1 if omitted).

    Mirroring plate_side by pitcher hand is done the same way as the
    per-pitch function -- safe here because each bucket is already scoped
    to a single pitcher hand (mirroring a sum/average by one sign flip is
    only equivalent to mirroring every pitch individually when hand is
    constant within the bucket, which the rollup grouping guarantees)."""
    if not buckets:
        return {}
    try:
        _load()
    except Exception:
        return {}
    if not _models or _calibration is None:
        return {}

    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for bucket in buckets:
        pt = bucket.get("pitch_type")
        if pt not in _models:
            continue
        by_type.setdefault(pt, []).append(bucket)

    out: Dict[str, float] = {}
    for pitch_type, type_buckets in by_type.items():
        model = _models[pitch_type]
        feature_rows: List[List[float]] = []
        weights: List[float] = []
        for bucket in type_buckets:
            if not (
                _is_num(bucket.get("plate_side"))
                and _is_num(bucket.get("plate_height"))
                and _is_num(bucket.get("balls"))
                and _is_num(bucket.get("strikes"))
            ):
                continue
            is_lefty = bool(bucket.get("is_lefty"))
            plate_side = float(bucket["plate_side"])
            plate_side_mirrored = -plate_side if not is_lefty else plate_side
            plate_height = float(bucket["plate_height"])
            edge_dist_h = _edge_distance(plate_side_mirrored, ZONE_LEFT, ZONE_RIGHT)
            edge_dist_v = _edge_distance(plate_height, ZONE_BOTTOM, ZONE_TOP)
            batter_hand_code = {"Left": -1, "Right": 1}.get(_norm_hand(bucket.get("batterside")), 0)
            level_one_hot = [1 if level == lvl else 0 for lvl in LEVELS]
            feats = [edge_dist_h, edge_dist_v, float(bucket["balls"]), float(bucket["strikes"])]
            feature_rows.append(feats + [batter_hand_code] + level_one_hot)
            weight = bucket.get("weight")
            weights.append(float(weight) if _is_num(weight) and float(weight) > 0 else 1.0)

        if not feature_rows:
            continue

        preds = model.predict(feature_rows)
        total_weight = sum(weights)
        avg_pred = float(sum(p * w for p, w in zip(preds, weights)) / total_weight) if total_weight > 0 else float(sum(preds) / len(preds))

        level_cal = _level_calibration(pitch_type, level)
        if level_cal is None:
            continue
        out[pitch_type] = _apply_calibration(avg_pred, level_cal)

    return out
