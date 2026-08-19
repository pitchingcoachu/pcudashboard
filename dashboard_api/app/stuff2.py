"""
Stuff+ 2.0 -- a real, data-trained pitch-quality model, kept alongside the
original hand-crafted Stuff+ (see _compute_stuff_by_pitch_type in main.py)
as a second, separate metric. Unlike the original (hand-set target shapes,
hardcoded separation constants), this is trained per pitch type on real
outcome data:

  - PRO rows: real Statcast delta_run_exp, rows with it actually populated only.
  - College/LEAGUE rows: PV/100's underlying linear-weights pitch value
    (main.py's own _calc_pitch_value), for consistency with the existing
    on-dashboard PV/100 stat.

Both were tested and found too noisy at the PER-PITCH level (held-out
correlation 0.02-0.07 -- essentially no real signal, a property of
single-pitch outcomes in general, not a target-choice problem). The model
actually shipped here is trained on PITCHER-LEVEL AGGREGATES instead:
each pitcher's average pitch characteristics for a given pitch type/level
predicting their average WHIFF RATE ON SWINGS for that same group -- this
is what produced real, usable signal (held-out correlation 0.19-0.33,
AUC-equivalent 0.64-0.69 for most pitch types; Sweeper is a known weak spot
at 0.55, likely limited by its small sample size, ~650 pitchers).

See dashboard_api/stuff2_training/ for the full extraction/training
pipeline and dashboard_api/app/stuff2_models/ for the trained model +
calibration artifacts this module loads.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Dict, List, Optional

import xgboost as xgb

logger = logging.getLogger("dashboard_api")

_MODELS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "stuff2_models")

PITCH_TYPES = ["Fastball", "Sinker", "Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"]
OFFSPEED_TYPES = {"Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter"}
BASE_TYPES = {"Fastball", "Sinker"}
LEVELS = ["D1", "D2", "D3", "JUCO", "NAIA", "AAA", "MLB"]

BASE_FEATURES = ["relspeed", "ivb", "hb_mirrored", "spinrate", "extension", "relheight", "relside"]
OFFSPEED_EXTRA_FEATURES = [
    "velo_gap_fastball", "ivb_sep_fastball", "hb_sep_fastball",
    "velo_gap_sinker", "ivb_sep_sinker", "hb_sep_sinker",
]

_lock = threading.Lock()
_models: Dict[str, xgb.XGBRegressor] = {}
_calibration: Optional[Dict[str, Any]] = None


def _feature_columns(pitch_type: str) -> List[str]:
    cols = list(BASE_FEATURES)
    if pitch_type in OFFSPEED_TYPES:
        cols += OFFSPEED_EXTRA_FEATURES
        cols += ["has_fastball_base", "has_sinker_base"]
    return cols


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
                    logger.error("stuff2: model file missing: %s", model_path)
                    continue
                model = xgb.XGBRegressor()
                model.load_model(model_path)
                _models[pitch_type] = model
        except Exception:
            # Every caller of compute_stuff2_* treats a load failure as
            # "no Stuff+ 2.0 data available" and silently renders blank
            # rather than erroring the whole request -- that's the right
            # behavior for callers, but it means a load failure (missing
            # file, corrupt JSON, xgboost incompatibility, etc.) previously
            # had NO visible trace anywhere. Log it loudly so a
            # silent-everywhere-blank regression shows up in server logs.
            logger.exception("stuff2: failed to load models from %s", _MODELS_DIR)
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


def _mean(values: List[Optional[float]]) -> Optional[float]:
    nums = [float(v) for v in values if _is_num(v)]
    if not nums:
        return None
    return sum(nums) / len(nums)


def _pitcher_base_shapes(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Optional[float]]]:
    """Each pitcher's own average Fastball/Sinker shape (velo, ivb, hb
    mirrored to righty-space), the same fastball/sinker-relative anchor
    used during training -- computed from the SAME rows passed in, so it
    reflects this specific request's own data (matching how the original
    Stuff+ computes its base_vel/base_ivb_val/base_hb_val per call, not a
    separately-fetched global average)."""
    out: Dict[str, Dict[str, Optional[float]]] = {}
    for base_type in BASE_TYPES:
        velos, ivbs, hbs = [], [], []
        for row in rows:
            if row.get("pitch_type") != base_type:
                continue
            if not (_is_num(row.get("rel_speed")) and _is_num(row.get("ivb")) and _is_num(row.get("hb_adj"))):
                continue
            velos.append(float(row["rel_speed"]))
            ivbs.append(float(row["ivb"]))
            is_lefty = bool(row.get("is_lefty"))
            hb_adj = float(row["hb_adj"])
            # hb_adj on incoming rows is already handedness-adjusted per the
            # existing Stuff+ convention (see _compute_stuff_by_pitch_type),
            # but that convention mirrors LEFT (hb_adj = hb for lefty), while
            # training mirrored RIGHT (hb_mirrored = -hb for right). Convert.
            hb_mirrored = -hb_adj if not is_lefty else hb_adj
            hbs.append(hb_mirrored)
        out[base_type] = {
            "velo": _mean(velos),
            "ivb": _mean(ivbs),
            "hb_mirrored": _mean(hbs),
        }
    return out


def compute_stuff2_by_pitch_type(
    rows: List[Dict[str, Any]],
    level: str,
) -> Dict[str, float]:
    """Mirrors _compute_stuff_by_pitch_type's (rows, level) -> per-pitch-type
    dict shape so it can be called alongside the original at each site.
    `rows` is the SAME shape the original function expects: dicts with
    pitch_type, rel_speed, ivb, hb_adj, is_lefty, rel_height, ext_value --
    PLUS, when available, spin_rate, rel_side, batterside (all optional;
    a row missing them is simply skipped for that pitch, same "less data
    in, less coverage out" behavior as the rest of this codebase).

    level should be one of LEVELS (D1/D2/D3/JUCO/NAIA/AAA/MLB); an
    unrecognized value falls back to no calibration shift (raw model output
    * 100), which will not be centered on 100 -- callers should always pass
    a real level when possible.

    Returns {pitch_type: stuff2_value}, rounded to 1 decimal, only for
    pitch types with enough data in `rows` to compute a value."""
    if not rows:
        return {}
    try:
        _load()
    except Exception:
        return {}
    if not _models or _calibration is None:
        return {}

    base_shapes = _pitcher_base_shapes(rows)
    by_type: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        pt = row.get("pitch_type")
        if pt not in _models:
            continue
        by_type.setdefault(pt, []).append(row)

    out: Dict[str, float] = {}
    for pitch_type, type_rows in by_type.items():
        model = _models[pitch_type]
        feature_cols = _feature_columns(pitch_type)
        feature_rows: List[List[float]] = []
        for row in type_rows:
            if not (_is_num(row.get("rel_speed")) and _is_num(row.get("ivb")) and _is_num(row.get("hb_adj"))):
                continue
            is_lefty = bool(row.get("is_lefty"))
            hb_adj = float(row["hb_adj"])
            hb_mirrored = -hb_adj if not is_lefty else hb_adj
            feats: Dict[str, Optional[float]] = {
                "relspeed": float(row["rel_speed"]),
                "ivb": float(row["ivb"]),
                "hb_mirrored": hb_mirrored,
                "spinrate": float(row["spin_rate"]) if _is_num(row.get("spin_rate")) else None,
                "extension": float(row["ext_value"]) if _is_num(row.get("ext_value")) else None,
                "relheight": float(row["rel_height"]) if _is_num(row.get("rel_height")) else None,
                "relside": float(row["rel_side"]) if _is_num(row.get("rel_side")) else None,
            }
            if pitch_type in OFFSPEED_TYPES:
                # A pitcher may only throw ONE of fastball/sinker (or
                # neither) as their primary heater -- zero-fill the
                # missing side's separation (neutral placeholder, not
                # "bad") and flag which base(s) are real via
                # has_fastball_base/has_sinker_base, exactly matching
                # training (aggregate_and_train.py's _fill_row). The model
                # is trained on rows with neither base present too (see
                # aggregate_and_train.py), so this is a real, calibrated
                # input pattern, not unseen extrapolation.
                for base_type in BASE_TYPES:
                    prefix = base_type.lower()
                    base = base_shapes.get(base_type, {})
                    base_velo, base_ivb, base_hb = base.get("velo"), base.get("ivb"), base.get("hb_mirrored")
                    has_base = _is_num(base_velo) and _is_num(base_ivb) and _is_num(base_hb)
                    feats[f"has_{prefix}_base"] = 1.0 if has_base else 0.0
                    feats[f"velo_gap_{prefix}"] = (float(row["rel_speed"]) - base_velo) if has_base else 0.0
                    feats[f"ivb_sep_{prefix}"] = (float(row["ivb"]) - base_ivb) if has_base else 0.0
                    feats[f"hb_sep_{prefix}"] = (hb_mirrored - base_hb) if has_base else 0.0
            if any(feats.get(col) is None for col in feature_cols):
                continue
            # batter_hand_code + one-hot level columns, in the EXACT order
            # used at training time (all_cols = feature_cols +
            # ["batter_hand_code"] + [f"level_{lvl}" for lvl in LEVELS] --
            # see aggregate_and_train.py). batter hand comes from this row
            # (-1 Left / 1 Right / 0 unknown-or-"All"); level is the single
            # value passed in for this whole call (matching how the
            # original Stuff+ takes one `level` argument per call, not
            # per-row) since a Stuff+ 2.0 request is always scoped to one
            # level via the same dropdown the original formula already uses.
            batter_hand_code = {"Left": -1, "Right": 1}.get(_norm_hand(row.get("batterside")), 0)
            level_one_hot = [1 if level == lvl else 0 for lvl in LEVELS]
            feature_rows.append([feats[col] for col in feature_cols] + [batter_hand_code] + level_one_hot)

        if not feature_rows:
            continue

        preds = model.predict(feature_rows)
        avg_pred = float(sum(preds) / len(preds))

        cal = _calibration.get("per_pitch_type", {}).get(pitch_type, {})
        level_cal = cal.get("level_calibration", {}).get(level)
        if level_cal is None:
            # No calibration for this level (e.g. unrecognized/missing level) --
            # best-effort: fall back to the calibration entry with the most
            # training pitchers, rather than returning an uncalibrated raw value.
            level_entries = cal.get("level_calibration", {})
            if level_entries:
                level_cal = max(level_entries.values(), key=lambda v: v.get("n", 0))
        if level_cal is None:
            continue
        out[pitch_type] = _apply_calibration(avg_pred, level_cal)

    return out


def _apply_calibration(avg_pred: float, level_cal: Dict[str, Any]) -> float:
    shift = level_cal.get("shift", 0.0)
    scale = level_cal.get("scale", 1.0)
    stuff2 = 100.0 + ((avg_pred + shift) * scale)
    return round(stuff2, 1)


def _level_calibration(pitch_type: str, level: str) -> Optional[Dict[str, Any]]:
    if _calibration is None:
        return None
    cal = _calibration.get("per_pitch_type", {}).get(pitch_type, {})
    level_entries = cal.get("level_calibration", {})
    level_cal = level_entries.get(level)
    if level_cal is None and level_entries:
        level_cal = max(level_entries.values(), key=lambda v: v.get("n", 0))
    return level_cal


def compute_stuff2_grid(
    pitch_type: str,
    level: str,
    is_lefty: bool,
    batter_hand: Optional[str],
    rel_speed: float,
    spin_rate: Optional[float],
    ext_value: Optional[float],
    rel_height: Optional[float],
    rel_side: Optional[float],
    ivb_hb_pairs: List[tuple],
    base_fastball: Optional[Dict[str, float]] = None,
    base_sinker: Optional[Dict[str, float]] = None,
) -> List[Optional[float]]:
    """Batch-scores many hypothetical (ivb, hb) combinations for ONE fixed
    pitch shape otherwise (velo/spin/extension/release point/level/hand),
    for the honeycomb grid on the Stuff+ suite -- everything about the
    pitch is held constant except IVB/HB, which vary per grid cell.

    `ivb_hb_pairs` is a list of (ivb, hb) tuples, hb in the SAME raw
    (un-mirrored) convention as the rest of the codebase (hb_adj: negative
    = arm-side for a pitcher throwing right-handed, per _compute_stuff_by_
    pitch_type's convention -- mirrored internally the same way
    compute_stuff2_by_pitch_type mirrors real rows).

    `base_fastball`/`base_sinker`, when given (required for offspeed pitch
    types to get a real, non-zero-filled separation score), are
    {"rel_speed":, "ivb":, "hb_adj":} in that SAME raw convention -- this
    mirrors _pitcher_base_shapes' output shape so the same has_base/
    velo_gap/ivb_sep/hb_sep logic applies unchanged.

    Returns one Stuff+ 2.0 value (or None if the model/calibration is
    unavailable for this pitch_type/level) per pair, in input order."""
    try:
        _load()
    except Exception:
        return [None] * len(ivb_hb_pairs)
    model = _models.get(pitch_type)
    if model is None or _calibration is None:
        return [None] * len(ivb_hb_pairs)
    level_cal = _level_calibration(pitch_type, level)
    if level_cal is None:
        return [None] * len(ivb_hb_pairs)

    feature_cols = _feature_columns(pitch_type)
    batter_hand_code = {"Left": -1, "Right": 1}.get(_norm_hand(batter_hand), 0)
    level_one_hot = [1 if level == lvl else 0 for lvl in LEVELS]

    def _mirror(hb_adj: Optional[float]) -> Optional[float]:
        if not _is_num(hb_adj):
            return None
        return -float(hb_adj) if not is_lefty else float(hb_adj)

    base_shapes: Dict[str, Dict[str, Optional[float]]] = {}
    for base_type, base_row in (("Fastball", base_fastball), ("Sinker", base_sinker)):
        if not base_row:
            base_shapes[base_type] = {"velo": None, "ivb": None, "hb_mirrored": None}
            continue
        base_shapes[base_type] = {
            "velo": float(base_row["rel_speed"]) if _is_num(base_row.get("rel_speed")) else None,
            "ivb": float(base_row["ivb"]) if _is_num(base_row.get("ivb")) else None,
            "hb_mirrored": _mirror(base_row.get("hb_adj")),
        }

    feature_rows: List[List[float]] = []
    row_indices: List[int] = []
    for idx, (ivb, hb_adj) in enumerate(ivb_hb_pairs):
        if not (_is_num(rel_speed) and _is_num(ivb) and _is_num(hb_adj)):
            continue
        hb_mirrored = _mirror(hb_adj)
        feats: Dict[str, Optional[float]] = {
            "relspeed": float(rel_speed),
            "ivb": float(ivb),
            "hb_mirrored": hb_mirrored,
            "spinrate": float(spin_rate) if _is_num(spin_rate) else None,
            "extension": float(ext_value) if _is_num(ext_value) else None,
            "relheight": float(rel_height) if _is_num(rel_height) else None,
            "relside": float(rel_side) if _is_num(rel_side) else None,
        }
        if pitch_type in OFFSPEED_TYPES:
            for base_type in BASE_TYPES:
                prefix = base_type.lower()
                base = base_shapes.get(base_type, {})
                base_velo, base_ivb, base_hb = base.get("velo"), base.get("ivb"), base.get("hb_mirrored")
                has_base = _is_num(base_velo) and _is_num(base_ivb) and _is_num(base_hb)
                feats[f"has_{prefix}_base"] = 1.0 if has_base else 0.0
                feats[f"velo_gap_{prefix}"] = (float(rel_speed) - base_velo) if has_base else 0.0
                feats[f"ivb_sep_{prefix}"] = (float(ivb) - base_ivb) if has_base else 0.0
                feats[f"hb_sep_{prefix}"] = (hb_mirrored - base_hb) if has_base else 0.0
        if any(feats.get(col) is None for col in feature_cols):
            continue
        feature_rows.append([feats[col] for col in feature_cols] + [batter_hand_code] + level_one_hot)
        row_indices.append(idx)

    out: List[Optional[float]] = [None] * len(ivb_hb_pairs)
    if not feature_rows:
        return out
    preds = model.predict(feature_rows)
    for i, pred in zip(row_indices, preds):
        out[i] = _apply_calibration(float(pred), level_cal)
    return out


def compute_stuff2_from_rollup_averages(
    pitch_type_averages: Dict[str, Dict[str, Optional[float]]],
    level: str,
) -> Dict[str, float]:
    """Rollup-path variant of compute_stuff2_by_pitch_type: instead of
    scoring individual raw pitches, scores ONE representative "average
    pitch" per pitch type, built from pre-aggregated rollup sums (the
    college/PRO fast-path tables only carry sums/counts per (split,
    pitch_type), not individual pitches -- see _try_pitching_overview_daily_rollup
    / _try_pro_pitching_overview_rollup, which pool possibly-many pitchers'
    data per split value, so there's no meaningful single "pitcher" to
    compute a fastball/sinker base FROM in the first place; this uses the
    split's own average Fastball/Sinker shape as that reference instead,
    same idea as the original Stuff+'s synth_rows approach for this same
    rollup path).

    `pitch_type_averages` = {pitch_type: {"rel_speed":, "ivb":, "hb_adj":,
    "spin_rate":, "ext_value":, "rel_height":, "rel_side":, "is_lefty":}},
    one entry per pitch type actually present in this split -- values may
    be None where that stat has no data, in which case that pitch type
    (or the affected offspeed features) is skipped, matching the
    per-pitch function's "less data in, less coverage out" behavior.

    batter handedness is NOT available at this aggregation level (the
    rollup tables collapse it before this data is reached) -- always
    scored as "All" (batter_hand_code=0), same neutral mode the per-pitch
    function supports when a row has no batterside."""
    if not pitch_type_averages:
        return {}
    try:
        _load()
    except Exception:
        return {}
    if not _models or _calibration is None:
        return {}

    # Reuse _pitcher_base_shapes' logic by faking one "row" per base pitch
    # type from the rollup averages.
    fake_rows = []
    for base_type in BASE_TYPES:
        avg = pitch_type_averages.get(base_type)
        if not avg:
            continue
        fake_rows.append({
            "pitch_type": base_type,
            "rel_speed": avg.get("rel_speed"),
            "ivb": avg.get("ivb"),
            "hb_adj": avg.get("hb_adj"),
            "is_lefty": bool(avg.get("is_lefty")),
        })
    base_shapes = _pitcher_base_shapes(fake_rows)

    out: Dict[str, float] = {}
    for pitch_type, avg in pitch_type_averages.items():
        model = _models.get(pitch_type)
        if model is None:
            continue
        feature_cols = _feature_columns(pitch_type)
        is_lefty = bool(avg.get("is_lefty"))
        hb_adj = avg.get("hb_adj")
        if not (_is_num(avg.get("rel_speed")) and _is_num(avg.get("ivb")) and _is_num(hb_adj)):
            continue
        hb_mirrored = -float(hb_adj) if not is_lefty else float(hb_adj)
        feats: Dict[str, Optional[float]] = {
            "relspeed": float(avg["rel_speed"]),
            "ivb": float(avg["ivb"]),
            "hb_mirrored": hb_mirrored,
            "spinrate": float(avg["spin_rate"]) if _is_num(avg.get("spin_rate")) else None,
            "extension": float(avg["ext_value"]) if _is_num(avg.get("ext_value")) else None,
            "relheight": float(avg["rel_height"]) if _is_num(avg.get("rel_height")) else None,
            "relside": float(avg["rel_side"]) if _is_num(avg.get("rel_side")) else None,
        }
        if pitch_type in OFFSPEED_TYPES:
            for base_type in BASE_TYPES:
                prefix = base_type.lower()
                base = base_shapes.get(base_type, {})
                base_velo, base_ivb, base_hb = base.get("velo"), base.get("ivb"), base.get("hb_mirrored")
                has_base = _is_num(base_velo) and _is_num(base_ivb) and _is_num(base_hb)
                feats[f"has_{prefix}_base"] = 1.0 if has_base else 0.0
                feats[f"velo_gap_{prefix}"] = (float(avg["rel_speed"]) - base_velo) if has_base else 0.0
                feats[f"ivb_sep_{prefix}"] = (float(avg["ivb"]) - base_ivb) if has_base else 0.0
                feats[f"hb_sep_{prefix}"] = (hb_mirrored - base_hb) if has_base else 0.0
        if any(feats.get(col) is None for col in feature_cols):
            continue

        level_one_hot = [1 if level == lvl else 0 for lvl in LEVELS]
        feature_row = [[feats[col] for col in feature_cols] + [0] + level_one_hot]  # batter_hand_code=0 ("All")
        pred = float(model.predict(feature_row)[0])

        cal = _calibration.get("per_pitch_type", {}).get(pitch_type, {})
        level_cal = cal.get("level_calibration", {}).get(level)
        if level_cal is None:
            level_entries = cal.get("level_calibration", {})
            if level_entries:
                level_cal = max(level_entries.values(), key=lambda v: v.get("n", 0))
        if level_cal is None:
            continue
        out[pitch_type] = _apply_calibration(pred, level_cal)

    return out
