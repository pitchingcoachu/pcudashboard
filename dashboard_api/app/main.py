from __future__ import annotations

from datetime import date, timedelta
import hashlib
import json
from math import isfinite, isnan
import os
import re
import time
from functools import lru_cache
import threading
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .db import get_conn
from .schemas import (
    HittingAbReportResponse,
    PitchingAbReportResponse,
    PitchEditCountResponse,
    PitchEditRequest,
    PitchEditResponse,
    PitchTypeSummaryRow,
    PitchingFiltersResponse,
    PitchingOverviewResponse,
    ManualVelocityListResponse,
    ManualVelocityCreateRequest,
    ManualVelocityCreateResponse,
    ManualVelocityDeleteResponse,
    ManualVelocityEntry,
)

app = FastAPI(title="PCU Dashboard API", version="0.1.0")
settings = get_settings()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

ZONE_LEFT = -0.88
ZONE_RIGHT = 0.88
ZONE_BOTTOM = 1.5
ZONE_TOP = 3.6
ZONE_MID_X = (ZONE_LEFT + ZONE_RIGHT) / 2.0
ZONE_MID_Y = (ZONE_BOTTOM + ZONE_TOP) / 2.0
ZONE_DX = (ZONE_RIGHT - ZONE_LEFT) / 3.0
ZONE_DY = (ZONE_TOP - ZONE_BOTTOM) / 3.0
OSU_SEASON_START = date(2026, 2, 13)
OSU_SEASON_END = date(2026, 6, 20)

ZONE_LOCATION_CHOICES = [
    "Upper Half",
    "Bottom Half",
    "Glove Side Half",
    "Arm Side Half",
    "Upper 3rd",
    "Bottom 3rd",
    "Glove Side 3rd",
    "Arm Side 3rd",
]
COUNT_CHOICES = [
    "Even",
    "Behind",
    "Ahead",
    "2KNF",
    "0-0",
    "0-1",
    "1-0",
    "1-1",
    "2-0",
    "2-1",
    "0-2",
    "1-2",
    "2-2",
    "3-0",
    "3-1",
    "3-2",
]
PITCH_RESULT_CHOICES = [
    "Called Strike",
    "Ball",
    "Foul",
    "Whiff",
    "In Play (Out)",
    "In Play (Hit)",
    "Error",
    "Single",
    "Double",
    "Triple",
    "HomeRun",
]

PITCH_WEIGHTS_FB: Dict[str, Dict[str, float]] = {
    "Fastball": {"w_vel": 0.6, "w_ivb": 0.3, "w_hb": 0.1, "w_ext": 0.05, "w_raw_vel": 0.0},
    "Sinker": {"w_vel": 0.5, "w_ivb": 0.3, "w_hb": 0.2, "w_ext": 0.05, "w_raw_vel": 0.0},
    "Cutter": {"w_vel": 0.44, "w_ivb": 0.2, "w_hb": 0.3, "w_ext": 0.05, "w_raw_vel": 0.1},
    "Slider": {"w_vel": 0.34, "w_ivb": 0.4, "w_hb": 0.2, "w_ext": 0.05, "w_raw_vel": 0.1},
    "Sweeper": {"w_vel": 0.23, "w_ivb": 0.1, "w_hb": 0.6, "w_ext": 0.04, "w_raw_vel": 0.1},
    "Curveball": {"w_vel": 0.43, "w_ivb": 0.5, "w_hb": 0.0, "w_ext": 0.04, "w_raw_vel": 0.1},
    "ChangeUp": {"w_vel": 0.2, "w_ivb": 0.6, "w_hb": 0.2, "w_ext": 0.03, "w_raw_vel": 0.0},
    "Splitter": {"w_vel": 0.1, "w_ivb": 0.85, "w_hb": 0.05, "w_ext": 0.03, "w_raw_vel": 0.0},
}
PITCH_WEIGHTS_SI: Dict[str, Dict[str, float]] = {
    "Fastball": {"w_vel": 0.6, "w_ivb": 0.3, "w_hb": 0.1, "w_ext": 0.05, "w_raw_vel": 0.0},
    "Sinker": {"w_vel": 0.5, "w_ivb": 0.3, "w_hb": 0.2, "w_ext": 0.05, "w_raw_vel": 0.0},
    "Cutter": {"w_vel": 0.44, "w_ivb": 0.2, "w_hb": 0.3, "w_ext": 0.05, "w_raw_vel": 0.1},
    "Slider": {"w_vel": 0.34, "w_ivb": 0.4, "w_hb": 0.2, "w_ext": 0.05, "w_raw_vel": 0.1},
    "Sweeper": {"w_vel": 0.23, "w_ivb": 0.1, "w_hb": 0.6, "w_ext": 0.04, "w_raw_vel": 0.1},
    "Curveball": {"w_vel": 0.43, "w_ivb": 0.5, "w_hb": 0.0, "w_ext": 0.04, "w_raw_vel": 0.1},
    "ChangeUp": {"w_vel": 0.2, "w_ivb": 0.7, "w_hb": 0.1, "w_ext": 0.03, "w_raw_vel": 0.0},
    "Splitter": {"w_vel": 0.1, "w_ivb": 0.85, "w_hb": 0.05, "w_ext": 0.03, "w_raw_vel": 0.0},
}
EXT_TARGETS: Dict[str, Dict[str, float]] = {
    "Fastball": {"poor": 5.8, "avg": 6.0, "great": 6.2},
    "Sinker": {"poor": 5.8, "avg": 6.0, "great": 6.2},
    "Cutter": {"poor": 5.6, "avg": 5.8, "great": 6.0},
    "Slider": {"poor": 5.4, "avg": 5.6, "great": 5.8},
    "Sweeper": {"poor": 5.4, "avg": 5.6, "great": 5.8},
    "Curveball": {"poor": 5.3, "avg": 5.5, "great": 5.7},
    "ChangeUp": {"poor": 5.7, "avg": 5.9, "great": 6.1},
    "Splitter": {"poor": 5.7, "avg": 5.9, "great": 6.1},
}
BREAKING_VEL_TARGETS: Dict[str, Dict[str, float]] = {
    "Cutter": {"poor": 82.0, "avg": 85.0, "great": 88.0},
    "Slider": {"poor": 80.0, "avg": 82.0, "great": 84.0},
    "Sweeper": {"poor": 75.0, "avg": 77.0, "great": 80.0},
    "Curveball": {"poor": 75.0, "avg": 77.0, "great": 80.0},
}
OFF_OFF = {"Cutter": 5.0, "Slider": 8.0, "Sweeper": 12.0, "Curveball": 14.0, "ChangeUp": 8.0, "Splitter": 7.0}
SEP_FB_IVB = {"Cutter": -7.0, "Slider": -15.0, "Sweeper": -16.0, "Curveball": -27.0, "ChangeUp": -12.0, "Splitter": -13.0}
SEP_FB_HB = {"Cutter": 10.0, "Slider": 12.0, "Sweeper": 22.0, "Curveball": 18.0, "ChangeUp": -7.0, "Splitter": -4.0}
SEP_SI_IVB = {"Cutter": 2.0, "Slider": -6.0, "Sweeper": -7.0, "Curveball": -18.0, "ChangeUp": -4.0, "Splitter": -5.0}
SEP_SI_HB = {"Cutter": 18.0, "Slider": 20.0, "Sweeper": 30.0, "Curveball": 25.0, "ChangeUp": 1.0, "Splitter": 2.0}
VELO_AVG_BY_LEVEL = {"Pro": 94.0, "College": 89.0, "High School": 82.0}

_OVERVIEW_CACHE_TTL_SECONDS = max(0, int(os.getenv("DASHBOARD_OVERVIEW_CACHE_TTL_SECONDS", "45")))
_OVERVIEW_CACHE_MAX_ENTRIES = max(64, int(os.getenv("DASHBOARD_OVERVIEW_CACHE_MAX_ENTRIES", "256")))
_CHART_POINTS_MAX = max(1000, int(os.getenv("DASHBOARD_CHART_POINTS_MAX", "6000")))
_OVERVIEW_CACHE: Dict[str, tuple[float, Any]] = {}
_OVERVIEW_CACHE_LOCK = threading.Lock()


def _json_stable(value: Any) -> Any:
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, set):
        return sorted(_json_stable(v) for v in value)
    if isinstance(value, tuple):
        return [_json_stable(v) for v in value]
    if isinstance(value, list):
        return [_json_stable(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _json_stable(v) for k, v in sorted(value.items(), key=lambda item: str(item[0]))}
    return value


def _overview_cache_key(endpoint: str, school_code: str, payload: Dict[str, Any]) -> str:
    normalized = _json_stable(payload)
    digest = hashlib.sha256(json.dumps(normalized, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")).hexdigest()
    return f"{endpoint}|{school_code}|{digest}"


def _overview_cache_get(key: str) -> Any:
    if _OVERVIEW_CACHE_TTL_SECONDS <= 0:
        return None
    now = time.time()
    with _OVERVIEW_CACHE_LOCK:
        hit = _OVERVIEW_CACHE.get(key)
        if not hit:
            return None
        ts, value = hit
        if now - ts > _OVERVIEW_CACHE_TTL_SECONDS:
            _OVERVIEW_CACHE.pop(key, None)
            return None
        return value


def _overview_cache_set(key: str, value: Any) -> None:
    if _OVERVIEW_CACHE_TTL_SECONDS <= 0:
        return
    now = time.time()
    with _OVERVIEW_CACHE_LOCK:
        _OVERVIEW_CACHE[key] = (now, value)
        if len(_OVERVIEW_CACHE) > _OVERVIEW_CACHE_MAX_ENTRIES:
            for stale_key, _ in sorted(_OVERVIEW_CACHE.items(), key=lambda item: item[1][0])[: max(1, len(_OVERVIEW_CACHE) - _OVERVIEW_CACHE_MAX_ENTRIES)]:
                _OVERVIEW_CACHE.pop(stale_key, None)


def _overview_cache_invalidate_school(school_code: str) -> None:
    school = (school_code or "").strip().upper()
    if not school:
        return
    token = f"|{school}|"
    with _OVERVIEW_CACHE_LOCK:
        keys = [key for key in _OVERVIEW_CACHE.keys() if token in key]
        for key in keys:
            _OVERVIEW_CACHE.pop(key, None)


def _downsample_rows_for_chart_points(rows: List[Dict[str, Any]], max_points: int = _CHART_POINTS_MAX) -> List[Dict[str, Any]]:
    total = len(rows)
    if max_points <= 0 or total <= max_points:
        return rows
    if max_points == 1:
        return [rows[-1]]
    step = (total - 1) / float(max_points - 1)
    out: List[Dict[str, Any]] = []
    used = set()
    for i in range(max_points):
        idx = int(round(i * step))
        idx = min(total - 1, max(0, idx))
        if idx in used:
            continue
        used.add(idx)
        out.append(rows[idx])
    if out[-1] is not rows[-1]:
        out[-1] = rows[-1]
    return out


def _latest_rows_for_chart_points(rows: List[Dict[str, Any]], max_points: int) -> List[Dict[str, Any]]:
    if max_points <= 0:
        return []
    if len(rows) <= max_points:
        return rows
    ordered = sorted(
        rows,
        key=lambda r: (
            str(r.get("session_date") or ""),
            int(r.get("pitch_number") or 0),
            int(r.get("pitch_no") or 0),
            int(r.get("id") or 0),
        ),
    )
    return ordered[-max_points:]


def _is_num(value: Any) -> bool:
    if value is None:
        return False
    try:
        return isfinite(float(value))
    except (TypeError, ValueError):
        return False


def _mean(values: List[Optional[float]]) -> Optional[float]:
    nums = [float(v) for v in values if _is_num(v)]  # type: ignore[arg-type]
    if not nums:
        return None
    return sum(nums) / len(nums)


def _std_ivb(pitch_type: str, rel_height: Optional[float]) -> Optional[float]:
    if pitch_type not in {"Fastball", "Sinker"} or not _is_num(rel_height):
        return None
    rh = float(rel_height)
    if pitch_type == "Fastball":
        if rh >= 6.2:
            return 17.0
        if rh >= 5.8:
            return 15.5
        if rh >= 5.4:
            return 15.0
        if rh >= 5.0:
            return 12.5
        if rh >= 4.5:
            return 11.0
        return 10.0
    if rh >= 6.2:
        return 10.0
    if rh >= 5.8:
        return 7.0
    if rh >= 5.4:
        return 6.0
    if rh >= 5.0:
        return 4.0
    if rh >= 4.5:
        return 3.0
    return 3.0


def _std_hb_right(pitch_type: str, rel_height: Optional[float]) -> Optional[float]:
    if pitch_type not in {"Fastball", "Sinker"} or not _is_num(rel_height):
        return None
    rh = float(rel_height)
    if pitch_type == "Fastball":
        if rh >= 6.2:
            return 9.0
        if rh >= 5.8:
            return 10.0
        if rh >= 5.4:
            return 11.0
        if rh >= 5.0:
            return 12.0
        if rh >= 4.5:
            return 13.0
        return 11.0
    if rh >= 6.2:
        return 15.0
    if rh >= 5.8:
        return 15.5
    if rh >= 5.4:
        return 16.7
    if rh >= 5.0:
        return 17.0
    if rh >= 4.5:
        return 17.0
    return 17.5


def _compute_stuff_by_pitch_type(
    rows: List[Dict[str, object]], base_type: str, level: str
) -> tuple[Optional[float], Dict[str, float]]:
    weight_tbl = PITCH_WEIGHTS_FB if base_type == "Fastball" else PITCH_WEIGHTS_SI
    seps_ivb = SEP_FB_IVB if base_type == "Fastball" else SEP_SI_IVB
    seps_hb = SEP_FB_HB if base_type == "Fastball" else SEP_SI_HB
    vel_avg = VELO_AVG_BY_LEVEL.get(level, VELO_AVG_BY_LEVEL["College"])

    base_vel = _mean(
        [row.get("rel_speed") for row in rows if row.get("pitch_type") == base_type]  # type: ignore[list-item]
    )
    base_ivb_val = _mean(
        [row.get("ivb") for row in rows if row.get("pitch_type") == base_type]  # type: ignore[list-item]
    )
    base_hb_val = _mean(
        [row.get("hb_adj") for row in rows if row.get("pitch_type") == base_type]  # type: ignore[list-item]
    )

    alpha = 4.0
    beta = 2.0
    values_by_type: Dict[str, List[float]] = {}

    for row in rows:
        pitch_type = str(row.get("pitch_type") or "")
        rel_speed = row.get("rel_speed")
        ivb = row.get("ivb")
        hb_adj = row.get("hb_adj")
        rel_height = row.get("rel_height")
        ext_value = row.get("ext_value")
        is_lefty = bool(row.get("is_lefty"))

        if pitch_type not in weight_tbl:
            continue
        if not (_is_num(rel_speed) and _is_num(ivb) and _is_num(hb_adj)):
            continue
        rel_speed = float(rel_speed)  # type: ignore[arg-type]
        ivb = float(ivb)  # type: ignore[arg-type]
        hb_adj = float(hb_adj)  # type: ignore[arg-type]

        std_ivb = _std_ivb(pitch_type, rel_height if _is_num(rel_height) else None)  # type: ignore[arg-type]
        std_hb_r = _std_hb_right(pitch_type, rel_height if _is_num(rel_height) else None)  # type: ignore[arg-type]
        std_hb = (-std_hb_r if is_lefty else std_hb_r) if std_hb_r is not None else None

        if pitch_type in {"Fastball", "Sinker"}:
            r_vel = rel_speed / max(vel_avg, 1e-6)
        else:
            off = OFF_OFF.get(pitch_type)
            if not _is_num(base_vel) or off is None:
                continue
            denom = float(base_vel) - off
            if abs(denom) < 1e-6:
                continue
            r_vel = rel_speed / denom

        r_vel = (r_vel**alpha) if r_vel < 1 else (r_vel**beta)
        if pitch_type in {"ChangeUp", "Splitter"}:
            r_vel = 1.0 / max(r_vel, 1e-6)

        if pitch_type == "Fastball":
            if not _is_num(std_ivb):
                continue
            r_ivb = ivb / float(std_ivb)
        elif pitch_type == "Sinker":
            if not _is_num(std_ivb):
                continue
            r_ivb = (float(std_ivb) / ivb) if ivb > 0 else 1.0
        elif base_type == "Sinker" and pitch_type in {"Cutter", "Sweeper"}:
            if not _is_num(base_ivb_val):
                continue
            endpoint = float(base_ivb_val) + seps_ivb[pitch_type]
            if abs(endpoint) < 1e-6:
                continue
            r_ivb = abs(ivb - endpoint) / endpoint
        elif base_type == "Fastball" and pitch_type == "Sweeper":
            if not _is_num(base_ivb_val):
                continue
            endpoint = float(base_ivb_val) + seps_ivb[pitch_type]
            if abs(endpoint) < 1e-6:
                continue
            r_ivb = abs(ivb - endpoint) / abs(endpoint)
        else:
            if not _is_num(base_ivb_val):
                continue
            sep = abs(seps_ivb.get(pitch_type, 0.0))
            if sep < 1e-6:
                continue
            r_ivb = (float(base_ivb_val) - ivb) / sep

        if pitch_type == "Fastball":
            if not _is_num(std_hb):
                continue
            hb_mag = abs(hb_adj)
            std_mag = abs(float(std_hb))
            if std_mag < 1e-6:
                continue
            r_hb = max(hb_mag / std_mag, std_mag / max(hb_mag, 1e-6))
            if abs(hb_mag - std_mag) < 2:
                r_hb = 1.0
        elif pitch_type == "Sinker":
            if not _is_num(std_hb):
                continue
            denom = abs(float(std_hb))
            if denom < 1e-6:
                continue
            r_hb = abs(hb_adj / float(std_hb))
        elif pitch_type == "Curveball":
            if not _is_num(base_hb_val):
                continue
            sep = abs(seps_hb.get("Curveball", 0.0))
            if sep < 1e-6:
                continue
            r_hb = abs(hb_adj - float(base_hb_val)) / sep
        elif base_type == "Sinker" and pitch_type in {"Sweeper", "Cutter"}:
            if not _is_num(base_hb_val):
                continue
            endpoint = float(base_hb_val) + seps_hb[pitch_type]
            if abs(endpoint) < 1e-6:
                continue
            r_hb = abs(hb_adj) / abs(endpoint)
        elif base_type == "Sinker" and pitch_type in {"ChangeUp", "Splitter"}:
            if not _is_num(base_hb_val):
                continue
            sep = seps_hb.get(pitch_type, 0.0)
            if abs(sep) < 1e-6:
                continue
            r_hb = (float(base_hb_val) - hb_adj) / sep
        else:
            if not _is_num(base_hb_val):
                continue
            sep = seps_hb.get(pitch_type, 0.0)
            if abs(sep) < 1e-6:
                continue
            r_hb = (hb_adj - float(base_hb_val)) / sep

        r_ivb = min(r_ivb, 2.0)
        r_hb = min(r_hb, 2.0)

        weights = weight_tbl[pitch_type]
        w_ext = weights["w_ext"]
        w_raw_vel = weights["w_raw_vel"]
        base_scale = max(1.0 - (w_ext + w_raw_vel), 0.01)

        ext_target = EXT_TARGETS.get(pitch_type)
        if _is_num(ext_value) and ext_target is not None:
            ext_range = ext_target["great"] - ext_target["poor"]
            ext_range = ext_range if ext_range > 0 else 1.0
            ext_norm = (float(ext_value) - ext_target["avg"]) / ext_range  # type: ignore[arg-type]
            r_ext = min(max(1.0 + 0.25 * ext_norm, 0.8), 1.2)
        else:
            r_ext = 1.0

        bvt = BREAKING_VEL_TARGETS.get(pitch_type)
        if bvt is not None:
            vel_range = bvt["great"] - bvt["poor"]
            vel_range = vel_range if vel_range > 0 else 1.0
            vel_norm = (rel_speed - bvt["avg"]) / vel_range
            r_raw_vel = min(max(1.0 + 0.25 * vel_norm, 0.8), 1.2)
        else:
            r_raw_vel = 1.0

        raw = (
            (weights["w_vel"] * base_scale) * r_vel
            + (weights["w_ivb"] * base_scale) * r_ivb
            + (weights["w_hb"] * base_scale) * r_hb
            + w_ext * r_ext
            + w_raw_vel * r_raw_vel
        )
        stuff = round(raw * 100.0, 1)
        values_by_type.setdefault(pitch_type, []).append(stuff)

    avg_by_type: Dict[str, float] = {
        pitch_type: round(sum(vals) / len(vals), 1) for pitch_type, vals in values_by_type.items() if vals
    }
    all_vals = [value for vals in values_by_type.values() for value in vals]
    avg_stuff = round(sum(all_vals) / len(all_vals), 1) if all_vals else None
    return avg_stuff, avg_by_type


def _validate_school_code(value: str) -> str:
    school_code = (value or "").strip().upper()
    if not school_code:
        raise HTTPException(status_code=400, detail="school_code is required.")
    return school_code


def _parse_csv_list(value: Optional[str]) -> List[str]:
    text = (value or "").strip()
    if not text:
        return []
    delimiter = ";" if ";" in text else ","
    return [part.strip() for part in text.split(delimiter) if part.strip() and part.strip() != "All"]


def _parse_name_list(value: Optional[str]) -> List[str]:
    text = (value or "").strip()
    if not text:
        return []
    # Names can contain commas ("Last, First"), so semicolon is the preferred delimiter.
    if ";" in text:
        parts = [part.strip() for part in text.split(";") if part.strip() and part.strip() != "All"]
        return parts

    # Backward-compat: older clients may still send comma-joined names.
    comma_parts = [part.strip() for part in text.split(",") if part.strip() and part.strip() != "All"]
    if len(comma_parts) >= 2 and len(comma_parts) % 2 == 0:
        rebuilt = [f"{comma_parts[i]}, {comma_parts[i + 1]}" for i in range(0, len(comma_parts), 2)]
        return rebuilt

    return [text] if text != "All" else []


def _parse_optional_float(value: Optional[str], field_name: str) -> Optional[float]:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return float(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be numeric.") from exc


def _parse_optional_int(value: Optional[str], field_name: str) -> Optional[int]:
    text = (value or "").strip()
    if not text:
        return None
    try:
        return int(text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"{field_name} must be an integer.") from exc


def _normalize_session_type_filter(value: Optional[str]) -> Optional[str]:
    text = (value or "").strip().lower()
    if not text or text == "all":
        return None
    if "season" in text:
        return "Season"
    if "bull" in text or "prac" in text or text == "bp" or " bp" in text or "bp " in text:
        return "Bullpen"
    if "live" in text or "game" in text or "ab" in text:
        return "Live"
    return None


def _session_bucket_for_row(row: Dict[str, Any], team_markers_norm) -> Optional[str]:
    st_compact = re.sub(r"\s+", "", str(row.get("session_type_norm") or "").strip().lower())
    if "bull" in st_compact or "prac" in st_compact or st_compact == "bp":
        return "Bullpen"
    pitcher_team_code = _normalize_team_code(str(row.get("pitcher_team_code") or ""))
    batter_team_code = _normalize_team_code(str(row.get("batter_team_code") or ""))
    pitcher_is_marker = pitcher_team_code in team_markers_norm if pitcher_team_code else False
    batter_is_marker = batter_team_code in team_markers_norm if batter_team_code else False
    if pitcher_is_marker and batter_is_marker and bool(batter_team_code):
        return "Live"
    if pitcher_is_marker and bool(batter_team_code) and not batter_is_marker:
        return "Season"
    if batter_is_marker and bool(pitcher_team_code) and not pitcher_is_marker:
        return "Season"
    return None


def _norm_hand(value: Optional[str]) -> str:
    v = (value or "").strip().upper()
    if v.startswith("L"):
        return "Left"
    if v.startswith("R"):
        return "Right"
    return "Unknown"


def _bucket_metric(value: Optional[float], step: float, unit: str) -> str:
    if not _is_num(value):
        return "Unknown"
    v = float(value)
    start = int(v // step) * step
    end = start + step
    if unit:
        return f"{start:.1f}-{end:.1f} {unit}"
    return f"{start:.1f}-{end:.1f}"


def _convert_tilt_degrees_to_clock(value: float) -> str:
    # Mirrors Shiny convert_to_clock(): h24 = 6 + x/30 then 12-hour clock string.
    h24 = 6.0 + (float(value) / 30.0)
    h12 = ((h24 - 1.0) % 12.0) + 1.0
    hour = int(h12)
    mins = int(round((h12 - hour) * 60.0))
    if mins == 60:
        mins = 0
        hour = 1 if hour == 12 else hour + 1
    return f"{hour}:{mins:02d}"


def _normalize_clock_string(value: str) -> Optional[str]:
    text = (value or "").strip()
    if not text:
        return None
    parts = text.split(":")
    if len(parts) < 2:
        return None
    try:
        hour = int(parts[0])
        mins = int(parts[1])
    except ValueError:
        return None
    if mins < 0:
        mins = 0
    if mins > 59:
        mins = mins % 60
    if hour <= 0:
        hour = 12
    if hour > 12:
        hour = ((hour - 1) % 12) + 1
    return f"{hour}:{mins:02d}"


def _tilt_values_to_clock(values: List[Any]) -> Optional[str]:
    numeric_vals: List[float] = []
    clock_vals: List[str] = []
    for raw in values:
        if raw is None:
            continue
        if _is_num(raw):
            numeric_vals.append(float(raw))
            continue
        text = str(raw).strip()
        if not text:
            continue
        if ":" in text:
            norm = _normalize_clock_string(text)
            if norm:
                clock_vals.append(norm)
            continue
        try:
            numeric_vals.append(float(text))
        except ValueError:
            continue
    if numeric_vals:
        return _convert_tilt_degrees_to_clock(sum(numeric_vals) / len(numeric_vals))
    if clock_vals:
        return clock_vals[0]
    return None


COUNT_RE_0: Dict[str, float] = {
    "0-0": 0.53,
    "1-0": 0.56,
    "2-0": 0.63,
    "3-0": 0.74,
    "0-1": 0.49,
    "1-1": 0.52,
    "2-1": 0.59,
    "3-1": 0.70,
    "0-2": 0.41,
    "1-2": 0.44,
    "2-2": 0.50,
    "3-2": 0.67,
}
OUT_BASE_RE: Dict[int, float] = {0: 0.53, 1: 0.29, 2: 0.11, 3: 0.0}
OUT_COUNT_SCALE: Dict[int, float] = {0: 1.0, 1: 0.8, 2: 0.6, 3: 0.0}


def _count_key(balls: Any, strikes: Any) -> str:
    b = int(float(balls)) if _is_num(balls) else 0
    s = int(float(strikes)) if _is_num(strikes) else 0
    b = min(max(b, 0), 3)
    s = min(max(s, 0), 2)
    return f"{b}-{s}"


def _state_re_no_runners(outs: Any, balls: Any, strikes: Any) -> float:
    outs_i = int(float(outs)) if _is_num(outs) else 0
    outs_i = min(max(outs_i, 0), 3)
    count_key = _count_key(balls, strikes)
    count_adj = COUNT_RE_0.get(count_key, COUNT_RE_0["0-0"]) - COUNT_RE_0["0-0"]
    return OUT_BASE_RE.get(outs_i, 0.0) + (count_adj * OUT_COUNT_SCALE.get(outs_i, 0.0))


def _calc_run_value(
    pitch_call: Any,
    play_result: Any,
    korbb: Any,
    balls: Any = None,
    strikes: Any = None,
    outs: Any = None,
    outs_on_play: Any = None,
) -> float:
    pc = str(pitch_call or "")
    pr = str(play_result or "")
    kb = str(korbb or "")
    outs_i = int(float(outs)) if _is_num(outs) else 0
    outs_i = min(max(outs_i, 0), 3)
    curr_re = _state_re_no_runners(outs_i, balls, strikes)

    # Terminal plate-appearance events: linear weights for reaching base/hits,
    # and count->outs transition for outs/strikeouts (no baserunner state available).
    if kb and kb != "NA":
        if kb == "Strikeout":
            next_re = _state_re_no_runners(min(3, outs_i + 1), 0, 0)
            return next_re - curr_re
        if kb == "Walk":
            return 0.33
    if pc == "HitByPitch" or pr in {"Walk", "IntentionalWalk", "HitByPitch"}:
        return 0.33
    if pc == "InPlay":
        outs_on_play_i = int(float(outs_on_play)) if _is_num(outs_on_play) else 0
        if outs_on_play_i > 0:
            next_re = _state_re_no_runners(min(3, outs_i + outs_on_play_i), 0, 0)
            return next_re - curr_re
        if pr == "Single":
            return 0.47
        if pr == "Double":
            return 0.78
        if pr == "Triple":
            return 1.09
        if pr == "HomeRun":
            return 1.40
        if pr == "Error":
            return 0.33
        return 0.0

    # Non-terminal pitch outcomes: run expectancy change from current count state.
    b = int(float(balls)) if _is_num(balls) else 0
    s = int(float(strikes)) if _is_num(strikes) else 0
    if pc in {"BallCalled", "BallIntentional", "BallinDirt"}:
        if b >= 3:
            return 0.33
        next_re = _state_re_no_runners(outs_i, b + 1, s)
        return next_re - curr_re
    if pc in {"StrikeCalled", "StrikeSwinging", "FoulBall", "FoulBallFieldable", "FoulBallNotFieldable"}:
        if pc in {"FoulBall", "FoulBallFieldable", "FoulBallNotFieldable"} and s >= 2:
            return 0.0
        if s >= 2:
            next_re = _state_re_no_runners(min(3, outs_i + 1), 0, 0)
            return next_re - curr_re
        next_re = _state_re_no_runners(outs_i, b, s + 1)
        return next_re - curr_re
    return 0.0


COMP_LEFT = -1.5
COMP_RIGHT = 1.5
COMP_BOTTOM = ((ZONE_BOTTOM + ZONE_TOP) / 2.0) - 1.5
COMP_TOP = ((ZONE_BOTTOM + ZONE_TOP) / 2.0) + 1.5
COMP_PCT_BOTTOM = 2.65 - 1.7
COMP_PCT_TOP = 2.65 + 1.3


def _count_state(balls: Any, strikes: Any) -> str:
    if not (_is_num(balls) and _is_num(strikes)):
        return "Even"
    b = int(float(balls))
    s = int(float(strikes))
    if (b, s) in {(0, 1), (0, 2), (1, 2)}:
        return "Ahead"
    if (b, s) in {(1, 0), (2, 0), (3, 0), (3, 1), (2, 1)}:
        return "Behind"
    return "Even"


def _zone9_square(x: Any, y: Any) -> Optional[int]:
    if not (_is_num(x) and _is_num(y)):
        return None
    xf = float(x)
    yf = float(y)
    if not (COMP_LEFT <= xf <= COMP_RIGHT and COMP_BOTTOM <= yf <= COMP_TOP):
        return None
    w = COMP_RIGHT - COMP_LEFT
    h = COMP_TOP - COMP_BOTTOM
    gx = min(max((xf - COMP_LEFT) / w, 0.0), 1.0)
    gy = min(max((yf - COMP_BOTTOM) / h, 0.0), 1.0)
    col = 1 if gx < (1 / 3) else (2 if gx < (2 / 3) else 3)
    row = 1 if gy >= (2 / 3) else (2 if gy >= (1 / 3) else 3)
    return (row - 1) * 3 + col


def _in_zone_label(plate_side: Any, plate_height: Any) -> str:
    if not (_is_num(plate_side) and _is_num(plate_height)):
        return "No"
    ps = float(plate_side)
    ph = float(plate_height)
    if ZONE_LEFT <= ps <= ZONE_RIGHT and ZONE_BOTTOM <= ph <= ZONE_TOP:
        return "Yes"
    if COMP_LEFT <= ps <= COMP_RIGHT and COMP_BOTTOM <= ph <= COMP_TOP:
        return "Competitive"
    return "No"


def _sq_to_rc(sq: int) -> tuple[int, int]:
    row = ((sq - 1) // 3) + 1
    col = ((sq - 1) % 3) + 1
    return row, col


def _qp_decay(state: str) -> List[float]:
    if state == "Ahead":
        return [1.00, 0.35, 0.15, 0.05]
    if state == "Even":
        return [1.00, 0.55, 0.25, 0.10]
    return [1.00, 0.75, 0.45, 0.20]  # Behind


def _qp_seeds_for(pitch_type: str, hand: str) -> List[tuple[int, int, float]]:
    hand_norm = "Left" if str(hand or "").strip().lower().startswith("l") else "Right"
    glove_col = 3 if hand_norm == "Left" else 1
    arm_col = 1 if glove_col == 3 else 3
    r_top, r_mid, r_bot = 1, 2, 3
    c_mid, c_g, c_a = 2, glove_col, arm_col
    pt = str(pitch_type or "")
    mapping: Dict[str, List[tuple[int, int, float]]] = {
        "Fastball": [(r_top, c_mid, 1.00), (r_top, c_g, 1.00), (r_top, c_a, 1.00)],
        "Sinker": [(r_bot, c_mid, 0.80), (r_bot, c_a, 1.00), (r_bot, c_g, 0.90)],
        "Cutter": [(r_mid, c_g, 1.00), (r_top, c_g, 1.00), (r_top, c_mid, 0.75), (r_bot, c_g, 0.80)],
        "Slider": [(r_bot, c_g, 1.00), (r_bot, c_mid, 0.80), (r_mid, c_g, 0.70)],
        "Sweeper": [(r_bot, c_g, 1.00), (r_bot, c_mid, 0.75), (r_mid, c_g, 0.65)],
        "Curveball": [(r_bot, c_mid, 1.00), (r_bot, c_g, 1.00), (r_bot, c_a, 1.00)],
        "ChangeUp": [(r_bot, c_mid, 1.00), (r_bot, c_a, 0.90), (r_bot, c_g, 0.70)],
        "Splitter": [(r_bot, c_mid, 1.00), (r_bot, c_a, 1.00), (r_bot, c_g, 1.00)],
    }
    return mapping.get(pt, [(r_mid, c_mid, 0.60)])


def _qp_weight_for_square(sq: Optional[int], pitch_type: str, hand: str, state: str) -> float:
    if sq is None:
        return 0.0
    row, col = _sq_to_rc(sq)
    decay = _qp_decay(state)
    best = 0.0
    for sr, sc, w in _qp_seeds_for(pitch_type, hand):
        d = abs(sr - row) + abs(sc - col)
        di = 3 if d >= 3 else d
        best = max(best, float(w) * decay[di])
    return best


def _compute_qp_point(row: Dict[str, Any]) -> Optional[float]:
    st = str(row.get("session_type_norm") or "").strip()
    s = st.lower()
    if not (("live" in s) or ("game" in s) or ("ab" in s) or ("season" in s)):
        return None
    sq = _zone9_square(row.get("plate_side"), row.get("plate_height"))
    if sq is None:
        return 0.0
    state = _count_state(row.get("balls_num"), row.get("strikes_num"))
    pitch_type = str(row.get("pitch_type") or "Undefined")
    hand = str(row.get("pitcherthrows") or ("Left" if row.get("is_lefty") else "Right"))
    return _qp_weight_for_square(sq, pitch_type, hand, state)


def _is_competitive_row(row: Dict[str, Any]) -> bool:
    st = str(row.get("session_type_norm") or "").strip().lower()
    return ("live" in st) or ("game" in st) or ("ab" in st) or ("season" in st)


def _split_key_from_row(row: Dict[str, Any], split_by: str) -> str:
    split = (split_by or "Pitch Types").strip()
    if split == "Pitch Types":
        return str(row.get("pitch_type") or "Unknown")
    if split == "Pitcher Hand":
        return _norm_hand(row.get("pitcherthrows"))
    if split == "Batter Hand":
        return _norm_hand(row.get("batterside"))
    if split == "Count":
        b = row.get("balls_num")
        s = row.get("strikes_num")
        return f"{b}-{s}" if b is not None and s is not None else "Unknown"
    if split == "After Count":
        b = row.get("prev_balls")
        s = row.get("prev_strikes")
        return f"{b}-{s}" if b is not None and s is not None else "Unknown"
    if split == "Zone Location":
        ph = row.get("plate_height")
        ps = row.get("plate_side")
        is_lefty = bool(row.get("is_lefty"))
        if not _is_num(ph) or not _is_num(ps):
            return "Unknown"
        phf = float(ph)
        psf = float(ps)
        vert = "Upper Half" if phf >= ZONE_MID_Y else "Bottom Half"
        if is_lefty:
            horiz = "Glove Side Half" if psf >= ZONE_MID_X else "Arm Side Half"
        else:
            horiz = "Glove Side Half" if psf <= ZONE_MID_X else "Arm Side Half"
        return f"{vert} / {horiz}"
    if split == "Times Through Order":
        return str(row.get("times_through_order") or "Unknown")
    if split == "Velocity":
        return _bucket_metric(row.get("rel_speed"), 5.0, "mph")
    if split == "IVB":
        return _bucket_metric(row.get("ivb"), 5.0, "")
    if split == "HB":
        return _bucket_metric(row.get("hb"), 5.0, "")
    if split == "Pitcher":
        return str(row.get("pitcher") or "Unknown")
    if split == "Pitcher Team":
        norm = str(row.get("pitcher_team_norm") or "").strip()
        if norm:
            return norm
        raw = str(row.get("pitcherteam") or row.get("pitcher_team_code") or "").strip()
        return _normalize_team_code(raw) or "Unknown"
    if split == "Batter":
        return str(row.get("batter") or "Unknown")
    if split == "Batter Team":
        norm = str(row.get("batter_team_norm_eff") or row.get("batter_team_norm") or "").strip()
        if norm:
            return norm
        raw = str(row.get("batterteam") or row.get("batter_team_code") or "").strip()
        return _normalize_team_code(raw) or "Unknown"
    if split == "Catcher":
        return str(row.get("catcher") or "Unknown")
    return str(row.get("pitch_type") or "Unknown")


def _times_through_order_label(pa_ord: int) -> str:
    if pa_ord <= 0:
        return "Unknown"
    if pa_ord <= 9:
        return "1"
    if pa_ord <= 18:
        return "2"
    if pa_ord <= 27:
        return "3"
    return "4+"


def _annotate_times_through_order(rows: List[Dict[str, Any]]) -> None:
    if not rows:
        return
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        game_key = (
            str(row.get("game_id") or "").strip()
            or str(row.get("game_uid") or "").strip()
            or str(row.get("game_foreign_id") or "").strip()
            or str(row.get("session_date") or "").strip()
            or "unknown_game"
        )
        pitcher_key = str(row.get("pitcher") or "").strip() or "unknown_pitcher"
        grouped.setdefault(f"{game_key}|{pitcher_key}", []).append(row)

    def _row_sort_key(row: Dict[str, Any]) -> tuple:
        return (
            str(row.get("session_date") or ""),
            int(float(row.get("pitch_number"))) if _is_num(row.get("pitch_number")) else 0,
            int(float(row.get("pitch_no"))) if _is_num(row.get("pitch_no")) else 0,
            int(float(row.get("pitch_event_id"))) if _is_num(row.get("pitch_event_id")) else 0,
            int(float(row.get("id"))) if _is_num(row.get("id")) else 0,
        )

    for bucket in grouped.values():
        ordered = sorted(bucket, key=_row_sort_key)
        pa_order_by_play: Dict[str, int] = {}
        pa_counter = 0
        prev_terminal = True
        prev_batter = ""
        for row in ordered:
            play_id = str(row.get("play_id") or "").strip()
            if play_id:
                pa_ord = pa_order_by_play.get(play_id)
                if pa_ord is None:
                    pa_counter += 1
                    pa_ord = pa_counter
                    pa_order_by_play[play_id] = pa_ord
            else:
                batter = str(row.get("batter") or "").strip()
                starts_new_pa = prev_terminal or (bool(prev_batter) and bool(batter) and batter != prev_batter)
                if starts_new_pa:
                    pa_counter += 1
                if pa_counter <= 0:
                    pa_counter = 1
                pa_ord = pa_counter
                if batter:
                    prev_batter = batter
            row["times_through_order"] = _times_through_order_label(pa_ord)
            prev_terminal = _ab_is_terminal(row)


def _pitch_type_sort_rank(name: str) -> int:
    order = {
        "Fastball": 1,
        "Sinker": 2,
        "Cutter": 3,
        "Slider": 4,
        "Sweeper": 5,
        "Curveball": 6,
        "ChangeUp": 7,
        "Splitter": 8,
        "Knuckleball": 9,
        "Undefined": 10,
    }
    return order.get((name or "").strip(), 99)


def _valid_pitch_types(values: List[str]) -> List[str]:
    return [value for value in values if str(value or "").strip() and str(value).strip() != "Undefined"]


ALL_TABLE_COLUMNS: List[str] = [
    "#",
    "Usage",
    "Overall",
    "BF",
    "Velo",
    "Max",
    "IVB",
    "HB",
    "Spin",
    "rTilt",
    "bTilt",
    "SpinEff",
    "Height",
    "Side",
    "Ext",
    "VAA",
    "HAA",
    "Strike%",
    "Swing%",
    "FPS%",
    "Early%",
    "Ahead%",
    "E+A%",
    "1-1W%",
    "InZone%",
    "Comp%",
    "QP%",
    "Whiff%",
    "K%",
    "BB%",
    "GB%",
    "Barrel%",
    "CSW%",
    "EV",
    "LA",
    "Stuff+",
    "Ctrl+",
    "QP+",
    "Pitching+",
    "RV/100",
    "IP",
    "P",
    "P/IP",
    "P/BF",
    "H",
    "XBH",
    "Barrels",
    "BB",
    "HBP",
    "K",
    "Whiffs",
    "0-0",
    "Behind",
    "Even",
    "Ahead",
    "<2K",
    "2K",
    "PA",
    "AB",
    "AVG",
    "SLG",
    "OBP",
    "OPS",
    "wOBA",
    "xWOBA",
    "ISO",
    "xISO",
    "BABIP",
    "Called-S%",
    "Take%",
    "Chase%",
    "GoZoneSw%",
    "IZswing%",
    "EdgeSwing%",
    "PosSD%",
    "Swings",
    "Takes",
    "Called-S",
    "Chases",
    "IZswings",
    "FPS",
    "EdgeSwings",
    "PosSD",
    "GoZoneSw",
]


def _normalize_custom_columns(custom_columns: Optional[List[str]]) -> List[str]:
    if not custom_columns:
        return []
    allowed = set(ALL_TABLE_COLUMNS)
    seen: set[str] = set()
    out: List[str] = []
    for raw in custom_columns:
        col = (raw or "").strip()
        if not col or col not in allowed or col in seen:
            continue
        out.append(col)
        seen.add(col)
    return out


def _build_dynamic_table(
    rows: List[Dict[str, Any]],
    mode: str,
    split_by: str,
    avg_stuff_by_pitch_type: Dict[str, float],
    custom_columns: Optional[List[str]] = None,
) -> tuple[List[str], List[Dict[str, Any]], List[str]]:
    mode_key = (mode or "Stuff").strip()
    split_col_map: Dict[str, str] = {
        "Pitch Types": "Pitch",
        "Pitcher Hand": "Pitcher Hand",
        "Batter Hand": "Batter Hand",
        "Count": "Count",
        "After Count": "After Count",
        "Zone Location": "Zone Location",
        "Times Through Order": "Times Through Order",
        "Velocity": "Velocity",
        "IVB": "InducedVert",
        "HB": "HorzBreak",
        "Pitcher": "Pitcher",
        "Batter": "Batter",
        "Catcher": "Catcher",
    }
    split_col_name = split_col_map.get((split_by or "Pitch Types").strip(), "Pitch")
    groups: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        key = _split_key_from_row(row, split_by)
        groups.setdefault(key, []).append(row)

    out_rows: List[Dict[str, Any]] = []
    total = sum(len(v) for v in groups.values()) or 1

    def _row_for_group(key: str, grp: List[Dict[str, Any]]) -> Dict[str, Any]:
        n = len(grp)
        strike_calls = {"StrikeCalled", "StrikeSwinging", "FoulBall", "FoulBallFieldable", "FoulBallNotFieldable", "InPlay"}
        swing_calls = {"StrikeSwinging", "FoulBall", "FoulBallFieldable", "FoulBallNotFieldable", "InPlay"}
        ahead_strike_calls = {"StrikeCalled", "StrikeSwinging", "FoulBall", "FoulBallFieldable", "FoulBallNotFieldable"}
        ea_strike_calls = {"StrikeCalled", "StrikeSwinging", "FoulBall", "FoulBallFieldable", "FoulBallNotFieldable", "InPlay"}
        one_one_strike_calls = {"StrikeCalled", "StrikeSwinging", "FoulBall", "FoulBallFieldable", "FoulBallNotFieldable", "InPlay"}
        velo_vals = [r.get("rel_speed") for r in grp if _is_num(r.get("rel_speed"))]
        ivb_vals = [r.get("ivb") for r in grp if _is_num(r.get("ivb"))]
        hb_vals = [r.get("hb") for r in grp if _is_num(r.get("hb"))]
        spin_vals = [r.get("spin_rate") for r in grp if _is_num(r.get("spin_rate"))]
        r_tilt_vals = [r.get("release_tilt") for r in grp]
        b_tilt_vals = [r.get("break_tilt") for r in grp]
        live_rows = [r for r in grp if _is_competitive_row(r)]
        ev_vals = [r.get("exit_speed") for r in live_rows if _is_num(r.get("exit_speed"))]
        la_vals = [r.get("angle") for r in live_rows if _is_num(r.get("angle"))]
        height_vals = [r.get("rel_height") for r in grp if _is_num(r.get("rel_height"))]
        side_vals = [r.get("rel_side") for r in grp if _is_num(r.get("rel_side"))]
        ext_vals = [r.get("ext_value") for r in grp if _is_num(r.get("ext_value"))]
        vaa_vals = [r.get("vaa") for r in grp if _is_num(r.get("vaa"))]
        haa_vals = [r.get("haa") for r in grp if _is_num(r.get("haa"))]
        spin_eff_vals = [r.get("spin_eff") for r in grp if _is_num(r.get("spin_eff"))]
        in_zone_n = sum(
            1
            for r in grp
            if _is_num(r.get("plate_side"))
            and _is_num(r.get("plate_height"))
            and (ZONE_LEFT <= float(r["plate_side"]) <= ZONE_RIGHT)
            and (ZONE_BOTTOM <= float(r["plate_height"]) <= ZONE_TOP)
        )
        green_half = 7.0 / 24.0
        green_left = ZONE_MID_X - green_half
        green_right = ZONE_MID_X + green_half
        green_bottom = ZONE_MID_Y - green_half
        green_top = ZONE_MID_Y + green_half

        called_strikes = 0
        takes = 0
        swings_count = 0
        fps_count = 0
        chase_den = 0
        chase_num = 0
        gozone_den = 0
        gozone_sw_num = 0
        iz_den = 0
        iz_sw_num = 0
        edge_den = 0
        edge_sw_num = 0
        possd_points = 0
        for r in grp:
            pitch_call = str(r.get("pitch_call") or "")
            is_swing = pitch_call in swing_calls
            if is_swing:
                swings_count += 1
            if pitch_call == "StrikeCalled":
                called_strikes += 1
            if pitch_call in {"BallCalled", "StrikeCalled", "Ball"}:
                takes += 1
            if (
                (r.get("balls_num") == 0 and r.get("strikes_num") == 0)
                and pitch_call in {"StrikeCalled", "StrikeSwinging", "FoulBall", "FoulBallFieldable", "FoulBallNotFieldable", "InPlay"}
            ):
                fps_count += 1
            if not (_is_num(r.get("plate_side")) and _is_num(r.get("plate_height"))):
                continue
            ps = float(r.get("plate_side"))
            ph = float(r.get("plate_height"))
            is_in_zone = (ZONE_LEFT <= ps <= ZONE_RIGHT) and (ZONE_BOTTOM <= ph <= ZONE_TOP)
            is_green = (green_left <= ps <= green_right) and (green_bottom <= ph <= green_top)
            is_outside = not is_in_zone
            is_edge = is_in_zone and (not is_green)
            if is_outside:
                chase_den += 1
                if is_swing:
                    chase_num += 1
            if is_green:
                gozone_den += 1
                if is_swing:
                    gozone_sw_num += 1
            if is_in_zone:
                iz_den += 1
                if is_swing:
                    iz_sw_num += 1
            if is_edge:
                edge_den += 1
                if is_swing:
                    edge_sw_num += 1
            if (is_swing and is_green) or ((not is_swing) and is_outside):
                possd_points += 1
        qp_n = sum(
            1
            for r in grp
            if _is_num(r.get("plate_side"))
            and _is_num(r.get("plate_height"))
            and (-1.5 <= float(r["plate_side"]) <= 1.5)
            and (COMP_PCT_BOTTOM <= float(r["plate_height"]) <= COMP_PCT_TOP)
        )
        loc_n = sum(1 for r in grp if _is_num(r.get("plate_side")) and _is_num(r.get("plate_height")))
        strike_n = sum(1 for r in grp if str(r.get("pitch_call") or "") in strike_calls)
        called_strike_n = sum(1 for r in grp if str(r.get("pitch_call") or "") == "StrikeCalled")
        swing_n = sum(1 for r in grp if str(r.get("pitch_call") or "") in swing_calls)
        whiff_n = sum(1 for r in grp if str(r.get("pitch_call") or "") == "StrikeSwinging")
        bb_n = sum(1 for r in grp if str(r.get("korbb") or "") == "Walk")
        k_n = sum(1 for r in grp if str(r.get("korbb") or "") == "Strikeout")
        hbp_n = sum(1 for r in grp if str(r.get("pitch_call") or "") == "HitByPitch" or str(r.get("play_result") or "") == "HitByPitch")
        gb_n = sum(1 for r in grp if str(r.get("tagged_hit_type") or "") == "GroundBall")
        in_play_n = sum(1 for r in grp if str(r.get("pitch_call") or "") == "InPlay")
        in_play_live_n = sum(1 for r in live_rows if str(r.get("pitch_call") or "") == "InPlay")
        csw_n = called_strike_n + whiff_n
        hit_n = sum(1 for r in grp if str(r.get("play_result") or "") in {"Single", "Double", "Triple", "HomeRun"})
        xbh_n = sum(1 for r in grp if str(r.get("play_result") or "") in {"Double", "Triple", "HomeRun"})
        barrel_n_all = 0
        for r in grp:
            ev = r.get("exit_speed")
            la = r.get("angle")
            if _is_num(ev) and _is_num(la):
                evf = float(ev)
                laf = float(la)
                if evf >= 95.0 and 10.0 <= laf <= 30.0:
                    barrel_n_all += 1
        barrel_n_live = 0
        for r in live_rows:
            ev = r.get("exit_speed")
            la = r.get("angle")
            if _is_num(ev) and _is_num(la):
                evf = float(ev)
                laf = float(la)
                if evf >= 95.0 and 10.0 <= laf <= 35.0:
                    barrel_n_live += 1

        fps_opp = sum(1 for r in grp if r.get("balls_num") == 0 and r.get("strikes_num") == 0)
        fps_yes = sum(
            1
            for r in grp
            if r.get("balls_num") == 0
            and r.get("strikes_num") == 0
            and str(r.get("pitch_call") or "") in {"StrikeCalled", "StrikeSwinging", "FoulBall", "FoulBallFieldable", "InPlay"}
        )
        count_00 = sum(1 for r in grp if r.get("balls_num") == 0 and r.get("strikes_num") == 0)
        count_behind = sum(1 for r in grp if (r.get("balls_num"), r.get("strikes_num")) in {(1, 0), (2, 0), (3, 0), (3, 1), (2, 1)})
        count_even = sum(1 for r in grp if (r.get("balls_num"), r.get("strikes_num")) in {(0, 0), (1, 1), (2, 2), (3, 2)})
        count_ahead = sum(1 for r in grp if (r.get("balls_num"), r.get("strikes_num")) in {(0, 1), (0, 2), (1, 2)})
        count_lt2k = sum(1 for r in grp if (r.get("strikes_num") is not None and int(r.get("strikes_num")) < 2))
        count_2k = sum(1 for r in grp if r.get("strikes_num") == 2)
        one_one_total = sum(1 for r in grp if r.get("balls_num") == 1 and r.get("strikes_num") == 1)
        one_one_success = sum(1 for r in grp if r.get("balls_num") == 1 and r.get("strikes_num") == 1 and str(r.get("pitch_call") or "") in one_one_strike_calls)
        outs_on_play_n = sum(int(r.get("outs_on_play_num") or 0) for r in grp if r.get("outs_on_play_num") is not None)
        # Match Shiny IP logic: include strikeout outs in total outs.
        outs_n = outs_on_play_n + k_n
        bf_starts = sum(1 for r in grp if r.get("balls_num") == 0 and r.get("strikes_num") == 0)
        qp_points = [q for q in (_compute_qp_point(r) for r in grp) if q is not None]
        qp_count = sum(1 for q in qp_points if (q * 200.0) >= 100.0)
        qp_mean = (sum(qp_points) / len(qp_points)) if qp_points else None
        ctrl_scores: List[float] = []
        for r in grp:
            ps = r.get("plate_side")
            ph = r.get("plate_height")
            if not (_is_num(ps) and _is_num(ph)):
                continue
            psv = float(ps)
            phv = float(ph)
            if (ZONE_LEFT <= psv <= ZONE_RIGHT) and (ZONE_BOTTOM <= phv <= ZONE_TOP):
                ctrl_scores.append(1.47)
            elif (-1.5 <= psv <= 1.5) and (COMP_PCT_BOTTOM <= phv <= COMP_PCT_TOP):
                ctrl_scores.append(0.73)
            else:
                ctrl_scores.append(0.0)
        ctrl_plus = round((sum(ctrl_scores) / len(ctrl_scores)) * 100.0, 1) if ctrl_scores else None

        pitch_types = [str(r.get("pitch_type") or "") for r in grp]
        stuff_vals = [avg_stuff_by_pitch_type.get(pt) for pt in pitch_types if avg_stuff_by_pitch_type.get(pt) is not None]
        fps_opp = sum(1 for r in grp if _is_competitive_row(r) and r.get("balls_num") == 0 and r.get("strikes_num") == 0)
        fps_yes = sum(
            1
            for r in grp
            if _is_competitive_row(r)
            and r.get("balls_num") == 0
            and r.get("strikes_num") == 0
            and str(r.get("pitch_call") or "") in strike_calls
        )
        early_n = sum(
            1
            for r in grp
            if _is_competitive_row(r)
            and (
                (r.get("balls_num"), r.get("strikes_num")) in {(0, 0), (0, 1), (1, 0), (1, 1)}
            )
            and str(r.get("pitch_call") or "") == "InPlay"
        )
        ahead_state_n = sum(
            1
            for r in grp
            if _is_competitive_row(r)
            and (r.get("balls_num"), r.get("strikes_num")) in {(0, 1), (1, 1)}
            and str(r.get("pitch_call") or "") in ahead_strike_calls
        )
        ea_yes = sum(
            1
            for r in grp
            if r.get("balls_num") == 0
            and r.get("strikes_num") == 0
            and _is_competitive_row(r)
            and str(r.get("pitch_call") or "") == "InPlay"
        ) + sum(
            1
            for r in grp
            if (
                _is_competitive_row(r)
                and (
                    (
                        (r.get("balls_num"), r.get("strikes_num")) in {(0, 1), (1, 1)}
                        and str(r.get("pitch_call") or "") in ea_strike_calls
                    )
                    or (
                        r.get("balls_num") == 1 and r.get("strikes_num") == 0 and str(r.get("pitch_call") or "") == "InPlay"
                    )
                )
            )
        )
        rv_rows = live_rows if live_rows else grp
        rv_vals = [
            _calc_run_value(
                r.get("pitch_call"),
                r.get("play_result"),
                r.get("korbb"),
                r.get("balls_num"),
                r.get("strikes_num"),
                r.get("outs_num"),
                r.get("outs_on_play_num"),
            )
            for r in rv_rows
        ]
        rv100 = (((sum(rv_vals) / len(rv_vals)) * 100.0) - 0.43) if rv_vals else None

        terminal_rows = [
            r
            for r in grp
            if (str(r.get("play_result") or "") not in {"", "Undefined"})
            or (str(r.get("korbb") or "") in {"Strikeout", "Walk"})
        ]
        pa_ct = len(terminal_rows)
        h1 = sum(1 for r in terminal_rows if str(r.get("play_result") or "") == "Single")
        h2 = sum(1 for r in terminal_rows if str(r.get("play_result") or "") == "Double")
        h3 = sum(1 for r in terminal_rows if str(r.get("play_result") or "") == "Triple")
        hr = sum(1 for r in terminal_rows if str(r.get("play_result") or "") == "HomeRun")
        bb_term = sum(1 for r in terminal_rows if str(r.get("korbb") or "") == "Walk" or str(r.get("play_result") or "") == "Walk")
        ibb = sum(1 for r in terminal_rows if str(r.get("play_result") or "") == "IntentionalWalk")
        hbp_term = sum(1 for r in terminal_rows if str(r.get("play_result") or "") == "HitByPitch")
        sf = sum(1 for r in terminal_rows if str(r.get("play_result") or "") == "Sacrifice")
        inplay_term = sum(1 for r in terminal_rows if str(r.get("pitch_call") or "") == "InPlay")
        ab = pa_ct - (bb_term + hbp_term + sf)
        h = h1 + h2 + h3 + hr
        tb = h1 + 2 * h2 + 3 * h3 + 4 * hr
        avg = round(h / ab, 3) if ab > 0 else None
        slg = round(tb / ab, 3) if ab > 0 else None
        obp = round((h + bb_term + hbp_term) / pa_ct, 3) if pa_ct > 0 else None
        ops = round((slg or 0) + (obp or 0), 3) if (slg is not None and obp is not None) else None
        ubb = bb_term - ibb
        woba_num = 0.690 * ubb + 0.722 * hbp_term + 0.888 * h1 + 1.271 * h2 + 1.616 * h3 + 2.101 * hr
        woba_den = ab + bb_term - ibb + sf + hbp_term
        woba = round(woba_num / woba_den, 3) if woba_den > 0 else None
        iso = round((slg - avg), 3) if (slg is not None and avg is not None) else None
        babip = round(h / inplay_term, 3) if inplay_term > 0 else None
        bf_live = sum(1 for r in live_rows if r.get("balls_num") == 0 and r.get("strikes_num") == 0)
        xwoba_num = (
            0.69 * sum(1 for r in live_rows if str(r.get("korbb") or "") == "Walk")
            + 0.90 * sum(1 for r in live_rows if str(r.get("play_result") or "") == "Single")
            + 1.24 * sum(1 for r in live_rows if str(r.get("play_result") or "") == "Double")
            + 1.56 * sum(1 for r in live_rows if str(r.get("play_result") or "") == "Triple")
            + 1.95 * sum(1 for r in live_rows if str(r.get("play_result") or "") == "HomeRun")
        )
        xwoba = round(xwoba_num / bf_live, 3) if bf_live > 0 else None
        xiso = round((h2 + 2 * h3 + 3 * hr) / ab, 3) if ab > 0 else None

        ip_whole = outs_n // 3
        ip_rem = outs_n % 3
        ip_display = f"{ip_whole}.{ip_rem}" if ip_rem else str(ip_whole)
        ip_num = (outs_n / 3.0) if outs_n else 0.0

        row_out: Dict[str, Any] = {
            split_col_name: key,
            "#": n,
            "Usage": f"{round(100.0 * n / total, 1)}%",
            "Overall": f"{round(100.0 * n / total, 1)}%",
            "BF": bf_starts,
            "Velo": round(sum(float(v) for v in velo_vals) / len(velo_vals), 1) if velo_vals else None,
            "Max": round(max(float(v) for v in velo_vals), 1) if velo_vals else None,
            "IVB": round(sum(float(v) for v in ivb_vals) / len(ivb_vals), 1) if ivb_vals else None,
            "HB": round(sum(float(v) for v in hb_vals) / len(hb_vals), 1) if hb_vals else None,
            "Spin": round(sum(float(v) for v in spin_vals) / len(spin_vals), 0) if spin_vals else None,
            "rTilt": _tilt_values_to_clock(r_tilt_vals),
            "bTilt": _tilt_values_to_clock(b_tilt_vals),
            "SpinEff": f"{round(100.0 * (sum(float(v) for v in spin_eff_vals) / len(spin_eff_vals)), 1)}%" if spin_eff_vals else None,
            "Height": round(sum(float(v) for v in height_vals) / len(height_vals), 1) if height_vals else None,
            "Side": round(sum(float(v) for v in side_vals) / len(side_vals), 1) if side_vals else None,
            "Ext": round(sum(float(v) for v in ext_vals) / len(ext_vals), 1) if ext_vals else None,
            "VAA": round(sum(float(v) for v in vaa_vals) / len(vaa_vals), 1) if vaa_vals else None,
            "HAA": round(sum(float(v) for v in haa_vals) / len(haa_vals), 1) if haa_vals else None,
            "Strike%": f"{round(100.0 * strike_n / n, 1)}%" if n else None,
            "Swing%": f"{round(100.0 * swing_n / n, 1)}%" if n else None,
            "FPS%": f"{round(100.0 * fps_yes / fps_opp, 1)}%" if fps_opp else None,
            "Called-S%": f"{round(100.0 * called_strikes / n, 1)}%" if n else None,
            "Take%": f"{round(100.0 * takes / n, 1)}%" if n else None,
            "Chase%": f"{round(100.0 * chase_num / chase_den, 1)}%" if chase_den else None,
            "GoZoneSw%": f"{round(100.0 * gozone_sw_num / gozone_den, 1)}%" if gozone_den else None,
            "IZswing%": f"{round(100.0 * iz_sw_num / iz_den, 1)}%" if iz_den else None,
            "EdgeSwing%": f"{round(100.0 * edge_sw_num / edge_den, 1)}%" if edge_den else None,
            "PosSD%": f"{round(100.0 * possd_points / n, 1)}%" if n else None,
            "Early%": f"{round(100.0 * early_n / fps_opp, 1)}%" if fps_opp else None,
            "Ahead%": f"{round(100.0 * ahead_state_n / fps_opp, 1)}%" if fps_opp else None,
            "E+A%": f"{round(100.0 * ea_yes / fps_opp, 1)}%" if fps_opp else None,
            "1-1W%": f"{round(100.0 * one_one_success / one_one_total, 1)}%" if one_one_total else None,
            "InZone%": f"{round(100.0 * in_zone_n / loc_n, 1)}%" if loc_n else None,
            "Comp%": f"{round(100.0 * qp_n / loc_n, 1)}%" if loc_n else None,
            "QP%": f"{round(100.0 * qp_count / n, 1)}%" if n else None,
            "Whiff%": f"{round(100.0 * whiff_n / swing_n, 1)}%" if swing_n else None,
            "K%": f"{round(100.0 * k_n / bf_starts, 1)}%" if bf_starts else None,
            "BB%": f"{round(100.0 * bb_n / bf_starts, 1)}%" if bf_starts else None,
            "GB%": f"{round(100.0 * gb_n / in_play_n, 1)}%" if in_play_n else None,
            "Barrel%": f"{round(100.0 * barrel_n_live / in_play_live_n, 1)}%" if in_play_live_n else (f"{round(100.0 * barrel_n_all / in_play_n, 1)}%" if in_play_n else None),
            "CSW%": f"{round(100.0 * csw_n / n, 1)}%" if n else None,
            "EV": round(sum(float(v) for v in ev_vals) / len(ev_vals), 1) if ev_vals else None,
            "LA": round(sum(float(v) for v in la_vals) / len(la_vals), 1) if la_vals else None,
            "Stuff+": round(sum(float(v) for v in stuff_vals) / len(stuff_vals), 1) if stuff_vals else None,
            "Ctrl+": ctrl_plus,
            "QP+": round((qp_mean * 200.0), 1) if _is_num(qp_mean) else None,
            "Pitching+": None,
            "RV/100": round(rv100, 1) if _is_num(rv100) else None,
            "IP": ip_display if outs_n else None,
            "P": n,
            "P/IP": round(float(n) / ip_num, 2) if ip_num > 0 else None,
            "P/BF": round(float(n) / bf_starts, 2) if bf_starts else None,
            "H": hit_n,
            "XBH": xbh_n,
            "Barrels": barrel_n_live if in_play_live_n else barrel_n_all,
            "BB": bb_n,
            "HBP": hbp_n,
            "K": k_n,
            "Whiffs": whiff_n,
            "Swings": swings_count,
            "Takes": takes,
            "Called-S": called_strikes,
            "Chases": chase_num,
            "IZswings": iz_sw_num,
            "FPS": fps_count,
            "EdgeSwings": edge_sw_num,
            "PosSD": possd_points,
            "GoZoneSw": gozone_sw_num,
            "0-0": f"{round(100.0 * count_00 / n, 1)}%" if n else None,
            "Behind": f"{round(100.0 * count_behind / n, 1)}%" if n else None,
            "Even": f"{round(100.0 * count_even / n, 1)}%" if n else None,
            "Ahead": f"{round(100.0 * count_ahead / n, 1)}%" if n else None,
            "<2K": f"{round(100.0 * count_lt2k / n, 1)}%" if n else None,
            "2K": f"{round(100.0 * count_2k / n, 1)}%" if n else None,
            "PA": pa_ct,
            "AB": ab,
            "AVG": avg,
            "SLG": slg,
            "OBP": obp,
            "OPS": ops,
            "wOBA": woba,
            "xWOBA": xwoba,
            "ISO": iso,
            "xISO": xiso,
            "BABIP": babip,
        }
        if _is_num(row_out.get("Stuff+")) and row_out.get("QP+"):
            try:
                row_out["Pitching+"] = round((float(row_out["Stuff+"]) + float(row_out["QP+"])) / 2.0, 1)
            except Exception:
                row_out["Pitching+"] = None
        return row_out

    ordered_items: List[tuple[str, List[Dict[str, Any]]]]
    split_clean = (split_by or "Pitch Types").strip()
    if split_clean == "Pitch Types":
        ordered_items = sorted(groups.items(), key=lambda kv: (_pitch_type_sort_rank(kv[0]), kv[0]))
    elif split_clean == "Times Through Order":
        tto_rank = {"1": 0, "2": 1, "3": 2, "4+": 3}
        ordered_items = sorted(groups.items(), key=lambda kv: (tto_rank.get(str(kv[0]), 9), str(kv[0])))
    else:
        ordered_items = sorted(groups.items(), key=lambda kv: (-len(kv[1]), kv[0]))
    for key, grp in ordered_items:
        out_rows.append(_row_for_group(key, grp))

    # Always add an All row at the bottom for split views.
    all_group = [r for group_rows in groups.values() for r in group_rows]
    if all_group:
        out_rows.append(_row_for_group("All", all_group))

    column_map: Dict[str, List[str]] = {
        "Stuff": [split_col_name, "#", "Velo", "Max", "IVB", "HB", "rTilt", "bTilt", "SpinEff", "Spin", "Height", "Side", "Ext", "VAA", "HAA", "Stuff+"],
        "Process": [split_col_name, "#", "BF", "RV/100", "InZone%", "Comp%", "Strike%", "Swing%", "FPS%", "Early%", "Ahead%", "E+A%", "1-1W%", "QP%", "Ctrl+", "QP+", "Pitching+"],
        "Results": [split_col_name, "#", "BF", "K%", "BB%", "GB%", "Barrel%", "Whiff%", "CSW%", "EV", "LA"],
        "Hitting Results": [split_col_name, "PA", "AB", "AVG", "SLG", "OBP", "OPS", "wOBA", "xWOBA", "ISO", "xISO", "BABIP", "Swing%", "Whiff%", "GB%", "K%", "BB%", "Barrel%", "EV", "LA"],
        "Bullpen": [split_col_name, "#", "Velo", "Max", "IVB", "HB", "Spin", "bTilt", "Height", "Side", "Ext", "InZone%", "Comp%", "Ctrl+", "Stuff+"],
        "Live": [split_col_name, "#", "Velo", "Max", "IVB", "HB", "FPS%", "E+A%", "InZone%", "Strike%", "Whiff%", "K%", "BB%", "QP+"],
        "Usage": [split_col_name, "#", "Usage", "0-0", "Behind", "Even", "Ahead", "<2K", "2K"],
        "Raw Data": [split_col_name, "IP", "P", "BF", "P/IP", "P/BF", "H", "XBH", "Barrels", "BB", "HBP", "K", "Whiffs"],
        "Batted Ball Data": [split_col_name, "PA", "AB", "AVG", "SLG", "OBP", "OPS", "wOBA", "xWOBA", "ISO", "xISO", "BABIP", "Barrel%"],
        "Swing Decisions": [split_col_name, "Swing%", "FPS%", "Called-S%", "Take%", "Chase%", "GoZoneSw%", "IZswing%", "EdgeSwing%", "PosSD%"],
        "Custom": [split_col_name],
    }
    if mode_key == "Custom":
        normalized_custom = _normalize_custom_columns(custom_columns)
        columns = [split_col_name, *normalized_custom]
    else:
        columns = column_map.get(mode_key, column_map["Stuff"])
    return columns, out_rows, ALL_TABLE_COLUMNS


def _pitch_action_payload(row: Dict[str, Any], avg_stuff_by_pitch_type: Dict[str, float]) -> Dict[str, Any]:
    qp = _compute_qp_point(row)
    run_value = _calc_run_value(
        row.get("pitch_call"),
        row.get("play_result"),
        row.get("korbb"),
        row.get("balls_num"),
        row.get("strikes_num"),
        row.get("outs_num"),
        row.get("outs_on_play_num"),
    )
    return {
        "pitch_event_id": row.get("id"),
        "pitch_uid": str(row.get("pitch_uid") or ""),
        "play_id": str(row.get("play_id") or ""),
        "game_id": str(row.get("game_id") or ""),
        "game_uid": str(row.get("game_uid") or ""),
        "game_foreign_id": str(row.get("game_foreign_id") or ""),
        "inning": str(row.get("inning") or ""),
        "pitch_no": row.get("pitch_no"),
        "pitch_number": row.get("pitch_number"),
        "session_date": row.get("session_date").isoformat() if row.get("session_date") else None,
        "pitcher": str(row.get("pitcher") or ""),
        "batter": str(row.get("batter") or ""),
        "catcher": str(row.get("catcher") or ""),
        "pitcherthrows": str(row.get("pitcherthrows") or ""),
        "batterside": str(row.get("batterside") or ""),
        "pitcher_team_code": str(row.get("pitcher_team_code") or ""),
        "batter_team_code": str(row.get("batter_team_code") or ""),
        "pitcher_team_norm": str(row.get("pitcher_team_norm") or ""),
        "batter_team_norm": str(row.get("batter_team_norm_eff") or row.get("batter_team_norm") or ""),
        "pitch_type": str(row.get("pitch_type") or "Undefined"),
        "session_type": str(row.get("session_type_norm") or ""),
        "pitch_call": str(row.get("pitch_call") or ""),
        "play_result": str(row.get("play_result") or ""),
        "korbb": str(row.get("korbb") or ""),
        "tagged_hit_type": str(row.get("tagged_hit_type") or ""),
        "balls_num": row.get("balls_num"),
        "strikes_num": row.get("strikes_num"),
        "outs_num": row.get("outs_num"),
        "outs_on_play_num": row.get("outs_on_play_num"),
        "run_value": run_value,
        "release_side": row.get("rel_side"),
        "release_height": row.get("rel_height"),
        "extension": row.get("ext_value"),
        "hb": row.get("hb"),
        "ivb": row.get("ivb"),
        "plate_side": row.get("plate_side"),
        "plate_height": row.get("plate_height"),
        "velo": row.get("rel_speed"),
        "spin": row.get("spin_rate"),
        "release_tilt": str(row.get("release_tilt") or ""),
        "break_tilt": str(row.get("break_tilt") or ""),
        "spin_eff": row.get("spin_eff"),
        "exit_speed": row.get("exit_speed"),
        "angle": row.get("angle"),
        "stuff_plus": avg_stuff_by_pitch_type.get(str(row.get("pitch_type") or "")),
        "qp_plus": (round(float(qp) * 200.0, 1) if _is_num(qp) else None),
        "video_clip_1": str(row.get("video_clip_1") or ""),
        "video_clip_2": str(row.get("video_clip_2") or ""),
        "video_clip_3": str(row.get("video_clip_3") or ""),
    }


def _build_chart_points(
    rows: List[Dict[str, Any]], avg_stuff_by_pitch_type: Dict[str, float], max_points: int = 3500
) -> List[Dict[str, Any]]:
    if not rows:
        return []
    step = max(1, len(rows) // max_points) if len(rows) > max_points else 1
    sampled = rows[::step]
    points: List[Dict[str, Any]] = []
    for row in sampled[:max_points]:
        points.append(_pitch_action_payload(row, avg_stuff_by_pitch_type))
    return points


def _build_trend_rows(
    rows: List[Dict[str, Any]],
    avg_stuff_by_pitch_type: Dict[str, float],
    use_osu_date_session_rules: bool = False,
) -> List[Dict[str, Any]]:
    if not rows:
        return []

    def _bucket(row: Dict[str, Any]) -> Optional[str]:
        st = str(row.get("session_type_norm") or "").lower()
        st_compact = re.sub(r"[\s_-]+", "", st)
        if "bull" in st_compact or "prac" in st_compact:
            return "Bullpen"
        dt = row.get("session_date")
        dt_val: Optional[date]
        if isinstance(dt, date):
            dt_val = dt
        else:
            dt_str = str(dt or "")[:10]
            if not dt_str:
                dt_val = None
            else:
                try:
                    dt_val = date.fromisoformat(dt_str)
                except ValueError:
                    dt_val = None
        if use_osu_date_session_rules and dt_val is not None:
            if dt_val < OSU_SEASON_START:
                return "Live BP"
            if dt_val <= OSU_SEASON_END:
                return "Season"
            return "Season"
        return None

    grouped: Dict[tuple[str, str], Dict[str, Any]] = {}
    for row in rows:
        dt = row.get("session_date")
        date_key = dt.isoformat() if hasattr(dt, "isoformat") else str(dt or "")[:10]
        if not date_key:
            continue
        bucket = _bucket(row)
        if not bucket:
            continue
        gkey = (bucket, date_key)
        agg = grouped.get(gkey)
        if agg is None:
            agg = {
                "session_bucket": bucket,
                "date": date_key,
                "pitches": 0,
                "velo_sum": 0.0,
                "velo_n": 0,
                "velo_max": None,
                "spin_sum": 0.0,
                "spin_n": 0,
                "ivb_sum": 0.0,
                "ivb_n": 0,
                "hb_sum": 0.0,
                "hb_n": 0,
                "stuff_sum": 0.0,
                "stuff_n": 0,
                "qp_sum": 0.0,
                "qp_n": 0,
                "in_zone_n": 0,
                "comp_n": 0,
                "strike_n": 0,
                "swing_n": 0,
                "whiff_n": 0,
                "csw_n": 0,
                "fps_den": 0,
                "fps_num": 0,
                "early_den": 0,
                "early_num": 0,
                "ahead_den": 0,
                "ahead_num": 0,
                "ea_den": 0,
                "ea_num": 0,
                "oneone_den": 0,
                "oneone_num": 0,
                "qp_den": 0,
                "qp_num": 0,
                "in_play_n": 0,
                "gb_n": 0,
                "barrel_n": 0,
                "ev_sum": 0.0,
                "ev_n": 0,
                "la_sum": 0.0,
                "la_n": 0,
                "rv_sum": 0.0,
                "whiffs": 0,
                "bf_keys": set(),
                "k_keys": set(),
                "bb_keys": set(),
            }
            grouped[gkey] = agg

        pitch_call = str(row.get("pitch_call") or "")
        play_result = str(row.get("play_result") or "")
        korbb = str(row.get("korbb") or "")
        balls = row.get("balls_num")
        strikes = row.get("strikes_num")
        pa_key = f"{row.get('game_id') or row.get('game_uid') or row.get('game_foreign_id') or 'g'}|{row.get('play_id') or row.get('id') or row.get('pitch_no') or row.get('pitch_number') or 'p'}"

        agg["pitches"] += 1
        if _is_num(row.get("rel_speed")):
            v = float(row.get("rel_speed"))
            agg["velo_sum"] += v
            agg["velo_n"] += 1
            agg["velo_max"] = v if agg["velo_max"] is None else max(float(agg["velo_max"]), v)
        if _is_num(row.get("spin_rate")):
            agg["spin_sum"] += float(row.get("spin_rate"))
            agg["spin_n"] += 1
        if _is_num(row.get("ivb")):
            agg["ivb_sum"] += float(row.get("ivb"))
            agg["ivb_n"] += 1
        if _is_num(row.get("hb")):
            agg["hb_sum"] += float(row.get("hb"))
            agg["hb_n"] += 1

        stuff = avg_stuff_by_pitch_type.get(str(row.get("pitch_type") or ""))
        if _is_num(stuff):
            agg["stuff_sum"] += float(stuff)
            agg["stuff_n"] += 1

        qp = _compute_qp_point(row)
        if _is_num(qp):
            qp_plus = float(qp) * 200.0
            agg["qp_sum"] += qp_plus
            agg["qp_n"] += 1
            agg["qp_den"] += 1
            if qp_plus >= 100.0:
                agg["qp_num"] += 1

        inz = _in_zone_label(row.get("plate_side"), row.get("plate_height"))
        if inz == "Yes":
            agg["in_zone_n"] += 1
        if inz in {"Yes", "Competitive"}:
            agg["comp_n"] += 1

        is_strike = pitch_call in {"StrikeCalled", "StrikeSwinging", "FoulBall", "FoulBallFieldable", "FoulBallNotFieldable", "InPlay"}
        is_swing = pitch_call in {"StrikeSwinging", "FoulBall", "FoulBallFieldable", "FoulBallNotFieldable", "InPlay"}
        is_whiff = pitch_call == "StrikeSwinging"
        if is_strike:
            agg["strike_n"] += 1
        if is_swing:
            agg["swing_n"] += 1
        if is_whiff:
            agg["whiff_n"] += 1
            agg["whiffs"] += 1
        if pitch_call == "StrikeCalled" or is_whiff:
            agg["csw_n"] += 1

        if _is_num(balls) and _is_num(strikes):
            b = int(float(balls))
            s = int(float(strikes))
            if b == 0 and s == 0:
                agg["fps_den"] += 1
                if is_strike:
                    agg["fps_num"] += 1
            if b + s <= 1:
                agg["early_den"] += 1
                if is_strike:
                    agg["early_num"] += 1
            if s > b:
                agg["ahead_den"] += 1
                if is_strike:
                    agg["ahead_num"] += 1
            if b == 1 and s == 1:
                agg["oneone_den"] += 1
                if is_strike:
                    agg["oneone_num"] += 1
            if (b + s <= 1) or (s > b):
                agg["ea_den"] += 1
                if is_strike:
                    agg["ea_num"] += 1

        if pitch_call == "InPlay":
            agg["in_play_n"] += 1
            tagged = str(row.get("tagged_hit_type") or "").lower()
            if "ground" in tagged:
                agg["gb_n"] += 1
            if "barrel" in tagged:
                agg["barrel_n"] += 1
            if _is_num(row.get("exit_speed")):
                agg["ev_sum"] += float(row.get("exit_speed"))
                agg["ev_n"] += 1
            if _is_num(row.get("angle")):
                agg["la_sum"] += float(row.get("angle"))
                agg["la_n"] += 1

        agg["rv_sum"] += _calc_run_value(
            pitch_call,
            play_result,
            korbb,
            balls,
            strikes,
            row.get("outs_num"),
            row.get("outs_on_play_num"),
        )
        agg["bf_keys"].add(pa_key)
        if korbb == "Strikeout":
            agg["k_keys"].add(pa_key)
        if korbb == "Walk":
            agg["bb_keys"].add(pa_key)

    def _pct(num: float, den: float) -> Optional[float]:
        return (100.0 * float(num) / float(den)) if den and den > 0 else None

    out: List[Dict[str, Any]] = []
    for (_, _), agg in grouped.items():
        bf = len(agg["bf_keys"])
        k = len(agg["k_keys"])
        bb = len(agg["bb_keys"])
        pitches = int(agg["pitches"])
        out.append(
            {
                "session_bucket": agg["session_bucket"],
                "date": agg["date"],
                "values": {
                    "Velocity (Avg)": (agg["velo_sum"] / agg["velo_n"]) if agg["velo_n"] else None,
                    "Velocity (Max)": agg["velo_max"],
                    "Spin": (agg["spin_sum"] / agg["spin_n"]) if agg["spin_n"] else None,
                    "IVB": (agg["ivb_sum"] / agg["ivb_n"]) if agg["ivb_n"] else None,
                    "HB": (agg["hb_sum"] / agg["hb_n"]) if agg["hb_n"] else None,
                    "Stuff+": (agg["stuff_sum"] / agg["stuff_n"]) if agg["stuff_n"] else None,
                    "QP+": (agg["qp_sum"] / agg["qp_n"]) if agg["qp_n"] else None,
                    "InZone%": _pct(agg["in_zone_n"], pitches),
                    "Comp%": _pct(agg["comp_n"], pitches),
                    "Strike%": _pct(agg["strike_n"], pitches),
                    "Swing%": _pct(agg["swing_n"], pitches),
                    "FPS%": _pct(agg["fps_num"], agg["fps_den"]),
                    "Early%": _pct(agg["early_num"], agg["early_den"]),
                    "Ahead%": _pct(agg["ahead_num"], agg["ahead_den"]),
                    "E+A%": _pct(agg["ea_num"], agg["ea_den"]),
                    "1-1W%": _pct(agg["oneone_num"], agg["oneone_den"]),
                    "QP%": _pct(agg["qp_num"], agg["qp_den"]),
                    "Whiff%": _pct(agg["whiff_n"], agg["swing_n"]),
                    "CSW%": _pct(agg["csw_n"], pitches),
                    "K%": _pct(k, bf),
                    "BB%": _pct(bb, bf),
                    "GB%": _pct(agg["gb_n"], agg["in_play_n"]),
                    "Barrel%": _pct(agg["barrel_n"], agg["in_play_n"]),
                    "Exit Velocity": (agg["ev_sum"] / agg["ev_n"]) if agg["ev_n"] else None,
                    "Launch Angle": (agg["la_sum"] / agg["la_n"]) if agg["la_n"] else None,
                    "RV/100": ((agg["rv_sum"] / pitches) * 100.0) if pitches else None,
                    "P": pitches,
                    "BF": bf,
                    "Whiffs": int(agg["whiffs"]),
                    "K": k,
                    "BB": bb,
                },
            }
        )
    out.sort(key=lambda row: (str(row.get("session_bucket") or ""), str(row.get("date") or "")))
    return out


def _build_row_pitch_map(
    rows: List[Dict[str, Any]],
    split_by: str,
    avg_stuff_by_pitch_type: Dict[str, float],
    max_per_row: int = 220,
) -> Dict[str, List[Dict[str, Any]]]:
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for row in rows:
        key = _split_key_from_row(row, split_by)
        bucket = grouped.setdefault(key, [])
        if len(bucket) >= max_per_row:
            continue
        bucket.append(_pitch_action_payload(row, avg_stuff_by_pitch_type))
    return grouped


def _normalize_name_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (value or "").strip().lower())


def _name_filter_keys(values: List[str]) -> List[str]:
    keys = set()
    for raw_value in values:
        raw = (raw_value or "").strip()
        if not raw:
            continue
        base = _normalize_name_key(raw)
        if base:
            keys.add(base)
        if "," in raw:
            parts = [part.strip() for part in raw.split(",") if part.strip()]
            if len(parts) >= 2:
                swapped = " ".join([*parts[1:], parts[0]])
                swapped_key = _normalize_name_key(swapped)
                if swapped_key:
                    keys.add(swapped_key)
        else:
            parts = [part for part in raw.split() if part]
            if len(parts) >= 2:
                swapped = " ".join([*parts[1:], parts[0]])
                swapped_key = _normalize_name_key(swapped)
                if swapped_key:
                    keys.add(swapped_key)
    return sorted(keys)


def _ab_is_terminal(row: Dict[str, Any]) -> bool:
    play_result = str(row.get("play_result") or "")
    korbb = str(row.get("korbb") or "")
    pitch_call = str(row.get("pitch_call") or "")
    return (
        (play_result != "" and play_result != "Undefined")
        or (korbb in {"Strikeout", "Walk"})
        or (pitch_call == "HitByPitch")
    )


def _ab_pa_result_label(row: Dict[str, Any]) -> str:
    play_result = str(row.get("play_result") or "")
    korbb = str(row.get("korbb") or "")
    pitch_call = str(row.get("pitch_call") or "")
    tagged_hit_type = str(row.get("tagged_hit_type") or "")
    if pitch_call == "HitByPitch":
        return "HitByPitch"
    if korbb in {"Strikeout", "Walk"}:
        return korbb
    if play_result and play_result != "Undefined":
        if play_result == "HomeRun":
            return "HomeRun"
        return f"{tagged_hit_type + ' ' if tagged_hit_type else ''}{play_result}"
    if play_result:
        return play_result
    if pitch_call:
        return pitch_call
    return "Result"


def _ab_group_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not rows:
        return []
    grouped: List[List[Dict[str, Any]]] = []
    current: List[Dict[str, Any]] = []
    prev_row: Optional[Dict[str, Any]] = None
    prev_terminal = False
    for row in rows:
        batter = str(row.get("batter") or "")
        start_new = False
        if not current:
            start_new = True
        elif prev_terminal:
            start_new = True
        elif str(prev_row.get("batter") or "") != batter if prev_row else False:
            start_new = True
        else:
            b = row.get("balls_num")
            s = row.get("strikes_num")
            pb = prev_row.get("balls_num") if prev_row else None
            ps = prev_row.get("strikes_num") if prev_row else None
            if _is_num(b) and _is_num(s) and _is_num(pb) and _is_num(ps):
                if int(float(b)) == 0 and int(float(s)) == 0 and not (int(float(pb)) == 0 and int(float(ps)) == 0):
                    start_new = True
        if start_new:
            if current:
                grouped.append(current)
            current = [row]
        else:
            current.append(row)
        prev_terminal = _ab_is_terminal(row)
        prev_row = row
    if current:
        grouped.append(current)
    # Keep completed PAs only.
    return [g for g in grouped if any(_ab_is_terminal(r) for r in g)]


def _extract_r_vector(text: str, key: str) -> List[str]:
    match = re.search(rf"{re.escape(key)}\s*=\s*c\((.*?)\)", text, re.DOTALL)
    if not match:
        return []
    block = match.group(1)
    return [item.strip() for item in re.findall(r'"([^"]+)"', block) if item.strip()]


def _extract_r_scalar(text: str, key: str) -> Optional[str]:
    match = re.search(rf"{re.escape(key)}\s*=\s*\"([^\"]+)\"", text)
    if not match:
        return None
    value = (match.group(1) or "").strip()
    return value or None


def _normalize_team_code(value: str) -> str:
    return re.sub(r"[^A-Z0-9_]", "", (value or "").strip().upper())


def _filter_pitching_rows_by_team_type(
    rows: List[Dict[str, Any]],
    team_type_value: str,
    school_code: str,
    team_pitcher_norm: set[str],
    campers_norm: set[str],
    team_markers_norm: set[str],
) -> List[Dict[str, Any]]:
    if team_type_value in {"", "All"}:
        return rows
    if school_code == "LEAGUE":
        selected_code = _normalize_team_code(team_type_value)
        if not selected_code:
            return rows
        return [
            row
            for row in rows
            if _normalize_team_code(str(row.get("pitcher_team_code") or "")) == selected_code
        ]

    filtered: List[Dict[str, Any]] = []
    for row in rows:
        pitcher_key = _normalize_name_key(str(row.get("pitcher") or ""))
        pitcher_team_code = _normalize_team_code(str(row.get("pitcher_team_code") or ""))
        batter_team_code = _normalize_team_code(str(row.get("batter_team_code") or ""))
        pitcher_is_marker = pitcher_team_code in team_markers_norm if pitcher_team_code else False
        batter_is_marker = batter_team_code in team_markers_norm if batter_team_code else False
        is_pcu_blank_team_row = (
            school_code == "PCU"
            and not pitcher_team_code
            and not batter_team_code
            and bool(pitcher_key)
            and pitcher_key in (team_pitcher_norm | campers_norm)
        )
        is_team_pitching_row = (pitcher_is_marker and not batter_is_marker) or is_pcu_blank_team_row
        is_opponent_pitching_row = batter_is_marker and bool(pitcher_team_code) and not pitcher_is_marker

        if team_type_value == "Opponents":
            row_team_bucket = "Opponents" if is_opponent_pitching_row else None
        elif team_type_value == "Campers":
            row_team_bucket = "Campers" if (pitcher_key in campers_norm and is_team_pitching_row) else None
        elif team_type_value == school_code:
            if pitcher_key in campers_norm:
                row_team_bucket = "Campers" if is_team_pitching_row else None
            else:
                row_team_bucket = school_code if is_team_pitching_row else None
        else:
            row_team_bucket = None

        if row_team_bucket == team_type_value:
            filtered.append(row)
    return filtered


def _league_team_codes_sql_expr() -> str:
    return """
    SELECT team_code
    FROM (
      SELECT DISTINCT NULLIF(UPPER(COALESCE(NULLIF(TRIM(pitcherteam), ''), '')), '') AS team_code
      FROM public.pitch_events
      WHERE school_code = %(school_code)s
      UNION
      SELECT DISTINCT NULLIF(UPPER(COALESCE(NULLIF(TRIM(batterteam), ''), '')), '') AS team_code
      FROM public.pitch_events
      WHERE school_code = %(school_code)s
    ) t
    WHERE team_code IS NOT NULL
    ORDER BY team_code
    """


def _league_name_map_sql_expr(team_col: str, name_col: str) -> str:
    return f"""
    SELECT team_code, array_agg(name ORDER BY name) AS names
    FROM (
      SELECT DISTINCT
        NULLIF(UPPER(COALESCE(NULLIF(TRIM({team_col}), ''), '')), '') AS team_code,
        NULLIF(TRIM({name_col}), '') AS name
      FROM public.pitch_events
      WHERE school_code = %(school_code)s
    ) t
    WHERE team_code IS NOT NULL AND name IS NOT NULL
    GROUP BY team_code
    ORDER BY team_code
    """


_API_DIR = os.path.dirname(__file__)
_BUNDLED_SCHOOL_CONFIG_ROOT = os.path.normpath(os.path.join(_API_DIR, "..", "config", "schools"))


@lru_cache(maxsize=16)
def _load_school_roster(school_code: str) -> Dict[str, List[str]]:
    env_path = (os.getenv(f"DASHBOARD_SCHOOL_CONFIG_PATH_{school_code.upper()}", "") or "").strip()
    default_path_by_school = {
        "CBU": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "CBU", "school_config.R"),
        "OSU": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "OSU", "school_config.R"),
        "PCU": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "PCU", "school_config.R"),
        "CNU": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "CNU", "school_config.R"),
        "GCU": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "GCU", "school_config.R"),
        "GMU": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "GMU", "school_config.R"),
        "LSU": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "LSU", "school_config.R"),
        "UNM": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "UNM", "school_config.R"),
        "SEMO": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "SEMO", "school_config.R"),
        "CREIGHTON": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "CREIGHTON", "school_config.R"),
        "HARVARD": os.path.join(_BUNDLED_SCHOOL_CONFIG_ROOT, "HARVARD", "school_config.R"),
    }
    config_path = env_path or default_path_by_school.get(school_code.upper(), "")
    if not config_path or not os.path.exists(config_path):
        fallback_marker = _normalize_team_code(school_code)
        return {
            "team_only_norm": [],
            "hitter_norm": [],
            "campers_norm": [],
            "team_markers_norm": [fallback_marker] if fallback_marker else [],
        }

    try:
        text = open(config_path, "r", encoding="utf-8").read()
    except Exception:
        fallback_marker = _normalize_team_code(school_code)
        return {
            "team_only_norm": [],
            "hitter_norm": [],
            "campers_norm": [],
            "team_markers_norm": [fallback_marker] if fallback_marker else [],
        }

    allowed_pitchers = _extract_r_vector(text, "allowed_pitchers")
    allowed_hitters = _extract_r_vector(text, "allowed_hitters")
    allowed_campers = _extract_r_vector(text, "allowed_campers")
    if school_code.upper() == "PCU":
        pcu_additions = ["Heather, Connor", "Carr, Jordan", "King, Stan", "Jones, Grady", "Birt, Henry"]
        allowed_pitchers = sorted({*allowed_pitchers, *pcu_additions})
        allowed_hitters = sorted({*allowed_hitters, *pcu_additions})
    team_code = _extract_r_scalar(text, "team_code")
    team_code_markers = _extract_r_vector(text, "team_code_markers")
    team_norm = {_normalize_name_key(name) for name in allowed_pitchers if _normalize_name_key(name)}
    hitter_norm = {_normalize_name_key(name) for name in allowed_hitters if _normalize_name_key(name)}
    campers_norm = {_normalize_name_key(name) for name in allowed_campers if _normalize_name_key(name)}
    # LSU config currently uses allowed_campers as a full-roster mirror, which collapses
    # team bucketing into "Campers". Ignore campers there so Team/Opponent filters work.
    if school_code.upper() == "LSU":
        campers_norm = set()
    team_only_norm = sorted(team_norm - campers_norm)
    marker_source = [*(team_code_markers or []), *([team_code] if team_code else []), school_code]
    team_markers_norm = sorted({_normalize_team_code(code) for code in marker_source if _normalize_team_code(code)})
    return {
        "team_only_norm": team_only_norm,
        "hitter_norm": sorted(hitter_norm),
        "campers_norm": sorted(campers_norm),
        "team_markers_norm": team_markers_norm,
    }


_MOD_SYNC_INTERVAL_SECONDS = 90.0
_MOD_SYNC_LAST_AT: Dict[str, float] = {}
_PERF_INDEX_SYNC_INTERVAL_SECONDS = 3600.0
_PERF_INDEX_LAST_AT: float = 0.0
_LEAGUE_DAILY_ROLLUP_SYNC_INTERVAL_SECONDS = max(
    60.0, float(os.getenv("DASHBOARD_LEAGUE_DAILY_ROLLUP_SYNC_INTERVAL_SECONDS", "300"))
)
_LEAGUE_DAILY_ROLLUP_LAST_AT: float = 0.0


def _ensure_pitch_event_edits_table(cur: Any) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.pitch_event_edits (
          id BIGSERIAL PRIMARY KEY,
          school_code TEXT NOT NULL,
          pitch_event_id INT NOT NULL,
          pitch_type TEXT NOT NULL,
          pitcher TEXT NOT NULL,
          edited_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_pitch_event_edits_school_code
          ON public.pitch_event_edits (school_code)
        """
    )
    # Prevent duplicate sync inserts for the same resulting state.
    cur.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_pitch_event_edits_unique
          ON public.pitch_event_edits (school_code, pitch_event_id, pitch_type, pitcher)
        """
    )


def _ensure_performance_indexes() -> None:
    """
    Additive DB performance indexes for large date-range dashboard queries.
    Safe no-op when already present; failures are intentionally non-fatal.
    """
    global _PERF_INDEX_LAST_AT
    now = time.monotonic()
    if (now - _PERF_INDEX_LAST_AT) < _PERF_INDEX_SYNC_INTERVAL_SECONDS:
        return

    statements = [
        """
        CREATE TABLE IF NOT EXISTS public.pitch_events_daily_rollup_league (
          school_code TEXT NOT NULL,
          session_date DATE NOT NULL,
          pitch_type TEXT NOT NULL,
          pitcher_name TEXT NOT NULL,
          batter_name TEXT NOT NULL,
          catcher_name TEXT NOT NULL,
          pitcher_norm TEXT NOT NULL,
          batter_norm TEXT NOT NULL,
          catcher_norm TEXT NOT NULL,
          pitcher_team_norm TEXT NOT NULL,
          batter_team_norm_eff TEXT NOT NULL,
          pitcherthrows_norm TEXT NOT NULL,
          batterside_norm TEXT NOT NULL,
          session_bucket TEXT NOT NULL,
          pitches INT NOT NULL,
          velo_sum DOUBLE PRECISION NOT NULL,
          velo_n INT NOT NULL,
          velo_max DOUBLE PRECISION NULL,
          spin_sum DOUBLE PRECISION NOT NULL,
          spin_n INT NOT NULL,
          ivb_sum DOUBLE PRECISION NOT NULL,
          ivb_n INT NOT NULL,
          hb_sum DOUBLE PRECISION NOT NULL,
          hb_n INT NOT NULL,
          in_zone_n INT NOT NULL,
          loc_n INT NOT NULL,
          strike_n INT NOT NULL,
          swing_n INT NOT NULL,
          whiff_n INT NOT NULL,
          csw_n INT NOT NULL,
          comp_n INT NOT NULL,
          fps_num INT NOT NULL,
          fps_den INT NOT NULL,
          early_num INT NOT NULL,
          early_den INT NOT NULL,
          ahead_num INT NOT NULL,
          ahead_den INT NOT NULL,
          oneone_num INT NOT NULL,
          oneone_den INT NOT NULL,
          ea_num INT NOT NULL,
          ea_den INT NOT NULL,
          in_play_n INT NOT NULL,
          gb_n INT NOT NULL,
          barrel_n INT NOT NULL,
          ev_sum DOUBLE PRECISION NOT NULL,
          ev_n INT NOT NULL,
          la_sum DOUBLE PRECISION NOT NULL,
          la_n INT NOT NULL,
          count_00_n INT NOT NULL,
          count_behind_n INT NOT NULL,
          count_even_n INT NOT NULL,
          count_ahead_n INT NOT NULL,
          count_lt2k_n INT NOT NULL,
          count_2k_n INT NOT NULL,
          bf_n INT NOT NULL,
          k_n INT NOT NULL,
          bb_n INT NOT NULL,
          PRIMARY KEY (
            school_code, session_date, pitch_type, pitcher_norm, batter_norm, catcher_norm,
            pitcher_team_norm, batter_team_norm_eff, pitcherthrows_norm, batterside_norm, session_bucket
          )
        )
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league
        ADD COLUMN IF NOT EXISTS pitcher_name TEXT NOT NULL DEFAULT ''
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league
        ADD COLUMN IF NOT EXISTS batter_name TEXT NOT NULL DEFAULT ''
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league
        ADD COLUMN IF NOT EXISTS catcher_name TEXT NOT NULL DEFAULT ''
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS csw_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS comp_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS early_num INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS early_den INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS ahead_num INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS ahead_den INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS oneone_num INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS oneone_den INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS in_play_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS gb_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS barrel_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS ev_sum DOUBLE PRECISION NOT NULL DEFAULT 0.0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS ev_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS la_sum DOUBLE PRECISION NOT NULL DEFAULT 0.0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS la_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS count_00_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS count_behind_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS count_even_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS count_ahead_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS count_lt2k_n INT NOT NULL DEFAULT 0
        """,
        """
        ALTER TABLE public.pitch_events_daily_rollup_league ADD COLUMN IF NOT EXISTS count_2k_n INT NOT NULL DEFAULT 0
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_pe_school_date_created_id
        ON public.pitch_events (school_code, session_date, created_at, id)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_pe_school_date_session_type_norm
        ON public.pitch_events
        (school_code, session_date, (regexp_replace(lower(COALESCE(NULLIF(TRIM(COALESCE(session_type, sessiontype)), ''), '')), '\\s+', '', 'g')))
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_pe_school_date_team_codes
        ON public.pitch_events (school_code, session_date, pitcherteam, batterteam)
        """,
        # Core school/date and normalized-name filters used by overview endpoints.
        """
        CREATE INDEX IF NOT EXISTS idx_pe_school_date_pitcher_norm
        ON public.pitch_events
        (school_code, session_date, (regexp_replace(lower(COALESCE(NULLIF(TRIM(pitcher), ''), '')), '[^a-z0-9]', '', 'g')))
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_pe_school_date_batter_norm
        ON public.pitch_events
        (school_code, session_date, (regexp_replace(lower(COALESCE(NULLIF(TRIM(batter), ''), '')), '[^a-z0-9]', '', 'g')))
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_pe_school_date_catcher_norm
        ON public.pitch_events
        (school_code, session_date, (regexp_replace(lower(COALESCE(NULLIF(TRIM(catcher), ''), '')), '[^a-z0-9]', '', 'g')))
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_pe_school_date_pitch_type_norm
        ON public.pitch_events
        (school_code, session_date, (
          CASE
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Four-Seam' THEN 'Fastball'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Two-Seam' THEN 'Sinker'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Changeup' THEN 'ChangeUp'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Knuckleball' THEN 'Knuckleball'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Splitter' THEN 'Splitter'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Knuckle-Curve' THEN 'Curveball'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Slider' THEN 'Slider'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Curveball' THEN 'Curveball'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Sweeper' THEN 'Sweeper'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Sinker' THEN 'Sinker'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Cutter' THEN 'Cutter'
            WHEN COALESCE(NULLIF(TRIM(taggedpitchtype), ''), NULLIF(TRIM(autopitchtype), ''), '') = 'Fastball' THEN 'Fastball'
            ELSE 'Undefined'
          END
        ))
        """,
        # Backing indexes for inning fallback lookups by PitchUID/PlayID.
        """
        CREATE INDEX IF NOT EXISTS idx_pitch_data_pitchuid_key_date
        ON public.pitch_data ((lower(btrim("PitchUID"::text))), "Date")
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_pitch_data_playid_key_date
        ON public.pitch_data ((lower(btrim("PlayID"::text))), "Date")
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rollup_league_school_date
        ON public.pitch_events_daily_rollup_league (school_code, session_date)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rollup_league_school_date_pitcher
        ON public.pitch_events_daily_rollup_league (school_code, session_date, pitcher_norm)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rollup_league_school_date_team
        ON public.pitch_events_daily_rollup_league (school_code, session_date, pitcher_team_norm)
        """,
        """
        CREATE INDEX IF NOT EXISTS idx_rollup_league_school_date_pitch_type
        ON public.pitch_events_daily_rollup_league (school_code, session_date, pitch_type)
        """,
    ]

    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '2s'")
            cur.execute("SET LOCAL statement_timeout = '20s'")
            for statement in statements:
                try:
                    cur.execute(statement)
                except Exception:
                    continue
        _PERF_INDEX_LAST_AT = now
    except Exception:
        # Keep API serving even if index create fails due permissions/locks.
        return


def _refresh_league_daily_rollup(force: bool = False) -> None:
    global _LEAGUE_DAILY_ROLLUP_LAST_AT
    now = time.monotonic()
    if (not force) and ((now - _LEAGUE_DAILY_ROLLUP_LAST_AT) < _LEAGUE_DAILY_ROLLUP_SYNC_INTERVAL_SECONDS):
        return
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute("SET LOCAL lock_timeout = '2s'")
            cur.execute("SET LOCAL statement_timeout = '120s'")
            cur.execute(
                """
                SELECT
                  MIN(session_date)::date AS min_date,
                  MAX(session_date)::date AS max_date
                FROM public.pitch_events
                WHERE school_code = 'LEAGUE'
                  AND session_date IS NOT NULL
                """
            )
            bounds = cur.fetchone() or {}
            min_date = bounds.get("min_date")
            max_date = bounds.get("max_date")
            if not min_date or not max_date:
                _LEAGUE_DAILY_ROLLUP_LAST_AT = now
                return
            cur.execute(
                """
                SELECT MAX(session_date)::date AS max_rollup_date
                FROM public.pitch_events_daily_rollup_league
                WHERE school_code = 'LEAGUE'
                """
            )
            max_rollup = (cur.fetchone() or {}).get("max_rollup_date")
            if max_rollup:
                refresh_start = max(min_date, max_rollup - timedelta(days=10))
            else:
                refresh_start = min_date

            cur.execute(
                """
                DELETE FROM public.pitch_events_daily_rollup_league
                WHERE school_code = 'LEAGUE'
                  AND session_date >= %(refresh_start)s::date
                """,
                {"refresh_start": refresh_start},
            )

            cur.execute(
                """
                WITH base AS (
                  SELECT
                    pe.session_date::date AS session_date,
                    """ + PITCH_TYPE_NORMALIZE_SQL + """ AS pitch_type,
                    COALESCE(NULLIF(TRIM(pe.pitcher), ''), 'Unknown Pitcher') AS pitcher_name,
                    COALESCE(NULLIF(TRIM(pe.batter), ''), 'Unknown Batter') AS batter_name,
                    COALESCE(NULLIF(TRIM(pe.catcher), ''), 'Unknown Catcher') AS catcher_name,
                    """ + PITCHER_NAME_NORM_SQL + """ AS pitcher_norm,
                    """ + BATTER_NAME_NORM_SQL + """ AS batter_norm,
                    """ + CATCHER_NAME_NORM_SQL + """ AS catcher_norm,
                    """ + PITCHER_TEAM_NORM_SQL + """ AS pitcher_team_norm,
                    """ + BATTER_TEAM_NORM_EFF_SQL + """ AS batter_team_norm_eff,
                    CASE
                      WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pe.pitcherthrows), ''), ''), 1)) = 'L' THEN 'Left'
                      WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pe.pitcherthrows), ''), ''), 1)) = 'R' THEN 'Right'
                      ELSE 'Unknown'
                    END AS pitcherthrows_norm,
                    CASE
                      WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pe.batterside), ''), ''), 1)) = 'L' THEN 'Left'
                      WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pe.batterside), ''), ''), 1)) = 'R' THEN 'Right'
                      ELSE 'Unknown'
                    END AS batterside_norm,
                    CASE
                      WHEN regexp_replace(lower(COALESCE(NULLIF(TRIM(COALESCE(pe.session_type, pe.sessiontype)), ''), '')), '\\s+', '', 'g') LIKE '%bull%'
                        OR regexp_replace(lower(COALESCE(NULLIF(TRIM(COALESCE(pe.session_type, pe.sessiontype)), ''), '')), '\\s+', '', 'g') LIKE '%prac%'
                      THEN 'Bullpen'
                      ELSE 'Season'
                    END AS session_bucket,
                    (regexp_match(COALESCE(pe.relspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_speed,
                    (regexp_match(COALESCE(pe.spinrate, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_rate,
                    (regexp_match(COALESCE(pe.inducedvertbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ivb,
                    (regexp_match(COALESCE(pe.horzbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS hb,
                    (regexp_match(COALESCE(pe.platelocside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_side,
                    (regexp_match(COALESCE(pe.platelocheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_height,
                    (regexp_match(COALESCE(pe.exitspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS exit_speed,
                    (regexp_match(COALESCE(pe.angle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS angle,
                    COALESCE(NULLIF(TRIM(pe.taggedhittype), ''), '') AS tagged_hit_type,
                    COALESCE(NULLIF(TRIM(pe.pitchcall), ''), '') AS pitch_call,
                    COALESCE(NULLIF(TRIM(pe.korbb), ''), '') AS korbb,
                    COALESCE(NULLIF(TRIM(pe.playresult), ''), '') AS play_result,
                    COALESCE(
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameid', to_jsonb(pe)->>'GameID', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameuid', to_jsonb(pe)->>'GameUID', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameforeignid', to_jsonb(pe)->>'GameForeignID', '')), ''),
                      'g'
                    ) || '|' || COALESCE(
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', pe.playid::text, '')), ''),
                      pe.id::text
                    ) AS pa_key,
                    (regexp_match(COALESCE(pe.balls::text, ''), '[-+]?[0-9]+'))[1]::int AS balls_num,
                    (regexp_match(COALESCE(pe.strikes::text, ''), '[-+]?[0-9]+'))[1]::int AS strikes_num
                  FROM public.pitch_events pe
                  WHERE pe.school_code = 'LEAGUE'
                    AND pe.session_date >= %(refresh_start)s::date
                    AND pe.session_date <= %(max_date)s::date
                )
                INSERT INTO public.pitch_events_daily_rollup_league (
                  school_code, session_date, pitch_type, pitcher_name, batter_name, catcher_name, pitcher_norm, batter_norm, catcher_norm,
                  pitcher_team_norm, batter_team_norm_eff, pitcherthrows_norm, batterside_norm, session_bucket,
                  pitches, velo_sum, velo_n, velo_max, spin_sum, spin_n, ivb_sum, ivb_n, hb_sum, hb_n,
                  in_zone_n, loc_n, strike_n, swing_n, whiff_n, csw_n, comp_n, fps_num, fps_den,
                  early_num, early_den, ahead_num, ahead_den, oneone_num, oneone_den,
                  ea_num, ea_den, in_play_n, gb_n, barrel_n, ev_sum, ev_n, la_sum, la_n,
                  count_00_n, count_behind_n, count_even_n, count_ahead_n, count_lt2k_n, count_2k_n,
                  bf_n, k_n, bb_n
                )
                SELECT
                  'LEAGUE',
                  b.session_date,
                  b.pitch_type,
                  MIN(b.pitcher_name) AS pitcher_name,
                  MIN(b.batter_name) AS batter_name,
                  MIN(b.catcher_name) AS catcher_name,
                  b.pitcher_norm,
                  b.batter_norm,
                  b.catcher_norm,
                  b.pitcher_team_norm,
                  b.batter_team_norm_eff,
                  b.pitcherthrows_norm,
                  b.batterside_norm,
                  b.session_bucket,
                  COUNT(*)::int AS pitches,
                  COALESCE(SUM(b.rel_speed), 0.0)::double precision AS velo_sum,
                  COUNT(b.rel_speed)::int AS velo_n,
                  MAX(b.rel_speed)::double precision AS velo_max,
                  COALESCE(SUM(b.spin_rate), 0.0)::double precision AS spin_sum,
                  COUNT(b.spin_rate)::int AS spin_n,
                  COALESCE(SUM(b.ivb), 0.0)::double precision AS ivb_sum,
                  COUNT(b.ivb)::int AS ivb_n,
                  COALESCE(SUM(b.hb), 0.0)::double precision AS hb_sum,
                  COUNT(b.hb)::int AS hb_n,
                  SUM(
                    CASE WHEN b.plate_side BETWEEN %(zone_left)s::double precision AND %(zone_right)s::double precision
                           AND b.plate_height BETWEEN %(zone_bottom)s::double precision AND %(zone_top)s::double precision
                      THEN 1 ELSE 0 END
                  )::int AS in_zone_n,
                  SUM(CASE WHEN b.plate_side IS NOT NULL AND b.plate_height IS NOT NULL THEN 1 ELSE 0 END)::int AS loc_n,
                  SUM(
                    CASE WHEN b.pitch_call IN ('StrikeCalled','StrikeSwinging','FoulBall','FoulBallFieldable','FoulBallNotFieldable','InPlay') THEN 1 ELSE 0 END
                  )::int AS strike_n,
                  SUM(
                    CASE WHEN b.pitch_call IN ('StrikeSwinging','FoulBall','FoulBallFieldable','FoulBallNotFieldable','InPlay') THEN 1 ELSE 0 END
                  )::int AS swing_n,
                  SUM(CASE WHEN b.pitch_call = 'StrikeSwinging' THEN 1 ELSE 0 END)::int AS whiff_n,
                  SUM(CASE WHEN b.pitch_call = 'StrikeCalled' OR b.pitch_call = 'StrikeSwinging' THEN 1 ELSE 0 END)::int AS csw_n,
                  SUM(
                    CASE WHEN b.plate_side BETWEEN -1.5::double precision AND 1.5::double precision
                           AND b.plate_height BETWEEN 1.17::double precision AND 3.93::double precision
                      THEN 1 ELSE 0 END
                  )::int AS comp_n,
                  SUM(
                    CASE WHEN b.balls_num = 0 AND b.strikes_num = 0
                              AND b.pitch_call IN ('StrikeCalled','StrikeSwinging','FoulBall','FoulBallFieldable','FoulBallNotFieldable','InPlay')
                      THEN 1 ELSE 0 END
                  )::int AS fps_num,
                  SUM(CASE WHEN b.balls_num = 0 AND b.strikes_num = 0 THEN 1 ELSE 0 END)::int AS fps_den,
                  SUM(
                    CASE WHEN (b.balls_num + b.strikes_num) <= 1
                              AND b.pitch_call IN ('StrikeCalled','StrikeSwinging','FoulBall','FoulBallFieldable','FoulBallNotFieldable','InPlay')
                      THEN 1 ELSE 0 END
                  )::int AS early_num,
                  SUM(CASE WHEN (b.balls_num + b.strikes_num) <= 1 THEN 1 ELSE 0 END)::int AS early_den,
                  SUM(
                    CASE WHEN (b.strikes_num > b.balls_num)
                              AND b.pitch_call IN ('StrikeCalled','StrikeSwinging','FoulBall','FoulBallFieldable','FoulBallNotFieldable','InPlay')
                      THEN 1 ELSE 0 END
                  )::int AS ahead_num,
                  SUM(CASE WHEN (b.strikes_num > b.balls_num) THEN 1 ELSE 0 END)::int AS ahead_den,
                  SUM(
                    CASE WHEN b.balls_num = 1 AND b.strikes_num = 1
                              AND b.pitch_call IN ('StrikeCalled','StrikeSwinging','FoulBall','FoulBallFieldable','FoulBallNotFieldable','InPlay')
                      THEN 1 ELSE 0 END
                  )::int AS oneone_num,
                  SUM(CASE WHEN b.balls_num = 1 AND b.strikes_num = 1 THEN 1 ELSE 0 END)::int AS oneone_den,
                  SUM(
                    CASE WHEN (
                      (b.balls_num = 0 AND b.strikes_num = 0 AND b.pitch_call = 'InPlay')
                      OR ((b.balls_num, b.strikes_num) IN ((0,1),(1,1))
                          AND b.pitch_call IN ('StrikeCalled','StrikeSwinging','FoulBall','FoulBallFieldable','FoulBallNotFieldable','InPlay'))
                      OR (b.balls_num = 1 AND b.strikes_num = 0 AND b.pitch_call = 'InPlay')
                    ) THEN 1 ELSE 0 END
                  )::int AS ea_num,
                  SUM(CASE WHEN b.balls_num = 0 AND b.strikes_num = 0 THEN 1 ELSE 0 END)::int AS ea_den,
                  SUM(CASE WHEN b.pitch_call = 'InPlay' THEN 1 ELSE 0 END)::int AS in_play_n,
                  SUM(CASE WHEN b.pitch_call = 'InPlay' AND lower(b.tagged_hit_type) LIKE '%ground%' THEN 1 ELSE 0 END)::int AS gb_n,
                  SUM(
                    CASE WHEN b.pitch_call = 'InPlay'
                              AND b.exit_speed IS NOT NULL
                              AND b.angle IS NOT NULL
                              AND b.exit_speed >= 95.0
                              AND b.angle BETWEEN 10.0 AND 35.0
                         THEN 1 ELSE 0 END
                  )::int AS barrel_n,
                  SUM(CASE WHEN b.pitch_call = 'InPlay' AND b.exit_speed IS NOT NULL THEN b.exit_speed ELSE 0.0 END)::double precision AS ev_sum,
                  SUM(CASE WHEN b.pitch_call = 'InPlay' AND b.exit_speed IS NOT NULL THEN 1 ELSE 0 END)::int AS ev_n,
                  SUM(CASE WHEN b.pitch_call = 'InPlay' AND b.angle IS NOT NULL THEN b.angle ELSE 0.0 END)::double precision AS la_sum,
                  SUM(CASE WHEN b.pitch_call = 'InPlay' AND b.angle IS NOT NULL THEN 1 ELSE 0 END)::int AS la_n,
                  SUM(CASE WHEN b.balls_num = 0 AND b.strikes_num = 0 THEN 1 ELSE 0 END)::int AS count_00_n,
                  SUM(CASE WHEN (b.balls_num, b.strikes_num) IN ((1,0),(2,0),(3,0),(3,1),(2,1)) THEN 1 ELSE 0 END)::int AS count_behind_n,
                  SUM(CASE WHEN (b.balls_num, b.strikes_num) IN ((0,0),(1,1),(2,2),(3,2)) THEN 1 ELSE 0 END)::int AS count_even_n,
                  SUM(CASE WHEN (b.balls_num, b.strikes_num) IN ((0,1),(0,2),(1,2)) THEN 1 ELSE 0 END)::int AS count_ahead_n,
                  SUM(CASE WHEN b.strikes_num < 2 THEN 1 ELSE 0 END)::int AS count_lt2k_n,
                  SUM(CASE WHEN b.strikes_num = 2 THEN 1 ELSE 0 END)::int AS count_2k_n,
                  COUNT(DISTINCT CASE WHEN b.balls_num = 0 AND b.strikes_num = 0 THEN b.pa_key END)::int AS bf_n,
                  COUNT(DISTINCT CASE WHEN b.korbb = 'Strikeout' THEN b.pa_key END)::int AS k_n,
                  COUNT(DISTINCT CASE WHEN b.korbb = 'Walk' THEN b.pa_key END)::int AS bb_n
                FROM base b
                WHERE b.pitch_type <> 'Undefined'
                GROUP BY
                  b.session_date, b.pitch_type, b.pitcher_norm, b.batter_norm, b.catcher_norm,
                  b.pitcher_team_norm, b.batter_team_norm_eff, b.pitcherthrows_norm, b.batterside_norm, b.session_bucket
                """,
                {
                    "refresh_start": refresh_start,
                    "max_date": max_date,
                    "zone_left": ZONE_LEFT,
                    "zone_right": ZONE_RIGHT,
                    "zone_bottom": ZONE_BOTTOM,
                    "zone_top": ZONE_TOP,
                },
            )
        _LEAGUE_DAILY_ROLLUP_LAST_AT = now
    except Exception:
        return


def _try_pitching_overview_daily_rollup(
    *,
    school_code: str,
    start_date: Optional[date],
    end_date: Optional[date],
    selected_pitchers: List[str],
    selected_pitcher_keys: List[str],
    team_type: Optional[str],
    selected_opp_hitters: List[str],
    with_video: Optional[str],
    hand: Optional[str],
    batter_side: Optional[str],
    session_type_filter: str,
    table_mode: str,
    split_by: str,
    selected_in_zone: List[str],
    qp_locations: Optional[str],
    selected_pitch_types: List[str],
    selected_zone_locations: List[str],
    selected_pitch_results: List[str],
    selected_count_filters: List[str],
    selected_after_count_filters: List[str],
    parsed_velo_min: Optional[float],
    parsed_velo_max: Optional[float],
    parsed_ivb_min: Optional[float],
    parsed_ivb_max: Optional[float],
    parsed_hb_min: Optional[float],
    parsed_hb_max: Optional[float],
    parsed_pc_min: Optional[int],
    parsed_pc_max: Optional[int],
    include_chart_points: bool,
    chart_points_limit: Optional[int],
    include_row_pitches: bool,
    include_trend_rows: bool,
) -> Optional[PitchingOverviewResponse]:
    if school_code != "LEAGUE":
        return None
    # Fast path for high-volume league windows.
    if include_row_pitches or include_trend_rows:
        return None
    mode_clean = (table_mode or "Live").strip()
    if mode_clean not in {"Live", "Process", "Results", "Usage"}:
        return None
    split_clean = (split_by or "Pitch Types").strip()
    split_to_rollup_col: Dict[str, tuple[str, str]] = {
        "Pitch Types": ("pitch_type", "Pitch"),
        "Pitcher": ("pitcher_name", "Pitcher"),
        "Batter": ("batter_name", "Batter"),
        "Catcher": ("catcher_name", "Catcher"),
        "Pitcher Hand": ("pitcherthrows_norm", "Pitcher Hand"),
        "Batter Hand": ("batterside_norm", "Batter Hand"),
        "Team": ("pitcher_team_norm", "Team"),
    }
    split_conf = split_to_rollup_col.get(split_clean)
    if split_conf is None:
        return None
    split_rollup_col, split_col_name = split_conf
    if selected_opp_hitters:
        return None
    if (with_video or "").strip() not in {"", "All"}:
        return None
    if selected_in_zone or qp_locations or selected_zone_locations or selected_pitch_results:
        return None
    if selected_count_filters or selected_after_count_filters:
        return None
    if any(v is not None for v in [parsed_velo_min, parsed_velo_max, parsed_ivb_min, parsed_ivb_max, parsed_hb_min, parsed_hb_max, parsed_pc_min, parsed_pc_max]):
        return None
    _refresh_league_daily_rollup()

    params: Dict[str, Any] = {
        "start_date": start_date,
        "end_date": end_date,
        "pitchers_norm": selected_pitcher_keys,
        "pitchers_count": len(selected_pitcher_keys),
        "pitch_types": selected_pitch_types,
        "pitch_types_count": len(selected_pitch_types),
    }
    where_parts = [
        "school_code = 'LEAGUE'",
        "(%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)",
        "(%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)",
        "(%(pitchers_count)s::int = 0 OR pitcher_norm = ANY(%(pitchers_norm)s::text[]))",
        "(%(pitch_types_count)s::int = 0 OR pitch_type = ANY(%(pitch_types)s::text[]))",
    ]
    if (session_type_filter or "").strip() and session_type_filter != "All":
        where_parts.append("session_bucket = %(session_bucket)s::text")
        params["session_bucket"] = "Season" if session_type_filter == "Season" else session_type_filter
    hand_norm = (hand or "").strip()
    if hand_norm and hand_norm != "All":
        where_parts.append("pitcherthrows_norm = %(pitcherthrows_norm)s::text")
        params["pitcherthrows_norm"] = hand_norm
    batter_side_norm = (batter_side or "").strip()
    if batter_side_norm and batter_side_norm != "All":
        where_parts.append("batterside_norm = %(batterside_norm)s::text")
        params["batterside_norm"] = batter_side_norm
    team_type_norm = _normalize_team_code(team_type or "")
    if team_type_norm and team_type_norm != "all":
        where_parts.append("pitcher_team_norm = %(team_type_norm)s::text")
        params["team_type_norm"] = team_type_norm
    where_sql = " AND ".join(where_parts)

    # Aggregate rows by split + pitch type.
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT
                  {split_rollup_col} AS split_value,
                  pitch_type,
                  SUM(pitches)::int AS pitches,
                  SUM(velo_sum)::double precision AS velo_sum,
                  SUM(velo_n)::int AS velo_n,
                  MAX(velo_max)::double precision AS velo_max,
                  SUM(spin_sum)::double precision AS spin_sum,
                  SUM(spin_n)::int AS spin_n,
                  SUM(ivb_sum)::double precision AS ivb_sum,
                  SUM(ivb_n)::int AS ivb_n,
                  SUM(hb_sum)::double precision AS hb_sum,
                  SUM(hb_n)::int AS hb_n,
                  SUM(in_zone_n)::int AS in_zone_n,
                  SUM(loc_n)::int AS loc_n,
                  SUM(strike_n)::int AS strike_n,
                  SUM(swing_n)::int AS swing_n,
                  SUM(whiff_n)::int AS whiff_n,
                  SUM(csw_n)::int AS csw_n,
                  SUM(comp_n)::int AS comp_n,
                  SUM(fps_num)::int AS fps_num,
                  SUM(fps_den)::int AS fps_den,
                  SUM(early_num)::int AS early_num,
                  SUM(early_den)::int AS early_den,
                  SUM(ahead_num)::int AS ahead_num,
                  SUM(ahead_den)::int AS ahead_den,
                  SUM(oneone_num)::int AS oneone_num,
                  SUM(oneone_den)::int AS oneone_den,
                  SUM(ea_num)::int AS ea_num,
                  SUM(ea_den)::int AS ea_den,
                  SUM(in_play_n)::int AS in_play_n,
                  SUM(gb_n)::int AS gb_n,
                  SUM(barrel_n)::int AS barrel_n,
                  SUM(ev_sum)::double precision AS ev_sum,
                  SUM(ev_n)::int AS ev_n,
                  SUM(la_sum)::double precision AS la_sum,
                  SUM(la_n)::int AS la_n,
                  SUM(count_00_n)::int AS count_00_n,
                  SUM(count_behind_n)::int AS count_behind_n,
                  SUM(count_even_n)::int AS count_even_n,
                  SUM(count_ahead_n)::int AS count_ahead_n,
                  SUM(count_lt2k_n)::int AS count_lt2k_n,
                  SUM(count_2k_n)::int AS count_2k_n,
                  SUM(bf_n)::int AS bf_n,
                  SUM(k_n)::int AS k_n,
                  SUM(bb_n)::int AS bb_n
                FROM public.pitch_events_daily_rollup_league
                WHERE {where_sql}
                GROUP BY {split_rollup_col}, pitch_type
                """,
                params,
            )
            grouped_rows = [dict(r) for r in cur.fetchall()]
    except Exception:
        return None

    if not grouped_rows:
        mode_columns_map: Dict[str, List[str]] = {
            "Live": [split_col_name, "#", "Velo", "Max", "IVB", "HB", "FPS%", "E+A%", "InZone%", "Strike%", "Whiff%", "K%", "BB%", "QP+"],
            "Process": [split_col_name, "#", "BF", "RV/100", "InZone%", "Comp%", "Strike%", "Swing%", "FPS%", "Early%", "Ahead%", "E+A%", "1-1W%", "QP%", "Ctrl+", "QP+", "Pitching+"],
            "Results": [split_col_name, "#", "BF", "K%", "BB%", "GB%", "Barrel%", "Whiff%", "CSW%", "EV", "LA"],
            "Usage": [split_col_name, "#", "Usage", "0-0", "Behind", "Even", "Ahead", "<2K", "2K"],
        }
        return PitchingOverviewResponse(
            school_code=school_code,
            pitcher=selected_pitchers[0] if len(selected_pitchers) == 1 else None,
            team_type=team_type,
            opp_hitter=None,
            with_video=with_video,
            break_lines=None,
            stuff_level=None,
            stuff_base=None,
            hand=hand,
            batter_side=batter_side,
            in_zone=None,
            qp_locations=qp_locations,
            session_type=(session_type_filter if session_type_filter != "Live" else "Live BP"),
            table_mode=table_mode,
            split_by=split_by,
            selected_zone_locations=selected_zone_locations,
            selected_pitch_types=selected_pitch_types,
            selected_pitch_results=selected_pitch_results,
            selected_count_filters=selected_count_filters,
            selected_after_count_filters=selected_after_count_filters,
            start_date=start_date.isoformat() if start_date else None,
            end_date=end_date.isoformat() if end_date else None,
            total_pitches=0,
            avg_velo=None,
            max_velo=None,
            avg_spin=None,
            avg_ivb=None,
            avg_hb=None,
            avg_stuff=None,
            zone_pct=None,
            strike_pct=None,
            whiff_pct=None,
            table_columns=mode_columns_map.get(mode_clean, mode_columns_map["Live"]),
            available_table_columns=ALL_TABLE_COLUMNS,
            table_rows=[],
            row_pitches_by_key={},
            pitch_types=[],
            chart_points=[],
            trend_rows=[],
        )

    def _safe_pct(num: Any, den: Any) -> Optional[str]:
        try:
            n = float(num or 0.0)
            d = float(den or 0.0)
            if d <= 0:
                return None
            return f"{round((100.0 * n) / d, 1)}%"
        except Exception:
            return None

    grouped_by_split: Dict[str, List[Dict[str, Any]]] = {}
    for row in grouped_rows:
        split_val = str(row.get("split_value") or "Unknown")
        grouped_by_split.setdefault(split_val, []).append(row)

    total_pitches = int(sum(int(r.get("pitches") or 0) for r in grouped_rows))
    total_velo_n = int(sum(int(r.get("velo_n") or 0) for r in grouped_rows))
    total_spin_n = int(sum(int(r.get("spin_n") or 0) for r in grouped_rows))
    total_ivb_n = int(sum(int(r.get("ivb_n") or 0) for r in grouped_rows))
    total_hb_n = int(sum(int(r.get("hb_n") or 0) for r in grouped_rows))
    total_loc_n = int(sum(int(r.get("loc_n") or 0) for r in grouped_rows))
    total_swing_n = int(sum(int(r.get("swing_n") or 0) for r in grouped_rows))

    total_velo_sum = float(sum(float(r.get("velo_sum") or 0.0) for r in grouped_rows))
    total_spin_sum = float(sum(float(r.get("spin_sum") or 0.0) for r in grouped_rows))
    total_ivb_sum = float(sum(float(r.get("ivb_sum") or 0.0) for r in grouped_rows))
    total_hb_sum = float(sum(float(r.get("hb_sum") or 0.0) for r in grouped_rows))

    max_velo_values = [float(r.get("velo_max")) for r in grouped_rows if _is_num(r.get("velo_max"))]
    avg_velo = (total_velo_sum / total_velo_n) if total_velo_n > 0 else None
    max_velo = max(max_velo_values) if max_velo_values else None
    avg_spin = (total_spin_sum / total_spin_n) if total_spin_n > 0 else None
    avg_ivb = (total_ivb_sum / total_ivb_n) if total_ivb_n > 0 else None
    avg_hb = (total_hb_sum / total_hb_n) if total_hb_n > 0 else None
    zone_pct = ((100.0 * sum(int(r.get("in_zone_n") or 0) for r in grouped_rows)) / total_loc_n) if total_loc_n > 0 else None
    strike_pct = ((100.0 * sum(int(r.get("strike_n") or 0) for r in grouped_rows)) / total_pitches) if total_pitches > 0 else None
    whiff_pct = ((100.0 * sum(int(r.get("whiff_n") or 0) for r in grouped_rows)) / total_swing_n) if total_swing_n > 0 else None

    pitch_order = {
        "Fastball": 1,
        "Sinker": 2,
        "Cutter": 3,
        "Slider": 4,
        "Sweeper": 5,
        "Curveball": 6,
        "ChangeUp": 7,
        "Splitter": 8,
        "Knuckleball": 9,
        "Undefined": 10,
    }
    table_rows: List[Dict[str, Any]] = []
    pitch_type_rows: List[PitchTypeSummaryRow] = []
    pitch_summary_by_type: Dict[str, Dict[str, Any]] = {}
    for row in grouped_rows:
        pt = str(row.get("pitch_type") or "")
        bucket = pitch_summary_by_type.setdefault(
            pt,
            {
                "pitch_type": pt,
                "pitches": 0,
                "velo_sum": 0.0,
                "velo_n": 0,
                "velo_max": None,
                "spin_sum": 0.0,
                "spin_n": 0,
                "ivb_sum": 0.0,
                "ivb_n": 0,
                "hb_sum": 0.0,
                "hb_n": 0,
            },
        )
        bucket["pitches"] += int(row.get("pitches") or 0)
        bucket["velo_sum"] += float(row.get("velo_sum") or 0.0)
        bucket["velo_n"] += int(row.get("velo_n") or 0)
        vmax = float(row.get("velo_max")) if _is_num(row.get("velo_max")) else None
        if vmax is not None:
            bucket["velo_max"] = vmax if bucket["velo_max"] is None else max(float(bucket["velo_max"]), vmax)
        bucket["spin_sum"] += float(row.get("spin_sum") or 0.0)
        bucket["spin_n"] += int(row.get("spin_n") or 0)
        bucket["ivb_sum"] += float(row.get("ivb_sum") or 0.0)
        bucket["ivb_n"] += int(row.get("ivb_n") or 0)
        bucket["hb_sum"] += float(row.get("hb_sum") or 0.0)
        bucket["hb_n"] += int(row.get("hb_n") or 0)

    for pt, bucket in sorted(pitch_summary_by_type.items(), key=lambda kv: (pitch_order.get(str(kv[0]), 99), str(kv[0]))):
        pitches = int(bucket["pitches"])
        velo_n = int(bucket["velo_n"])
        spin_n = int(bucket["spin_n"])
        ivb_n = int(bucket["ivb_n"])
        hb_n = int(bucket["hb_n"])
        pitch_type_rows.append(
            PitchTypeSummaryRow(
                pitch_type=pt,
                pitches=pitches,
                usage_pct=(100.0 * pitches / total_pitches) if total_pitches > 0 else 0.0,
                avg_velo=(float(bucket["velo_sum"]) / velo_n) if velo_n > 0 else None,
                max_velo=float(bucket["velo_max"]) if _is_num(bucket.get("velo_max")) else None,
                avg_spin=(float(bucket["spin_sum"]) / spin_n) if spin_n > 0 else None,
                avg_ivb=(float(bucket["ivb_sum"]) / ivb_n) if ivb_n > 0 else None,
                avg_hb=(float(bucket["hb_sum"]) / hb_n) if hb_n > 0 else None,
                avg_stuff=None,
            )
        )

    split_items = list(grouped_by_split.items())
    if split_clean == "Pitch Types":
        split_items.sort(key=lambda kv: (pitch_order.get(str(kv[0]), 99), str(kv[0])))
    else:
        split_items.sort(key=lambda kv: (-sum(int(r.get("pitches") or 0) for r in kv[1]), str(kv[0])))

    for split_value, rows_for_split in split_items:
        pitches = int(sum(int(r.get("pitches") or 0) for r in rows_for_split))
        velo_n = int(sum(int(r.get("velo_n") or 0) for r in rows_for_split))
        ivb_n = int(sum(int(r.get("ivb_n") or 0) for r in rows_for_split))
        hb_n = int(sum(int(r.get("hb_n") or 0) for r in rows_for_split))
        bf_n = int(sum(int(r.get("bf_n") or 0) for r in rows_for_split))
        split_max_velo_vals = [float(r.get("velo_max")) for r in rows_for_split if _is_num(r.get("velo_max"))]
        common = {
            split_col_name: split_value,
            "#": pitches,
            "BF": bf_n,
            "Velo": round(sum(float(r.get("velo_sum") or 0.0) for r in rows_for_split) / velo_n, 1) if velo_n > 0 else None,
            "Max": round(max(split_max_velo_vals), 1) if split_max_velo_vals else None,
            "IVB": round(sum(float(r.get("ivb_sum") or 0.0) for r in rows_for_split) / ivb_n, 1) if ivb_n > 0 else None,
            "HB": round(sum(float(r.get("hb_sum") or 0.0) for r in rows_for_split) / hb_n, 1) if hb_n > 0 else None,
            "FPS%": _safe_pct(sum(int(r.get("fps_num") or 0) for r in rows_for_split), sum(int(r.get("fps_den") or 0) for r in rows_for_split)),
            "E+A%": _safe_pct(sum(int(r.get("ea_num") or 0) for r in rows_for_split), sum(int(r.get("ea_den") or 0) for r in rows_for_split)),
            "InZone%": _safe_pct(sum(int(r.get("in_zone_n") or 0) for r in rows_for_split), sum(int(r.get("loc_n") or 0) for r in rows_for_split)),
            "Comp%": _safe_pct(sum(int(r.get("comp_n") or 0) for r in rows_for_split), sum(int(r.get("loc_n") or 0) for r in rows_for_split)),
            "Strike%": _safe_pct(sum(int(r.get("strike_n") or 0) for r in rows_for_split), pitches),
            "Swing%": _safe_pct(sum(int(r.get("swing_n") or 0) for r in rows_for_split), pitches),
            "Whiff%": _safe_pct(sum(int(r.get("whiff_n") or 0) for r in rows_for_split), sum(int(r.get("swing_n") or 0) for r in rows_for_split)),
            "K%": _safe_pct(sum(int(r.get("k_n") or 0) for r in rows_for_split), bf_n),
            "BB%": _safe_pct(sum(int(r.get("bb_n") or 0) for r in rows_for_split), bf_n),
            "CSW%": _safe_pct(sum(int(r.get("csw_n") or 0) for r in rows_for_split), pitches),
            "GB%": _safe_pct(sum(int(r.get("gb_n") or 0) for r in rows_for_split), sum(int(r.get("in_play_n") or 0) for r in rows_for_split)),
            "Barrel%": _safe_pct(sum(int(r.get("barrel_n") or 0) for r in rows_for_split), sum(int(r.get("in_play_n") or 0) for r in rows_for_split)),
            "EV": round(sum(float(r.get("ev_sum") or 0.0) for r in rows_for_split) / max(1, sum(int(r.get("ev_n") or 0) for r in rows_for_split)), 1)
            if sum(int(r.get("ev_n") or 0) for r in rows_for_split) > 0
            else None,
            "LA": round(sum(float(r.get("la_sum") or 0.0) for r in rows_for_split) / max(1, sum(int(r.get("la_n") or 0) for r in rows_for_split)), 1)
            if sum(int(r.get("la_n") or 0) for r in rows_for_split) > 0
            else None,
            "Early%": _safe_pct(sum(int(r.get("early_num") or 0) for r in rows_for_split), sum(int(r.get("early_den") or 0) for r in rows_for_split)),
            "Ahead%": _safe_pct(sum(int(r.get("ahead_num") or 0) for r in rows_for_split), sum(int(r.get("ahead_den") or 0) for r in rows_for_split)),
            "1-1W%": _safe_pct(sum(int(r.get("oneone_num") or 0) for r in rows_for_split), sum(int(r.get("oneone_den") or 0) for r in rows_for_split)),
            "Usage": _safe_pct(pitches, total_pitches),
            "0-0": _safe_pct(sum(int(r.get("count_00_n") or 0) for r in rows_for_split), pitches),
            "Behind": _safe_pct(sum(int(r.get("count_behind_n") or 0) for r in rows_for_split), pitches),
            "Even": _safe_pct(sum(int(r.get("count_even_n") or 0) for r in rows_for_split), pitches),
            "Ahead": _safe_pct(sum(int(r.get("count_ahead_n") or 0) for r in rows_for_split), pitches),
            "<2K": _safe_pct(sum(int(r.get("count_lt2k_n") or 0) for r in rows_for_split), pitches),
            "2K": _safe_pct(sum(int(r.get("count_2k_n") or 0) for r in rows_for_split), pitches),
            "QP%": None,
            "Ctrl+": None,
            "QP+": None,
            "Pitching+": None,
            "RV/100": None,
        }
        table_rows.append(common)

    all_row = {
        split_col_name: "All",
        "#": total_pitches,
        "Velo": round(avg_velo, 1) if _is_num(avg_velo) else None,
        "Max": round(max_velo, 1) if _is_num(max_velo) else None,
        "IVB": round(avg_ivb, 1) if _is_num(avg_ivb) else None,
        "HB": round(avg_hb, 1) if _is_num(avg_hb) else None,
        "FPS%": _safe_pct(sum(int(r.get("fps_num") or 0) for r in grouped_rows), sum(int(r.get("fps_den") or 0) for r in grouped_rows)),
        "Early%": _safe_pct(sum(int(r.get("early_num") or 0) for r in grouped_rows), sum(int(r.get("early_den") or 0) for r in grouped_rows)),
        "Ahead%": _safe_pct(sum(int(r.get("ahead_num") or 0) for r in grouped_rows), sum(int(r.get("ahead_den") or 0) for r in grouped_rows)),
        "1-1W%": _safe_pct(sum(int(r.get("oneone_num") or 0) for r in grouped_rows), sum(int(r.get("oneone_den") or 0) for r in grouped_rows)),
        "E+A%": _safe_pct(sum(int(r.get("ea_num") or 0) for r in grouped_rows), sum(int(r.get("ea_den") or 0) for r in grouped_rows)),
        "InZone%": _safe_pct(sum(int(r.get("in_zone_n") or 0) for r in grouped_rows), total_loc_n),
        "Comp%": _safe_pct(sum(int(r.get("comp_n") or 0) for r in grouped_rows), total_loc_n),
        "Strike%": _safe_pct(sum(int(r.get("strike_n") or 0) for r in grouped_rows), total_pitches),
        "Swing%": _safe_pct(sum(int(r.get("swing_n") or 0) for r in grouped_rows), total_pitches),
        "Whiff%": _safe_pct(sum(int(r.get("whiff_n") or 0) for r in grouped_rows), total_swing_n),
        "CSW%": _safe_pct(sum(int(r.get("csw_n") or 0) for r in grouped_rows), total_pitches),
        "K%": _safe_pct(sum(int(r.get("k_n") or 0) for r in grouped_rows), sum(int(r.get("bf_n") or 0) for r in grouped_rows)),
        "BB%": _safe_pct(sum(int(r.get("bb_n") or 0) for r in grouped_rows), sum(int(r.get("bf_n") or 0) for r in grouped_rows)),
        "GB%": _safe_pct(sum(int(r.get("gb_n") or 0) for r in grouped_rows), sum(int(r.get("in_play_n") or 0) for r in grouped_rows)),
        "Barrel%": _safe_pct(sum(int(r.get("barrel_n") or 0) for r in grouped_rows), sum(int(r.get("in_play_n") or 0) for r in grouped_rows)),
        "EV": round(sum(float(r.get("ev_sum") or 0.0) for r in grouped_rows) / max(1, sum(int(r.get("ev_n") or 0) for r in grouped_rows)), 1)
        if sum(int(r.get("ev_n") or 0) for r in grouped_rows) > 0
        else None,
        "LA": round(sum(float(r.get("la_sum") or 0.0) for r in grouped_rows) / max(1, sum(int(r.get("la_n") or 0) for r in grouped_rows)), 1)
        if sum(int(r.get("la_n") or 0) for r in grouped_rows) > 0
        else None,
        "BF": sum(int(r.get("bf_n") or 0) for r in grouped_rows),
        "Usage": "100.0%",
        "0-0": _safe_pct(sum(int(r.get("count_00_n") or 0) for r in grouped_rows), total_pitches),
        "Behind": _safe_pct(sum(int(r.get("count_behind_n") or 0) for r in grouped_rows), total_pitches),
        "Even": _safe_pct(sum(int(r.get("count_even_n") or 0) for r in grouped_rows), total_pitches),
        "Ahead": _safe_pct(sum(int(r.get("count_ahead_n") or 0) for r in grouped_rows), total_pitches),
        "<2K": _safe_pct(sum(int(r.get("count_lt2k_n") or 0) for r in grouped_rows), total_pitches),
        "2K": _safe_pct(sum(int(r.get("count_2k_n") or 0) for r in grouped_rows), total_pitches),
        "QP%": None,
        "Ctrl+": None,
        "QP+": None,
        "Pitching+": None,
        "RV/100": None,
    }
    table_rows.append(all_row)

    chart_points: List[Dict[str, Any]] = []
    if include_chart_points:
        limit = max(100, min(int(chart_points_limit or 2000), 6000))
        chart_params: Dict[str, Any] = {
            "start_date": start_date,
            "end_date": end_date,
            "pitchers_norm": selected_pitcher_keys,
            "pitchers_count": len(selected_pitcher_keys),
            "pitch_types": selected_pitch_types,
            "pitch_types_count": len(selected_pitch_types),
            "limit_count": limit,
            "zone_left": ZONE_LEFT,
            "zone_right": ZONE_RIGHT,
            "zone_bottom": ZONE_BOTTOM,
            "zone_top": ZONE_TOP,
        }
        chart_where = [
            "pe.school_code = 'LEAGUE'",
            "(%(start_date)s::date IS NULL OR pe.session_date >= %(start_date)s::date)",
            "(%(end_date)s::date IS NULL OR pe.session_date <= %(end_date)s::date)",
            "(%(pitchers_count)s::int = 0 OR " + PITCHER_NAME_NORM_SQL.replace("COALESCE(NULLIF(TRIM(pitcher), ''), '')", "COALESCE(NULLIF(TRIM(pe.pitcher), ''), '')") + " = ANY(%(pitchers_norm)s::text[]))",
            "(%(pitch_types_count)s::int = 0 OR " + PITCH_TYPE_NORMALIZE_SQL.replace("taggedpitchtype", "pe.taggedpitchtype").replace("autopitchtype", "pe.autopitchtype") + " = ANY(%(pitch_types)s::text[]))",
        ]
        if (session_type_filter or "").strip() and session_type_filter != "All":
            if session_type_filter == "Season":
                chart_where.append(
                    "regexp_replace(lower(COALESCE(NULLIF(TRIM(COALESCE(pe.session_type, pe.sessiontype)), ''), '')), '\\\\s+', '', 'g') NOT LIKE '%bull%'"
                )
            else:
                chart_where.append(
                    "regexp_replace(lower(COALESCE(NULLIF(TRIM(COALESCE(pe.session_type, pe.sessiontype)), ''), '')), '\\\\s+', '', 'g') LIKE '%bull%'"
                )
        if hand_norm and hand_norm != "All":
            chart_where.append("CASE WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pe.pitcherthrows), ''), ''), 1)) = 'L' THEN 'Left' WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pe.pitcherthrows), ''), ''), 1)) = 'R' THEN 'Right' ELSE 'Unknown' END = %(pitcherthrows_norm)s::text")
            chart_params["pitcherthrows_norm"] = hand_norm
        if batter_side_norm and batter_side_norm != "All":
            chart_where.append("CASE WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pe.batterside), ''), ''), 1)) = 'L' THEN 'Left' WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pe.batterside), ''), ''), 1)) = 'R' THEN 'Right' ELSE 'Unknown' END = %(batterside_norm)s::text")
            chart_params["batterside_norm"] = batter_side_norm
        if team_type_norm and team_type_norm != "all":
            chart_where.append(PITCHER_TEAM_NORM_SQL.replace("pitcherteam", "pe.pitcherteam") + " = %(team_type_norm)s::text")
            chart_params["team_type_norm"] = team_type_norm
        chart_where_sql = " AND ".join(chart_where)
        try:
            with get_conn() as conn, conn.cursor() as cur:
                cur.execute(
                    f"""
                    SELECT
                      pe.id,
                      pe.session_date,
                      (regexp_match(COALESCE(pe.pitchid::text, pe.pitchno::text, ''), '[-+]?[0-9]+'))[1]::int AS pitch_no,
                      (regexp_match(COALESCE(pe.pitchid::text, pe.pitchno::text, ''), '[-+]?[0-9]+'))[1]::int AS pitch_number,
                      COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'pitchuid', to_jsonb(pe)->>'pitch_uid', pe.pitchuid::text, '')), ''), '') AS pitch_uid,
                      COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', pe.playid::text, '')), ''), '') AS play_id,
                      COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameid', to_jsonb(pe)->>'GameID', '')), ''), '') AS game_id,
                      COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameuid', to_jsonb(pe)->>'GameUID', '')), ''), '') AS game_uid,
                      COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameforeignid', to_jsonb(pe)->>'GameForeignID', '')), ''), '') AS game_foreign_id,
                      COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'inning', to_jsonb(pe)->>'Inning', '')), ''), '') AS inning,
                      COALESCE(NULLIF(TRIM(pe.pitcher), ''), 'Unknown Pitcher') AS pitcher,
                      COALESCE(NULLIF(TRIM(pe.batter), ''), '') AS batter,
                      COALESCE(NULLIF(TRIM(pe.catcher), ''), '') AS catcher,
                      COALESCE(NULLIF(TRIM(pe.pitcherthrows), ''), '') AS pitcherthrows,
                      COALESCE(NULLIF(TRIM(pe.batterside), ''), '') AS batterside,
                      UPPER(COALESCE(NULLIF(TRIM(pe.pitcherteam), ''), '')) AS pitcher_team_code,
                      UPPER(COALESCE(NULLIF(TRIM(pe.batterteam), ''), '')) AS batter_team_code,
                      """ + PITCHER_TEAM_NORM_SQL.replace("pitcherteam", "pe.pitcherteam") + """ AS pitcher_team_norm,
                      """ + BATTER_TEAM_NORM_EFF_SQL.replace("batterteam", "pe.batterteam") + """ AS batter_team_norm_eff,
                      """ + PITCH_TYPE_NORMALIZE_SQL.replace("taggedpitchtype", "pe.taggedpitchtype").replace("autopitchtype", "pe.autopitchtype") + """ AS pitch_type,
                      COALESCE(NULLIF(TRIM(COALESCE(pe.session_type, pe.sessiontype)), ''), 'Unknown') AS session_type_norm,
                      COALESCE(NULLIF(TRIM(pe.pitchcall), ''), '') AS pitch_call,
                      COALESCE(NULLIF(TRIM(pe.playresult), ''), '') AS play_result,
                      COALESCE(NULLIF(TRIM(pe.korbb), ''), '') AS korbb,
                      COALESCE(NULLIF(TRIM(pe.taggedhittype), ''), '') AS tagged_hit_type,
                      (regexp_match(COALESCE(pe.balls::text, ''), '[-+]?[0-9]+'))[1]::int AS balls_num,
                      (regexp_match(COALESCE(pe.strikes::text, ''), '[-+]?[0-9]+'))[1]::int AS strikes_num,
                      (regexp_match(COALESCE(to_jsonb(pe)->>'outs', ''), '[-+]?[0-9]+'))[1]::int AS outs_num,
                      (regexp_match(COALESCE(pe.outsonplay::text, ''), '[-+]?[0-9]+'))[1]::int AS outs_on_play_num,
                      (regexp_match(COALESCE(pe.relside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_side,
                      (regexp_match(COALESCE(pe.relheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_height,
                      (regexp_match(COALESCE(pe.extension, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ext_value,
                      (regexp_match(COALESCE(pe.horzbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS hb,
                      (regexp_match(COALESCE(pe.inducedvertbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ivb,
                      (regexp_match(COALESCE(pe.platelocside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_side,
                      (regexp_match(COALESCE(pe.platelocheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_height,
                      (regexp_match(COALESCE(pe.relspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_speed,
                      (regexp_match(COALESCE(pe.spinrate, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_rate,
                      COALESCE(NULLIF(TRIM(pe.releasetilt), ''), '') AS release_tilt,
                      COALESCE(NULLIF(TRIM(pe.breaktilt), ''), '') AS break_tilt,
                      (regexp_match(COALESCE(pe.spinefficiency, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_eff,
                      (regexp_match(COALESCE(pe.exitspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS exit_speed,
                      (regexp_match(COALESCE(pe.angle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS angle,
                      COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip', '')), ''), '') AS video_clip_1,
                      COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip2', '')), ''), '') AS video_clip_2,
                      COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip3', '')), ''), '') AS video_clip_3
                    FROM public.pitch_events pe
                    WHERE {chart_where_sql}
                    ORDER BY pe.session_date DESC, COALESCE(pe.created_at, NOW()) DESC, pe.id DESC
                    LIMIT %(limit_count)s::int
                    """,
                    chart_params,
                )
                chart_rows = [dict(r) for r in cur.fetchall()]
                chart_rows.reverse()
                chart_points = _build_chart_points(chart_rows, {}, max_points=limit)
        except Exception:
            chart_points = []

    mode_columns_map: Dict[str, List[str]] = {
        "Live": [split_col_name, "#", "Velo", "Max", "IVB", "HB", "FPS%", "E+A%", "InZone%", "Strike%", "Whiff%", "K%", "BB%", "QP+"],
        "Process": [split_col_name, "#", "BF", "RV/100", "InZone%", "Comp%", "Strike%", "Swing%", "FPS%", "Early%", "Ahead%", "E+A%", "1-1W%", "QP%", "Ctrl+", "QP+", "Pitching+"],
        "Results": [split_col_name, "#", "BF", "K%", "BB%", "GB%", "Barrel%", "Whiff%", "CSW%", "EV", "LA"],
        "Usage": [split_col_name, "#", "Usage", "0-0", "Behind", "Even", "Ahead", "<2K", "2K"],
    }
    return PitchingOverviewResponse(
        school_code=school_code,
        pitcher=selected_pitchers[0] if len(selected_pitchers) == 1 else None,
        team_type=team_type,
        opp_hitter=selected_opp_hitters[0] if len(selected_opp_hitters) == 1 else None,
        with_video=with_video,
        break_lines=None,
        stuff_level=None,
        stuff_base=None,
        hand=hand,
        batter_side=batter_side,
        in_zone=selected_in_zone[0] if len(selected_in_zone) == 1 else None,
        qp_locations=qp_locations,
        session_type=(session_type_filter if session_type_filter != "Live" else "Live BP"),
        table_mode=table_mode,
        split_by=split_by,
        selected_zone_locations=selected_zone_locations,
        selected_pitch_types=selected_pitch_types,
        selected_pitch_results=selected_pitch_results,
        selected_count_filters=selected_count_filters,
        selected_after_count_filters=selected_after_count_filters,
        start_date=start_date.isoformat() if start_date else None,
        end_date=end_date.isoformat() if end_date else None,
        total_pitches=total_pitches,
        avg_velo=avg_velo,
        max_velo=max_velo,
        avg_spin=avg_spin,
        avg_ivb=avg_ivb,
        avg_hb=avg_hb,
        avg_stuff=None,
        zone_pct=zone_pct,
        strike_pct=strike_pct,
        whiff_pct=whiff_pct,
        table_columns=mode_columns_map.get(mode_clean, mode_columns_map["Live"]),
        available_table_columns=ALL_TABLE_COLUMNS,
        table_rows=table_rows,
        row_pitches_by_key={},
        pitch_types=pitch_type_rows,
        chart_points=chart_points,
        trend_rows=[],
    )


def _mod_namespaces_for_school(school_code: str) -> List[str]:
    code = (school_code or "").strip().upper()
    base_map = {
        "GCU": ["gcubaseball"],
        "GMU": ["gmubaseball", "gmu"],
        "OSU": ["oklahomastate", "osubaseball"],
        "CNU": ["cnubaseball", "carsonnewman"],
        "LSU": ["lsubaseball", "lsu"],
        "UNM": ["unmbaseball", "unm", "newmexico"],
        "SEMO": ["semobaseball", "semo"],
        "PCU": ["tmdata", "pcu", "pcubaseball"],
    }
    dynamic: List[str] = []
    raw_map = (os.getenv("DASHBOARD_MODIFICATIONS_NAMESPACE_MAP", "") or "").strip()
    if raw_map:
        try:
            import json

            parsed = json.loads(raw_map)
            values = parsed.get(code)
            if isinstance(values, list):
                dynamic = [str(v).strip().lower() for v in values if str(v).strip()]
            elif isinstance(values, str) and values.strip():
                dynamic = [values.strip().lower()]
        except Exception:
            dynamic = []
    fallback = [code.lower(), f"{code.lower()}baseball"]
    values = [*dynamic, *(base_map.get(code) or []), *fallback]
    deduped: List[str] = []
    seen: set[str] = set()
    for value in values:
        key = (value or "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(key)
    return deduped


def _sync_modifications_into_pitch_events(school_code: str, force: bool = False) -> None:
    normalized_school = _validate_school_code(school_code)
    now = time.monotonic()
    last = _MOD_SYNC_LAST_AT.get(normalized_school, 0.0)
    if not force and (now - last) < _MOD_SYNC_INTERVAL_SECONDS:
        return

    namespaces = _mod_namespaces_for_school(normalized_school)
    if not namespaces:
        _MOD_SYNC_LAST_AT[normalized_school] = now
        return

    try:
        with get_conn() as conn, conn.cursor() as cur:
            _ensure_pitch_event_edits_table(cur)
            cur.execute("SELECT to_regclass('public.modifications')::text AS table_name")
            reg = cur.fetchone() or {}
            if not reg.get("table_name"):
                _MOD_SYNC_LAST_AT[normalized_school] = now
                return

            cur.execute(
                """
                WITH latest_mod AS (
                  SELECT DISTINCT ON (btrim(m.pitch_key))
                    btrim(m.pitch_key) AS pitch_key,
                    NULLIF(btrim(m.new_pitch_type), '') AS new_pitch_type,
                    NULLIF(btrim(m.new_pitcher), '') AS new_pitcher
                  FROM public.modifications m
                  WHERE lower(btrim(COALESCE(m.namespace, ''))) = ANY(%(namespaces)s::text[])
                    AND COALESCE(m.is_deleted, 0) = 0
                    AND NULLIF(btrim(COALESCE(m.pitch_key, '')), '') IS NOT NULL
                    AND (
                      NULLIF(btrim(COALESCE(m.new_pitch_type, '')), '') IS NOT NULL
                      OR NULLIF(btrim(COALESCE(m.new_pitcher, '')), '') IS NOT NULL
                    )
                  ORDER BY btrim(m.pitch_key), COALESCE(m.modified_at, m.created_at) DESC, m.id DESC
                ),
                updated AS (
                  UPDATE public.pitch_events pe
                     SET taggedpitchtype = COALESCE(lm.new_pitch_type, pe.taggedpitchtype),
                         pitcher = COALESCE(lm.new_pitcher, pe.pitcher)
                    FROM latest_mod lm
                   WHERE pe.school_code = %(school_code)s
                     AND btrim(COALESCE(pe.pitch_key, '')) = lm.pitch_key
                     AND (
                       (lm.new_pitch_type IS NOT NULL AND COALESCE(btrim(pe.taggedpitchtype), '') <> lm.new_pitch_type)
                       OR
                       (lm.new_pitcher IS NOT NULL AND COALESCE(btrim(pe.pitcher), '') <> lm.new_pitcher)
                     )
                  RETURNING
                    pe.id AS pitch_event_id,
                    COALESCE(NULLIF(btrim(pe.taggedpitchtype), ''), 'Undefined') AS pitch_type,
                    COALESCE(NULLIF(btrim(pe.pitcher), ''), '') AS pitcher
                )
                INSERT INTO public.pitch_event_edits (school_code, pitch_event_id, pitch_type, pitcher)
                SELECT %(school_code)s, u.pitch_event_id, u.pitch_type, u.pitcher
                FROM updated u
                ON CONFLICT (school_code, pitch_event_id, pitch_type, pitcher) DO NOTHING
                """,
                {
                    "school_code": normalized_school,
                    "namespaces": namespaces,
                },
            )
            _MOD_SYNC_LAST_AT[normalized_school] = now
    except Exception:
        # Never break core endpoints if modifications sync has a transient issue.
        _MOD_SYNC_LAST_AT[normalized_school] = now


PITCH_TYPE_NORMALIZE_SQL = """
CASE
  WHEN regexp_replace(lower(COALESCE(TRIM(taggedpitchtype), '')), '[^a-z0-9]', '', 'g')
       IN ('', 'unknown', 'undefined', 'other') THEN 'Undefined'
  WHEN regexp_replace(lower(COALESCE(TRIM(taggedpitchtype), '')), '[^a-z0-9]', '', 'g')
       IN ('fastball', 'fourseamfastball') THEN 'Fastball'
  WHEN regexp_replace(lower(COALESCE(TRIM(taggedpitchtype), '')), '[^a-z0-9]', '', 'g')
       IN ('sinker', 'oneseamfastball', 'twoseamfastball', 'twoseamfasball') THEN 'Sinker'
  ELSE COALESCE(NULLIF(TRIM(taggedpitchtype), ''), 'Undefined')
END
"""

PITCH_TYPE_ORDER_SQL = """
CASE """ + PITCH_TYPE_NORMALIZE_SQL + """
  WHEN 'Fastball' THEN 1
  WHEN 'Sinker' THEN 2
  WHEN 'Cutter' THEN 3
  WHEN 'Slider' THEN 4
  WHEN 'Sweeper' THEN 5
  WHEN 'Curveball' THEN 6
  WHEN 'ChangeUp' THEN 7
  WHEN 'Splitter' THEN 8
  WHEN 'Knuckleball' THEN 9
  WHEN 'Undefined' THEN 10
  ELSE 99
END
"""

TEAM_BUCKET_SQL = """
CASE
  WHEN (
    %(campers_norm_count)s::int > 0 AND
    regexp_replace(lower(COALESCE(NULLIF(TRIM(pitcher), ''), '')), '[^a-z0-9]', '', 'g') = ANY(%(campers_norm)s::text[])
  ) THEN 'Campers'
  WHEN (
    %(team_norm_count)s::int > 0 AND
    regexp_replace(lower(COALESCE(NULLIF(TRIM(pitcher), ''), '')), '[^a-z0-9]', '', 'g') = ANY(%(team_norm)s::text[])
  ) OR (
    EXISTS (
      SELECT 1
      FROM unnest(%(team_markers_norm)s::text[]) AS tm(code)
      WHERE regexp_replace(UPPER(COALESCE(NULLIF(TRIM(pitcherteam), ''), '')), '[^A-Z0-9_]', '', 'g') = tm.code
    )
  ) OR (
    %(team_norm_count)s::int = 0 AND
    COALESCE(NULLIF(TRIM(pitcherteam), ''), '') = '' AND
    COALESCE(NULLIF(TRIM(batterteam), ''), '') = '' AND
    COALESCE(NULLIF(TRIM(hometeam), ''), '') = '' AND
    COALESCE(NULLIF(TRIM(awayteam), ''), '') = ''
  ) THEN %(school_code)s
  ELSE 'Opponents'
END
"""

PITCHER_TEAM_NORM_SQL = "regexp_replace(UPPER(COALESCE(NULLIF(TRIM(pitcherteam), ''), '')), '[^A-Z0-9_]', '', 'g')"
BATTER_TEAM_NORM_EFF_SQL = """
regexp_replace(
  UPPER(
    COALESCE(
      NULLIF(TRIM(batterteam), ''),
      CASE
        WHEN UPPER(COALESCE(NULLIF(TRIM(hometeam), ''), '')) = UPPER(COALESCE(NULLIF(TRIM(pitcherteam), ''), ''))
          THEN NULLIF(TRIM(awayteam), '')
        WHEN UPPER(COALESCE(NULLIF(TRIM(awayteam), ''), '')) = UPPER(COALESCE(NULLIF(TRIM(pitcherteam), ''), ''))
          THEN NULLIF(TRIM(hometeam), '')
        ELSE NULL
      END,
      ''
    )
  ),
  '[^A-Z0-9_]',
  '',
  'g'
)
"""
BATTER_TEAM_NORM_SQL = "regexp_replace(UPPER(COALESCE(NULLIF(TRIM(batterteam), ''), '')), '[^A-Z0-9_]', '', 'g')"
HOME_TEAM_NORM_SQL = "regexp_replace(UPPER(COALESCE(NULLIF(TRIM(hometeam), ''), '')), '[^A-Z0-9_]', '', 'g')"
AWAY_TEAM_NORM_SQL = "regexp_replace(UPPER(COALESCE(NULLIF(TRIM(awayteam), ''), '')), '[^A-Z0-9_]', '', 'g')"
PITCHER_NAME_NORM_SQL = "regexp_replace(lower(COALESCE(NULLIF(TRIM(pitcher), ''), '')), '[^a-z0-9]', '', 'g')"
BATTER_NAME_NORM_SQL = "regexp_replace(lower(COALESCE(NULLIF(TRIM(batter), ''), '')), '[^a-z0-9]', '', 'g')"
CATCHER_NAME_NORM_SQL = "regexp_replace(lower(COALESCE(NULLIF(TRIM(catcher), ''), '')), '[^a-z0-9]', '', 'g')"

TEAM_MARKER_MATCH_TEMPLATE_SQL = """
EXISTS (
  SELECT 1
  FROM unnest(%(team_markers_norm)s::text[]) AS tm(code)
  WHERE {team_expr} = tm.code
)
"""
PITCHER_TEAM_IS_MARKER_SQL = TEAM_MARKER_MATCH_TEMPLATE_SQL.format(team_expr=PITCHER_TEAM_NORM_SQL)
BATTER_TEAM_IS_MARKER_SQL = TEAM_MARKER_MATCH_TEMPLATE_SQL.format(team_expr=BATTER_TEAM_NORM_SQL)
BLANK_TEAM_CODES_SQL = "(" + PITCHER_TEAM_NORM_SQL + " = '' AND " + BATTER_TEAM_NORM_SQL + " = '')"
HOME_TEAM_IS_MARKER_SQL = TEAM_MARKER_MATCH_TEMPLATE_SQL.format(team_expr=HOME_TEAM_NORM_SQL)
AWAY_TEAM_IS_MARKER_SQL = TEAM_MARKER_MATCH_TEMPLATE_SQL.format(team_expr=AWAY_TEAM_NORM_SQL)
OPPONENT_TEAM_MATCH_SQL = """
(
  (
    """ + PITCHER_TEAM_IS_MARKER_SQL + """ AND """ + BATTER_TEAM_NORM_EFF_SQL + """ <> '' AND NOT (""" + BATTER_TEAM_IS_MARKER_SQL + """)
  )
  OR
  (
    """ + BATTER_TEAM_IS_MARKER_SQL + """ AND """ + PITCHER_TEAM_NORM_SQL + """ <> '' AND NOT (""" + PITCHER_TEAM_IS_MARKER_SQL + """)
  )
  OR
  (
    """ + HOME_TEAM_IS_MARKER_SQL + """ AND """ + AWAY_TEAM_NORM_SQL + """ <> '' AND NOT (""" + AWAY_TEAM_IS_MARKER_SQL + """)
  )
  OR
  (
    """ + AWAY_TEAM_IS_MARKER_SQL + """ AND """ + HOME_TEAM_NORM_SQL + """ <> '' AND NOT (""" + HOME_TEAM_IS_MARKER_SQL + """)
  )
)
"""
PITCHING_TEAM_MATCH_SQL = """
(
  """ + PITCHER_TEAM_IS_MARKER_SQL + """
  AND NOT (""" + BATTER_TEAM_IS_MARKER_SQL + """)
)
OR
(
  UPPER(COALESCE(%(school_code)s::text, '')) = 'PCU'
  AND """ + BLANK_TEAM_CODES_SQL + """
  AND (
    (
      %(known_pitchers_count)s::int > 0
      AND """ + PITCHER_NAME_NORM_SQL + """ = ANY(%(known_pitchers)s::text[])
    )
    OR
    (
      %(known_campers_count)s::int > 0
      AND """ + PITCHER_NAME_NORM_SQL + """ = ANY(%(known_campers)s::text[])
    )
  )
)
"""
PITCHING_OPPONENT_MATCH_SQL = """
(
  """ + BATTER_TEAM_IS_MARKER_SQL + """
  AND """ + PITCHER_TEAM_NORM_SQL + """ <> ''
  AND NOT (""" + PITCHER_TEAM_IS_MARKER_SQL + """)
)
"""
HITTING_TEAM_MATCH_SQL = """
(
  """ + BATTER_TEAM_IS_MARKER_SQL + """
  AND NOT (""" + PITCHER_TEAM_IS_MARKER_SQL + """)
)
OR
(
  UPPER(COALESCE(%(school_code)s::text, '')) = 'PCU'
  AND """ + BLANK_TEAM_CODES_SQL + """
  AND (
    (
      %(known_hitters_count)s::int > 0
      AND """ + BATTER_NAME_NORM_SQL + """ = ANY(%(known_hitters)s::text[])
    )
    OR
    (
      %(known_campers_count)s::int > 0
      AND """ + BATTER_NAME_NORM_SQL + """ = ANY(%(known_campers)s::text[])
    )
  )
)
"""
HITTING_OPPONENT_MATCH_SQL = """
(
  """ + PITCHER_TEAM_IS_MARKER_SQL + """
  AND """ + BATTER_TEAM_NORM_SQL + """ <> ''
  AND NOT (""" + BATTER_TEAM_IS_MARKER_SQL + """)
)
"""
# Only include rows that are explicitly tied to the school by team code.
# This prevents unrelated uploads (same school_code bucket) from leaking into All/Team/Opponent views.
SCHOOL_RELEVANT_TEAM_SQL = (
    "("
    + PITCHER_TEAM_IS_MARKER_SQL
    + " OR "
    + BATTER_TEAM_IS_MARKER_SQL
    + " OR (UPPER(COALESCE(%(school_code)s::text, '')) = 'LEAGUE')"
    + " OR (UPPER(COALESCE(%(school_code)s::text, '')) = 'PCU' AND "
    + BLANK_TEAM_CODES_SQL
    + ")"
    + ")"
)

PITCHER_NAME_IS_KNOWN_SQL = """
(
  (%(known_pitchers_count)s::int > 0 AND """ + PITCHER_NAME_NORM_SQL + """ = ANY(%(known_pitchers)s::text[]))
  OR
  (%(known_campers_count)s::int > 0 AND """ + PITCHER_NAME_NORM_SQL + """ = ANY(%(known_campers)s::text[]))
)
"""
BATTER_NAME_IS_KNOWN_SQL = """
(
  (%(known_hitters_count)s::int > 0 AND """ + BATTER_NAME_NORM_SQL + """ = ANY(%(known_hitters)s::text[]))
  OR
  (%(known_campers_count)s::int > 0 AND """ + BATTER_NAME_NORM_SQL + """ = ANY(%(known_campers)s::text[]))
)
"""


@app.get("/health")
def health() -> Dict[str, str]:
    return {"status": "ok"}


@app.get("/v1/pitching/filters", response_model=PitchingFiltersResponse)
def pitching_filters(school_code: str = Query(..., min_length=1)) -> PitchingFiltersResponse:
    school_code = _validate_school_code(school_code)
    _ensure_performance_indexes()
    _sync_modifications_into_pitch_events(school_code)
    roster = _load_school_roster(school_code)
    team_norm = set(roster.get("team_only_norm", []) or [])
    hitter_norm = set(roster.get("hitter_norm", []) or [])
    campers_norm = set(roster.get("campers_norm", []) or [])
    team_markers_norm = sorted(set(roster.get("team_markers_norm", []) or []))
    pitchers_by_team_code: Dict[str, List[str]] = {}
    opp_hitters_by_team_code: Dict[str, List[str]] = {}
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  MIN(session_date)::text AS min_date,
                  MAX(session_date)::text AS max_date
                FROM public.pitch_events
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                """,
                {"school_code": school_code, "team_markers_norm": team_markers_norm},
            )
            date_row = cur.fetchone() or {}

            cur.execute(
                """
                SELECT DISTINCT TRIM(pitcher) AS pitcher
                FROM public.pitch_events
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                  AND COALESCE(TRIM(pitcher), '') <> ''
                ORDER BY pitcher ASC
                """,
                {"school_code": school_code, "team_markers_norm": team_markers_norm},
            )
            pitchers = [str(row["pitcher"]) for row in cur.fetchall()]

            cur.execute(
                """
                SELECT DISTINCT TRIM(batter) AS opp_hitter
                FROM public.pitch_events
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                  AND COALESCE(TRIM(batter), '') <> ''
                ORDER BY opp_hitter ASC
                """,
                {"school_code": school_code, "team_markers_norm": team_markers_norm},
            )
            opp_hitters = [str(row["opp_hitter"]) for row in cur.fetchall()]

            session_types = ["Season", "All"] if school_code == "LEAGUE" else ["Season", "Bullpen", "Live BP", "All"]

            cur.execute(
                """
                SELECT pitch_type
                FROM (
                  SELECT DISTINCT
                    """ + PITCH_TYPE_NORMALIZE_SQL + """ AS pitch_type,
                    """ + PITCH_TYPE_ORDER_SQL + """ AS pitch_sort
                  FROM public.pitch_events
                  WHERE school_code = %(school_code)s
                    AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                ) t
                ORDER BY t.pitch_sort ASC, t.pitch_type ASC
                """,
                {"school_code": school_code, "team_markers_norm": team_markers_norm},
            )
            pitch_types = [str(row["pitch_type"]) for row in cur.fetchall() if str(row["pitch_type"]) != "Undefined"]

            if school_code == "LEAGUE":
                cur.execute(_league_team_codes_sql_expr(), {"school_code": school_code})
                league_team_codes = [str(row["team_code"]) for row in cur.fetchall() if str(row.get("team_code") or "").strip()]
                team_types = ["All", *league_team_codes]
                cur.execute(_league_name_map_sql_expr("pitcherteam", "pitcher"), {"school_code": school_code})
                pitchers_by_team_code = {
                    str(row["team_code"]): [str(name) for name in (row.get("names") or []) if str(name).strip()]
                    for row in cur.fetchall()
                }
                cur.execute(_league_name_map_sql_expr("pitcherteam", "batter"), {"school_code": school_code})
                opp_hitters_by_team_code = {
                    str(row["team_code"]): [str(name) for name in (row.get("names") or []) if str(name).strip()]
                    for row in cur.fetchall()
                }
            else:
                team_types = ["All", school_code, "Opponents", "Campers"]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"filters query failed: {exc}") from exc

    allowed_pitcher_keys = set(team_norm | campers_norm)
    if allowed_pitcher_keys:
        pitchers = [name for name in pitchers if _normalize_name_key(name) in allowed_pitcher_keys]
    known_hitter_keys = set(hitter_norm | campers_norm)
    if known_hitter_keys:
        opp_hitters = [name for name in opp_hitters if _normalize_name_key(name) not in known_hitter_keys]

    return PitchingFiltersResponse(
        school_code=school_code,
        min_date=date_row.get("min_date"),
        max_date=date_row.get("max_date"),
        pitchers=pitchers,
        team_types=team_types,
        opp_hitters=opp_hitters,
        with_video_options=["All", "Yes", "No"],
        break_lines_options=["None", "Fastball", "Sinker"],
        stuff_level_options=["Pro", "College", "High School"],
        stuff_base_options=["Fastball", "Sinker"],
        hands=["All", "Left", "Right"],
        batter_sides=["All", "Left", "Right"],
        session_types=session_types,
        pitch_types=pitch_types,
        zone_locations=ZONE_LOCATION_CHOICES,
        in_zone_options=["All", "Yes", "No", "Competitive"],
        qp_location_options=["All", "Yes", "No"],
        pitch_results=PITCH_RESULT_CHOICES,
        count_options=COUNT_CHOICES,
        after_count_options=COUNT_CHOICES,
        pitchers_by_team_code=pitchers_by_team_code or None,
        opp_hitters_by_team_code=opp_hitters_by_team_code or None,
    )


@app.get("/v1/pitching/overview", response_model=PitchingOverviewResponse)
def pitching_overview(
    school_code: str = Query(..., min_length=1),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    pitcher: Optional[str] = Query(default=None),
    team_type: Optional[str] = Query(default=None),
    opp_hitter: Optional[str] = Query(default=None),
    with_video: Optional[str] = Query(default=None),
    break_lines: Optional[str] = Query(default=None),
    stuff_level: Optional[str] = Query(default=None),
    stuff_base: Optional[str] = Query(default=None),
    hand: Optional[str] = Query(default=None),
    batter_side: Optional[str] = Query(default=None),
    session_type: Optional[str] = Query(default=None),
    table_mode: Optional[str] = Query(default=None),
    split_by: Optional[str] = Query(default=None),
    custom_columns: Optional[str] = Query(default=None),
    visual_option: Optional[str] = Query(default=None),
    in_zone: Optional[str] = Query(default=None),
    qp_locations: Optional[str] = Query(default=None),
    pitch_types: Optional[str] = Query(default=None),
    zone_locations: Optional[str] = Query(default=None),
    pitch_results: Optional[str] = Query(default=None),
    count_filter: Optional[str] = Query(default=None),
    after_count_filter: Optional[str] = Query(default=None),
    velo_min: Optional[str] = Query(default=None),
    velo_max: Optional[str] = Query(default=None),
    ivb_min: Optional[str] = Query(default=None),
    ivb_max: Optional[str] = Query(default=None),
    hb_min: Optional[str] = Query(default=None),
    hb_max: Optional[str] = Query(default=None),
    pc_min: Optional[str] = Query(default=None),
    pc_max: Optional[str] = Query(default=None),
    include_chart_points: bool = Query(default=True),
    chart_points_limit: Optional[int] = Query(default=None),
    include_row_pitches: bool = Query(default=True),
    include_trend_rows: bool = Query(default=True),
) -> PitchingOverviewResponse:
    school_code = _validate_school_code(school_code)
    _ensure_performance_indexes()
    _sync_modifications_into_pitch_events(school_code)
    roster = _load_school_roster(school_code)
    team_norm = roster.get("team_only_norm", [])
    hitter_norm = roster.get("hitter_norm", [])
    campers_norm = roster.get("campers_norm", [])
    team_markers_norm = roster.get("team_markers_norm", [])
    selected_pitchers = _parse_name_list(pitcher)
    selected_pitcher_keys = _name_filter_keys(selected_pitchers)
    team_type = (team_type or "").strip() or None
    selected_opp_hitters = _parse_name_list(opp_hitter)
    selected_opp_hitter_keys = _name_filter_keys(selected_opp_hitters)
    with_video = (with_video or "").strip() or None
    break_lines = (break_lines or "").strip() or None
    stuff_level = (stuff_level or "").strip() or None
    stuff_base = (stuff_base or "").strip() or None
    hand = (hand or "").strip() or None
    batter_side = (batter_side or "").strip() or None
    session_type_filter = _normalize_session_type_filter(session_type)
    use_osu_date_session_rules = school_code.upper() == "OSU"
    table_mode_raw = (table_mode or "").strip() or "Stuff"
    table_mode_map = {
        "stuff": "Stuff",
        "process": "Process",
        "results": "Results",
        "hitting results": "Hitting Results",
        "bullpen": "Bullpen",
        "live": "Live",
        "usage": "Usage",
        "raw data": "Raw Data",
        "batted ball data": "Batted Ball Data",
        "swing decisions": "Swing Decisions",
        "custom": "Custom",
    }
    table_mode = table_mode_map.get(table_mode_raw.lower(), table_mode_raw)
    split_by = (split_by or "").strip() or "Pitch Types"
    visual_option = (visual_option or "").strip() or "Play Video"
    selected_in_zone = _parse_csv_list(in_zone)
    qp_locations = (qp_locations or "").strip() or None

    selected_pitch_types = _valid_pitch_types(_parse_csv_list(pitch_types))
    selected_zone_locations = _parse_csv_list(zone_locations)
    selected_pitch_results = _parse_csv_list(pitch_results)
    selected_count_filters = _parse_csv_list(count_filter)
    selected_after_count_filters = _parse_csv_list(after_count_filter)
    selected_custom_columns = _parse_csv_list(custom_columns)

    parsed_velo_min = _parse_optional_float(velo_min, "velo_min")
    parsed_velo_max = _parse_optional_float(velo_max, "velo_max")
    parsed_ivb_min = _parse_optional_float(ivb_min, "ivb_min")
    parsed_ivb_max = _parse_optional_float(ivb_max, "ivb_max")
    parsed_hb_min = _parse_optional_float(hb_min, "hb_min")
    parsed_hb_max = _parse_optional_float(hb_max, "hb_max")
    parsed_pc_min = _parse_optional_int(pc_min, "pc_min")
    parsed_pc_max = _parse_optional_int(pc_max, "pc_max")
    parsed_chart_points_limit = (
        max(100, min(int(chart_points_limit), 6000)) if chart_points_limit is not None else None
    )

    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date.")

    params = {
        "school_code": school_code,
        "start_date": start_date,
        "end_date": end_date,
        "pitchers_norm": selected_pitcher_keys,
        "pitchers_count": len(selected_pitcher_keys),
        "team_type": team_type,
        "team_type_norm": _normalize_team_code(team_type or ""),
        "team_norm": team_norm,
        "team_norm_count": len(team_norm),
        "known_pitchers": team_norm,
        "known_pitchers_count": len(team_norm),
        "known_hitters": hitter_norm,
        "known_hitters_count": len(hitter_norm),
        "known_campers": campers_norm,
        "known_campers_count": len(campers_norm),
        "campers_norm": campers_norm,
        "campers_norm_count": len(campers_norm),
        "team_markers_norm": team_markers_norm,
        "team_markers_norm_count": len(team_markers_norm),
        "opp_hitters_norm": selected_opp_hitter_keys,
        "opp_hitters_count": len(selected_opp_hitter_keys),
        "with_video": with_video,
        "hand": hand,
        "batter_side": batter_side,
        "session_type_filter": session_type_filter,
        "use_osu_date_session_rules": use_osu_date_session_rules,
        "osu_season_start": OSU_SEASON_START,
        "osu_season_end": OSU_SEASON_END,
        "table_mode": table_mode,
        "split_by": split_by,
        "custom_columns": selected_custom_columns,
        "visual_option": visual_option,
        "in_zone_filters": selected_in_zone,
        "in_zone_filters_count": len(selected_in_zone),
        "qp_locations": qp_locations,
        "pitch_types": selected_pitch_types,
        "pitch_types_count": len(selected_pitch_types),
        "zone_locations": selected_zone_locations,
        "zone_locations_count": len(selected_zone_locations),
        "pitch_results": selected_pitch_results,
        "pitch_results_count": len(selected_pitch_results),
        "count_filter": selected_count_filters,
        "count_filter_count": len(selected_count_filters),
        "after_count_filter": selected_after_count_filters,
        "after_count_filter_count": len(selected_after_count_filters),
        "velo_min": parsed_velo_min,
        "velo_max": parsed_velo_max,
        "ivb_min": parsed_ivb_min,
        "ivb_max": parsed_ivb_max,
        "hb_min": parsed_hb_min,
        "hb_max": parsed_hb_max,
        "pc_min": parsed_pc_min,
        "pc_max": parsed_pc_max,
        "zone_left": ZONE_LEFT,
        "zone_right": ZONE_RIGHT,
        "zone_bottom": ZONE_BOTTOM,
        "zone_top": ZONE_TOP,
        "zone_mid_x": ZONE_MID_X,
        "zone_mid_y": ZONE_MID_Y,
        "zone_dx": ZONE_DX,
        "zone_dy": ZONE_DY,
    }
    overview_cache_key = _overview_cache_key(
        "pitching_overview",
        school_code,
        {
            "school_code": school_code,
            "start_date": start_date,
            "end_date": end_date,
            "pitcher": selected_pitchers,
            "team_type": team_type,
            "opp_hitter": selected_opp_hitters,
            "with_video": with_video,
            "break_lines": break_lines,
            "stuff_level": stuff_level,
            "stuff_base": stuff_base,
            "hand": hand,
            "batter_side": batter_side,
            "session_type": session_type_filter,
            "table_mode": table_mode,
            "split_by": split_by,
            "custom_columns": selected_custom_columns,
            "visual_option": visual_option,
            "in_zone": selected_in_zone,
            "qp_locations": qp_locations,
            "pitch_types": selected_pitch_types,
            "zone_locations": selected_zone_locations,
            "pitch_results": selected_pitch_results,
            "count_filter": selected_count_filters,
            "after_count_filter": selected_after_count_filters,
            "velo_min": parsed_velo_min,
            "velo_max": parsed_velo_max,
            "ivb_min": parsed_ivb_min,
            "ivb_max": parsed_ivb_max,
            "hb_min": parsed_hb_min,
            "hb_max": parsed_hb_max,
            "pc_min": parsed_pc_min,
            "pc_max": parsed_pc_max,
            "include_chart_points": include_chart_points,
            "chart_points_limit": parsed_chart_points_limit,
            "include_row_pitches": include_row_pitches,
            "include_trend_rows": include_trend_rows,
        },
    )
    cached_overview = _overview_cache_get(overview_cache_key)
    if cached_overview is not None:
        return cached_overview
    rollup_fast_response = _try_pitching_overview_daily_rollup(
        school_code=school_code,
        start_date=start_date,
        end_date=end_date,
        selected_pitchers=selected_pitchers,
        selected_pitcher_keys=selected_pitcher_keys,
        team_type=team_type,
        selected_opp_hitters=selected_opp_hitters,
        with_video=with_video,
        hand=hand,
        batter_side=batter_side,
        session_type_filter=session_type_filter,
        table_mode=table_mode,
        split_by=split_by,
        selected_in_zone=selected_in_zone,
        qp_locations=qp_locations,
        selected_pitch_types=selected_pitch_types,
        selected_zone_locations=selected_zone_locations,
        selected_pitch_results=selected_pitch_results,
        selected_count_filters=selected_count_filters,
        selected_after_count_filters=selected_after_count_filters,
        parsed_velo_min=parsed_velo_min,
        parsed_velo_max=parsed_velo_max,
        parsed_ivb_min=parsed_ivb_min,
        parsed_ivb_max=parsed_ivb_max,
        parsed_hb_min=parsed_hb_min,
        parsed_hb_max=parsed_hb_max,
        parsed_pc_min=parsed_pc_min,
        parsed_pc_max=parsed_pc_max,
        include_chart_points=include_chart_points,
        chart_points_limit=parsed_chart_points_limit,
        include_row_pitches=include_row_pitches,
        include_trend_rows=include_trend_rows,
    )
    if rollup_fast_response is not None:
        _overview_cache_set(overview_cache_key, rollup_fast_response)
        return rollup_fast_response
    need_prev_counts = bool(selected_after_count_filters) or (split_by == "After Count")
    need_pitch_number = parsed_pc_min is not None or parsed_pc_max is not None

    query = """
      WITH
      __VIDEO_MAP_CTE__
      pd_uid_map AS (
        SELECT DISTINCT ON (lower(btrim(pd."PitchUID"::text)))
          lower(btrim(pd."PitchUID"::text)) AS pitchuid_key,
          pd."Inning"::text AS inning
        FROM public.pitch_data pd
        WHERE
          (%(session_type_filter)s::text = 'Live')
          AND pd."PitchUID" IS NOT NULL
          AND btrim(pd."PitchUID"::text) <> ''
          AND pd."Inning" IS NOT NULL
          AND btrim(pd."Inning"::text) <> ''
          AND (%(start_date)s::date IS NULL OR pd."Date"::date >= %(start_date)s::date)
          AND (%(end_date)s::date IS NULL OR pd."Date"::date <= %(end_date)s::date)
        ORDER BY lower(btrim(pd."PitchUID"::text)), pd."Date" DESC NULLS LAST
      ),
      pd_play_map AS (
        SELECT DISTINCT ON (lower(btrim(pd."PlayID"::text)))
          lower(btrim(pd."PlayID"::text)) AS playid_key,
          pd."Inning"::text AS inning
        FROM public.pitch_data pd
        WHERE
          (%(session_type_filter)s::text = 'Live')
          AND pd."PlayID" IS NOT NULL
          AND btrim(pd."PlayID"::text) <> ''
          AND pd."Inning" IS NOT NULL
          AND btrim(pd."Inning"::text) <> ''
          AND (%(start_date)s::date IS NULL OR pd."Date"::date >= %(start_date)s::date)
          AND (%(end_date)s::date IS NULL OR pd."Date"::date <= %(end_date)s::date)
        ORDER BY lower(btrim(pd."PlayID"::text)), pd."Date" DESC NULLS LAST
      ),
      base_raw AS (
        SELECT
          id,
          session_date,
          date,
          (regexp_match(COALESCE(to_jsonb(pe)->>'pitchid', to_jsonb(pe)->>'pitchno', ''), '[-+]?[0-9]+'))[1]::int AS pitch_no,
          COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'pitchuid', to_jsonb(pe)->>'pitch_uid', '')), ''), '') AS pitch_uid,
          COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', '')), ''), '') AS play_id,
          COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameid', to_jsonb(pe)->>'GameID', '')), ''), '') AS game_id,
          COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameuid', to_jsonb(pe)->>'GameUID', '')), ''), '') AS game_uid,
          COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameforeignid', to_jsonb(pe)->>'GameForeignID', '')), ''), '') AS game_foreign_id,
          COALESCE(
            NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'inning', to_jsonb(pe)->>'Inning', '')), ''),
            NULLIF(TRIM(pd_uid.inning), ''),
            NULLIF(TRIM(pd_play.inning), ''),
            ''
          ) AS inning,
          COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip', '')), ''), '') AS video_clip_1,
          COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip2', '')), ''), '') AS video_clip_2,
          COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip3', '')), ''), '') AS video_clip_3,
          COALESCE(
            NULLIF(TRIM(pitcher), ''),
            NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'Pitcher', '')), ''),
            NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'pitcher_name', '')), ''),
            NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'PitcherName', '')), ''),
            NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'athlete_name', '')), ''),
            NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'AthleteName', '')), ''),
            'Unknown Pitcher'
          ) AS pitcher,
          batter,
          catcher,
          pitcherthrows,
          batterside,
          COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), 'Unknown') AS session_type_norm,
          UPPER(COALESCE(NULLIF(TRIM(pitcherteam), ''), '')) AS pitcher_team_code,
          UPPER(COALESCE(NULLIF(TRIM(batterteam), ''), '')) AS batter_team_code,
          """ + PITCHER_TEAM_NORM_SQL + """ AS pitcher_team_norm,
          """ + BATTER_TEAM_NORM_EFF_SQL + """ AS batter_team_norm_eff,
          """ + PITCH_TYPE_NORMALIZE_SQL + """ AS pitch_type,
          COALESCE(NULLIF(TRIM(pitchcall), ''), '') AS pitch_call,
          COALESCE(NULLIF(TRIM(korbb), ''), '') AS korbb,
          COALESCE(NULLIF(TRIM(playresult), ''), '') AS play_result,
          """ + TEAM_BUCKET_SQL + """ AS team_type_norm,
          (regexp_match(COALESCE(relspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_speed,
          (regexp_match(COALESCE(spinrate, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_rate,
          COALESCE(NULLIF(TRIM(releasetilt), ''), '') AS release_tilt,
          COALESCE(NULLIF(TRIM(breaktilt), ''), '') AS break_tilt,
          (regexp_match(COALESCE(spinefficiency, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_eff,
          (regexp_match(COALESCE(exitspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS exit_speed,
          (regexp_match(COALESCE(angle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS angle,
          (regexp_match(COALESCE(inducedvertbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ivb,
          (regexp_match(COALESCE(horzbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS hb,
          (regexp_match(COALESCE(relheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_height,
          (regexp_match(COALESCE(relside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_side,
          (regexp_match(COALESCE(vertapprangle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS vaa,
          (regexp_match(COALESCE(horzapprangle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS haa,
          (regexp_match(COALESCE(extension, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ext_value,
          COALESCE(NULLIF(TRIM(taggedhittype), ''), '') AS tagged_hit_type,
          (regexp_match(COALESCE(outsonplay::text, ''), '[-+]?[0-9]+'))[1]::int AS outs_on_play_num,
          (regexp_match(COALESCE(to_jsonb(pe)->>'outs', ''), '[-+]?[0-9]+'))[1]::int AS outs_num,
          (regexp_match(COALESCE(platelocside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_side,
          (regexp_match(COALESCE(platelocheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_height,
          (
            COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip', '')), ''), '') <> ''
            OR COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip2', '')), ''), '') <> ''
            OR COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip3', '')), ''), '') <> ''
          ) AS has_video,
          CASE
            WHEN COALESCE(NULLIF(TRIM(pitchcall), ''), '') = 'HitByPitch' OR COALESCE(NULLIF(TRIM(playresult), ''), '') = 'HitByPitch' THEN 'Ball'
            WHEN COALESCE(NULLIF(TRIM(pitchcall), ''), '') = 'StrikeCalled' THEN 'Called Strike'
            WHEN COALESCE(NULLIF(TRIM(pitchcall), ''), '') = 'BallCalled' THEN 'Ball'
            WHEN COALESCE(NULLIF(TRIM(pitchcall), ''), '') IN ('FoulBallNotFieldable','FoulBallFieldable','FoulBall') THEN 'Foul'
            WHEN COALESCE(NULLIF(TRIM(pitchcall), ''), '') = 'StrikeSwinging' THEN 'Whiff'
            WHEN COALESCE(NULLIF(TRIM(pitchcall), ''), '') = 'InPlay' AND COALESCE(NULLIF(TRIM(playresult), ''), '') IN ('Out','FieldersChoice','Sacrifice') THEN 'In Play (Out)'
            WHEN COALESCE(NULLIF(TRIM(pitchcall), ''), '') = 'InPlay' AND COALESCE(NULLIF(TRIM(playresult), ''), '') IN ('Single','Double','Triple','HomeRun') THEN 'In Play (Hit)'
            WHEN COALESCE(NULLIF(TRIM(pitchcall), ''), '') = 'InPlay' AND COALESCE(NULLIF(TRIM(playresult), ''), '') = 'Error' THEN 'Error'
            ELSE NULL
          END AS result_label,
          CASE
            WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'L' THEN TRUE
            ELSE FALSE
          END AS is_lefty,
          (regexp_match(COALESCE(balls::text, ''), '[-+]?[0-9]+'))[1]::int AS balls_num,
          (regexp_match(COALESCE(strikes::text, ''), '[-+]?[0-9]+'))[1]::int AS strikes_num,
          __PREV_BALLS_SQL__,
          __PREV_STRIKES_SQL__,
          __PITCH_NUMBER_SQL__
        FROM public.pitch_events pe
        LEFT JOIN pd_uid_map pd_uid
          ON lower(
               btrim(
                 COALESCE(
                   to_jsonb(pe)->>'pitchuid',
                   to_jsonb(pe)->>'pitch_uid',
                   pe.pitchuid::text,
                   ''
                 )
               )
             ) <> ''
         AND lower(
               btrim(
                 COALESCE(
                   to_jsonb(pe)->>'pitchuid',
                   to_jsonb(pe)->>'pitch_uid',
                   pe.pitchuid::text,
                   ''
                 )
               )
             ) = pd_uid.pitchuid_key
        LEFT JOIN pd_play_map pd_play
          ON lower(
               btrim(
                 COALESCE(
                   to_jsonb(pe)->>'playid',
                   to_jsonb(pe)->>'play_id',
                   pe.playid::text,
                   ''
                 )
               )
             ) <> ''
         AND lower(
               btrim(
                 COALESCE(
                   to_jsonb(pe)->>'playid',
                   to_jsonb(pe)->>'play_id',
                   pe.playid::text,
                   ''
                 )
               )
             ) = pd_play.playid_key
        WHERE school_code = %(school_code)s
          AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
          AND (%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)
          AND (%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)
          AND (
            %(pitchers_count)s::int = 0 OR
            """ + PITCHER_NAME_NORM_SQL + """ = ANY(%(pitchers_norm)s::text[])
          )
          AND (
            %(opp_hitters_count)s::int = 0 OR
            """ + BATTER_NAME_NORM_SQL + """ = ANY(%(opp_hitters_norm)s::text[])
          )
          AND (
            %(session_type_filter)s::text IS NULL OR
            (
              %(session_type_filter)s::text = 'Bullpen' AND
              regexp_replace(lower(COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), '')), '\\s+', '', 'g') ~ '(bull|prac|bp)'
            ) OR
            (
              %(session_type_filter)s::text = 'Season' AND (
                (
                  """ + PITCHER_TEAM_IS_MARKER_SQL + """ AND
                  """ + BATTER_TEAM_NORM_SQL + """ <> '' AND
                  NOT (""" + BATTER_TEAM_IS_MARKER_SQL + """)
                )
                OR
                (
                  """ + BATTER_TEAM_IS_MARKER_SQL + """ AND
                  """ + PITCHER_TEAM_NORM_SQL + """ <> '' AND
                  NOT (""" + PITCHER_TEAM_IS_MARKER_SQL + """)
                )
              )
            ) OR
            (
              %(session_type_filter)s::text = 'Live' AND (
                """ + PITCHER_TEAM_IS_MARKER_SQL + """ AND
                """ + BATTER_TEAM_NORM_SQL + """ <> '' AND
                (""" + BATTER_TEAM_IS_MARKER_SQL + """)
              )
            )
          )
          AND (
            %(team_type)s::text IS NULL OR %(team_type)s::text = '' OR %(team_type)s::text = 'All' OR
            (
              UPPER(COALESCE(%(school_code)s::text, '')) = 'LEAGUE'
              AND %(team_type_norm)s::text <> ''
              AND """ + PITCHER_TEAM_NORM_SQL + """ = %(team_type_norm)s::text
            )
            OR
            (
              %(team_type)s::text = %(school_code)s::text AND (
                """ + PITCHING_TEAM_MATCH_SQL + """
              )
            )
            OR
            (
              %(team_type)s::text = 'Campers' AND
              %(campers_norm_count)s::int > 0 AND
              """ + PITCHER_NAME_NORM_SQL + """ = ANY(%(campers_norm)s::text[]) AND
              """ + PITCHING_TEAM_MATCH_SQL + """
            )
            OR
            (
              %(team_type)s::text = 'Opponents' AND (
                """ + PITCHING_OPPONENT_MATCH_SQL + """
              )
            )
            OR
            (
              UPPER(COALESCE(%(school_code)s::text, '')) <> 'LEAGUE' AND
              %(team_type)s::text NOT IN ('Opponents', 'Campers', %(school_code)s::text) AND
              (""" + TEAM_BUCKET_SQL + """) = %(team_type)s::text
            )
          )
      ),
      base AS (
        SELECT
          br.*,
          vmw.video_clip_1 AS video_clip_1_vm,
          vmw.video_clip_2 AS video_clip_2_vm,
          vmw.video_clip_3 AS video_clip_3_vm
        FROM base_raw br
        __VIDEO_MAP_JOIN__
        WHERE br.pitch_type <> 'Undefined'
          AND (
            %(with_video)s::text IS NULL OR %(with_video)s::text = '' OR %(with_video)s::text = 'All' OR
            (%(with_video)s::text = 'Yes' AND __HAS_VIDEO_EXPR__) OR
            (%(with_video)s::text = 'No' AND NOT (__HAS_VIDEO_EXPR__))
          )
          AND (
            %(hand)s::text IS NULL OR %(hand)s::text = '' OR %(hand)s::text = 'All' OR
            (%(hand)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'L') OR
            (%(hand)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'R')
          )
          AND (
            %(batter_side)s::text IS NULL OR %(batter_side)s::text = '' OR %(batter_side)s::text = 'All' OR
            (%(batter_side)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'L') OR
            (%(batter_side)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'R')
          )
          AND (
            %(pitch_types_count)s::int = 0 OR
            pitch_type = ANY(%(pitch_types)s::text[])
          )
          AND (
            %(zone_locations_count)s::int = 0 OR
            NOT EXISTS (
              SELECT 1
              FROM unnest(%(zone_locations)s::text[]) AS zl(tok)
              WHERE NOT (
                CASE zl.tok
                  WHEN 'Upper Half' THEN plate_height >= %(zone_mid_y)s
                  WHEN 'Bottom Half' THEN plate_height <= %(zone_mid_y)s
                  WHEN 'Glove Side Half' THEN CASE WHEN is_lefty THEN plate_side >= %(zone_mid_x)s ELSE plate_side <= %(zone_mid_x)s END
                  WHEN 'Arm Side Half' THEN CASE WHEN is_lefty THEN plate_side <= %(zone_mid_x)s ELSE plate_side >= %(zone_mid_x)s END
                  WHEN 'Upper 3rd' THEN plate_height >= (%(zone_bottom)s + (2 * %(zone_dy)s))
                  WHEN 'Bottom 3rd' THEN plate_height <= (%(zone_bottom)s + %(zone_dy)s)
                  WHEN 'Glove Side 3rd' THEN CASE WHEN is_lefty THEN plate_side >= (%(zone_left)s + (2 * %(zone_dx)s)) ELSE plate_side <= (%(zone_left)s + %(zone_dx)s) END
                  WHEN 'Arm Side 3rd' THEN CASE WHEN is_lefty THEN plate_side <= (%(zone_left)s + %(zone_dx)s) ELSE plate_side >= (%(zone_left)s + (2 * %(zone_dx)s)) END
                  ELSE TRUE
                END
              )
            )
          )
          AND (
            %(in_zone_filters_count)s::int = 0 OR
            EXISTS (
              SELECT 1
              FROM unnest(%(in_zone_filters)s::text[]) AS iz(tok)
              WHERE (
                (iz.tok = 'Yes' AND plate_side BETWEEN %(zone_left)s AND %(zone_right)s AND plate_height BETWEEN %(zone_bottom)s AND %(zone_top)s) OR
                (iz.tok = 'No' AND NOT (plate_side BETWEEN %(zone_left)s AND %(zone_right)s AND plate_height BETWEEN %(zone_bottom)s AND %(zone_top)s)) OR
                (iz.tok = 'Competitive' AND plate_side BETWEEN -1.5 AND 1.5 AND plate_height BETWEEN (%(zone_mid_y)s - 1.5) AND (%(zone_mid_y)s + 1.5))
              )
            )
          )
          AND (
            %(qp_locations)s::text IS NULL OR %(qp_locations)s::text = '' OR %(qp_locations)s::text = 'All' OR
            (%(qp_locations)s::text = 'Yes' AND plate_side BETWEEN -1.5 AND 1.5 AND plate_height BETWEEN (%(zone_mid_y)s - 1.5) AND (%(zone_mid_y)s + 1.5)) OR
            (%(qp_locations)s::text = 'No' AND NOT (plate_side BETWEEN -1.5 AND 1.5 AND plate_height BETWEEN (%(zone_mid_y)s - 1.5) AND (%(zone_mid_y)s + 1.5)))
          )
          AND (
            %(pitch_results_count)s::int = 0 OR
            EXISTS (
              SELECT 1
              FROM unnest(%(pitch_results)s::text[]) AS pr(tok)
              WHERE (
                pr.tok = result_label OR
                (pr.tok = 'In Play (Hit)' AND play_result IN ('Single','Double','Triple','HomeRun')) OR
                (pr.tok IN ('Single','Double','Triple','HomeRun','Error') AND play_result = pr.tok)
              )
            )
          )
          AND (
            %(count_filter_count)s::int = 0 OR
            EXISTS (
              SELECT 1
              FROM unnest(%(count_filter)s::text[]) AS cf(tok)
              WHERE (
                (cf.tok = 'Even' AND (balls_num, strikes_num) IN ((0,0),(1,1),(2,2),(3,2))) OR
                (cf.tok = 'Behind' AND (balls_num, strikes_num) IN ((1,0),(2,0),(3,0),(3,1),(2,1))) OR
                (cf.tok = 'Ahead' AND (balls_num, strikes_num) IN ((0,1),(0,2),(1,2))) OR
                (cf.tok = '2KNF' AND (balls_num, strikes_num) IN ((0,2),(1,2),(2,2))) OR
                (cf.tok ~ '^\\d-\\d$' AND balls_num = split_part(cf.tok, '-', 1)::int AND strikes_num = split_part(cf.tok, '-', 2)::int)
              )
            )
          )
          AND (
            %(after_count_filter_count)s::int = 0 OR
            EXISTS (
              SELECT 1
              FROM unnest(%(after_count_filter)s::text[]) AS ac(tok)
              WHERE (
                (ac.tok = 'Even' AND (prev_balls, prev_strikes) IN ((0,0),(1,1),(2,2),(3,2))) OR
                (ac.tok = 'Behind' AND (prev_balls, prev_strikes) IN ((1,0),(2,0),(3,0),(3,1),(2,1))) OR
                (ac.tok = 'Ahead' AND (prev_balls, prev_strikes) IN ((0,1),(0,2),(1,2))) OR
                (ac.tok = '2KNF' AND (prev_balls, prev_strikes) IN ((0,2),(1,2),(2,2))) OR
                (ac.tok ~ '^\\d-\\d$' AND prev_balls = split_part(ac.tok, '-', 1)::int AND prev_strikes = split_part(ac.tok, '-', 2)::int)
              )
            )
          )
          AND (%(velo_min)s::double precision IS NULL OR rel_speed >= %(velo_min)s::double precision)
          AND (%(velo_max)s::double precision IS NULL OR rel_speed <= %(velo_max)s::double precision)
          AND (%(ivb_min)s::double precision IS NULL OR ivb >= %(ivb_min)s::double precision)
          AND (%(ivb_max)s::double precision IS NULL OR ivb <= %(ivb_max)s::double precision)
          AND (%(hb_min)s::double precision IS NULL OR hb >= %(hb_min)s::double precision)
          AND (%(hb_max)s::double precision IS NULL OR hb <= %(hb_max)s::double precision)
          AND (%(pc_min)s::int IS NULL OR pitch_number >= %(pc_min)s::int)
          AND (%(pc_max)s::int IS NULL OR pitch_number <= %(pc_max)s::int)
      )
    """

    try:
        with get_conn() as conn, conn.cursor() as cur:
            video_map_table = None
            table_candidates = [f"public.video_map_{school_code.lower()}", "public.video_map"]
            for candidate in table_candidates:
                cur.execute("SELECT to_regclass(%(tbl)s)::text AS reg", {"tbl": candidate})
                reg = (cur.fetchone() or {}).get("reg")
                if reg:
                    video_map_table = str(reg)
                    break

            if video_map_table:
                video_map_cte = f"""
      vm_wide AS (
        SELECT
          lower(trim(play_id)) AS play_id_lc,
          MAX(cloudinary_url) FILTER (WHERE camera_slot = 'VideoClip') AS video_clip_1,
          MAX(cloudinary_url) FILTER (WHERE camera_slot = 'VideoClip2') AS video_clip_2,
          MAX(cloudinary_url) FILTER (WHERE camera_slot = 'VideoClip3') AS video_clip_3
        FROM {video_map_table}
        WHERE
          play_id IS NOT NULL
          AND trim(play_id) <> ''
          AND cloudinary_url IS NOT NULL
          AND trim(cloudinary_url) <> ''
          AND upper(coalesce(nullif(trim(school_code), ''), %(school_code)s)) = %(school_code)s
          AND camera_slot IN ('VideoClip', 'VideoClip2', 'VideoClip3')
        GROUP BY lower(trim(play_id))
      ),
"""
                video_map_join = "LEFT JOIN vm_wide vmw ON lower(br.play_id) = vmw.play_id_lc"
                has_video_expr = """
                  (
                    COALESCE(vmw.video_clip_1, br.video_clip_1, '') <> ''
                    OR COALESCE(vmw.video_clip_2, br.video_clip_2, '') <> ''
                    OR COALESCE(vmw.video_clip_3, br.video_clip_3, '') <> ''
                  )
                """
            else:
                video_map_cte = ""
                video_map_join = "LEFT JOIN (SELECT NULL::text AS play_id_lc, NULL::text AS video_clip_1, NULL::text AS video_clip_2, NULL::text AS video_clip_3) vmw ON false"
                has_video_expr = """
                  (
                    COALESCE(br.video_clip_1, '') <> ''
                    OR COALESCE(br.video_clip_2, '') <> ''
                    OR COALESCE(br.video_clip_3, '') <> ''
                  )
                """

            prev_balls_sql = (
                "LAG((regexp_match(COALESCE(balls::text, ''), '[-+]?[0-9]+'))[1]::int) OVER (ORDER BY COALESCE(created_at, NOW()), id) AS prev_balls"
                if need_prev_counts
                else "NULL::int AS prev_balls"
            )
            prev_strikes_sql = (
                "LAG((regexp_match(COALESCE(strikes::text, ''), '[-+]?[0-9]+'))[1]::int) OVER (ORDER BY COALESCE(created_at, NOW()), id) AS prev_strikes"
                if need_prev_counts
                else "NULL::int AS prev_strikes"
            )
            pitch_number_sql = (
                "ROW_NUMBER() OVER (ORDER BY session_date, COALESCE(created_at, NOW()), id) AS pitch_number"
                if need_pitch_number
                else "NULL::int AS pitch_number"
            )
            query_resolved = (
                query.replace("__VIDEO_MAP_CTE__", video_map_cte)
                .replace("__VIDEO_MAP_JOIN__", video_map_join)
                .replace("__HAS_VIDEO_EXPR__", has_video_expr)
                .replace("__PREV_BALLS_SQL__", prev_balls_sql)
                .replace("__PREV_STRIKES_SQL__", prev_strikes_sql)
                .replace("__PITCH_NUMBER_SQL__", pitch_number_sql)
            )

            cur.execute(
                query_resolved
                + """
                SELECT
                  id,
                  session_date,
                  pitch_no,
                  pitch_uid,
                  play_id,
                  game_id,
                  game_uid,
                  game_foreign_id,
                  inning,
                  pitch_number,
                  pitcher,
                  pitch_type,
                  COALESCE(video_clip_1_vm, video_clip_1) AS video_clip_1,
                  COALESCE(video_clip_2_vm, video_clip_2) AS video_clip_2,
                  COALESCE(video_clip_3_vm, video_clip_3) AS video_clip_3,
                  rel_speed,
                  ivb,
                  hb,
                  release_tilt,
                  break_tilt,
                  spin_eff,
                  spin_rate,
                  exit_speed,
                  angle,
                  rel_height,
                  rel_side,
                  vaa,
                  haa,
                  ext_value,
                  pitch_call,
                  korbb,
                  play_result,
                  tagged_hit_type,
                  outs_on_play_num,
                  outs_num,
                  plate_side,
                  plate_height,
                  is_lefty,
                  balls_num,
                  strikes_num,
                  prev_balls,
                  prev_strikes,
                  batterside,
                  pitcherthrows,
                  batter,
                  catcher
                  , pitcher_team_code
                  , batter_team_code
                  , pitcher_team_norm
                  , batter_team_norm_eff
                  , session_type_norm
                FROM base
                """,
                params,
            )
            table_source_rows = [row for row in cur.fetchall() if str(row.get("pitch_type") or "") != "Undefined"]
            _annotate_times_through_order(table_source_rows)
            team_type_value = (team_type or "").strip() or "All"
            table_source_rows = _filter_pitching_rows_by_team_type(
                [dict(row) for row in table_source_rows],
                team_type_value=team_type_value,
                school_code=school_code,
                team_pitcher_norm=set(team_norm or []),
                campers_norm=set(campers_norm or []),
                team_markers_norm=set(team_markers_norm or []),
            )

            # Recompute aggregate/summary metrics from the post-filtered rows so team_type behavior
            # is always exact, even if SQL team bucketing and route params diverge.
            total_pitches = len(table_source_rows)
            rel_speeds = [float(r["rel_speed"]) for r in table_source_rows if _is_num(r.get("rel_speed"))]
            spins = [float(r["spin_rate"]) for r in table_source_rows if _is_num(r.get("spin_rate"))]
            ivbs = [float(r["ivb"]) for r in table_source_rows if _is_num(r.get("ivb"))]
            hbs = [float(r["hb"]) for r in table_source_rows if _is_num(r.get("hb"))]

            zone_hits = [
                1.0
                for r in table_source_rows
                if _is_num(r.get("plate_side"))
                and _is_num(r.get("plate_height"))
                and float(r["plate_side"]) >= ZONE_LEFT
                and float(r["plate_side"]) <= ZONE_RIGHT
                and float(r["plate_height"]) >= ZONE_BOTTOM
                and float(r["plate_height"]) <= ZONE_TOP
            ]
            strike_hits = [
                1.0
                for r in table_source_rows
                if str(r.get("pitch_call") or "")
                in {"StrikeCalled", "StrikeSwinging", "FoulBall", "FoulBallFieldable", "InPlay"}
            ]
            whiff_values = []
            for r in table_source_rows:
                pc = str(r.get("pitch_call") or "")
                if pc == "StrikeSwinging":
                    whiff_values.append(1.0)
                elif pc in {"InPlay", "FoulBall", "FoulBallFieldable", "StrikeCalled", "BallCalled", "BallinDirt", "HitByPitch"}:
                    whiff_values.append(0.0)

            overview = {
                "total_pitches": total_pitches,
                "avg_velo": (sum(rel_speeds) / len(rel_speeds)) if rel_speeds else None,
                "max_velo": max(rel_speeds) if rel_speeds else None,
                "avg_spin": (sum(spins) / len(spins)) if spins else None,
                "avg_ivb": (sum(ivbs) / len(ivbs)) if ivbs else None,
                "avg_hb": (sum(hbs) / len(hbs)) if hbs else None,
                "zone_pct": (sum(zone_hits) / total_pitches) if total_pitches else None,
                "strike_pct": (sum(strike_hits) / total_pitches) if total_pitches else None,
                "whiff_pct": (sum(whiff_values) / len(whiff_values)) if whiff_values else None,
            }

            pitch_type_counts: Dict[str, Dict[str, Any]] = {}
            for r in table_source_rows:
                pitch_type = str(r.get("pitch_type") or "Undefined")
                bucket = pitch_type_counts.setdefault(
                    pitch_type,
                    {
                        "pitch_type": pitch_type,
                        "pitches": 0,
                        "usage_pct": 0.0,
                        "avg_velo_vals": [],
                        "max_velo_vals": [],
                        "avg_spin_vals": [],
                        "avg_ivb_vals": [],
                        "avg_hb_vals": [],
                    },
                )
                bucket["pitches"] += 1
                if _is_num(r.get("rel_speed")):
                    bucket["avg_velo_vals"].append(float(r["rel_speed"]))
                    bucket["max_velo_vals"].append(float(r["rel_speed"]))
                if _is_num(r.get("spin_rate")):
                    bucket["avg_spin_vals"].append(float(r["spin_rate"]))
                if _is_num(r.get("ivb")):
                    bucket["avg_ivb_vals"].append(float(r["ivb"]))
                if _is_num(r.get("hb")):
                    bucket["avg_hb_vals"].append(float(r["hb"]))

            raw_pitch_type_rows = []
            pitch_order = {
                "Fastball": 1,
                "Sinker": 2,
                "Cutter": 3,
                "Slider": 4,
                "Sweeper": 5,
                "Curveball": 6,
                "ChangeUp": 7,
                "Splitter": 8,
                "Knuckleball": 9,
                "Undefined": 10,
            }
            for pitch_type, bucket in pitch_type_counts.items():
                pitches = int(bucket["pitches"])
                raw_pitch_type_rows.append(
                    {
                        "pitch_type": pitch_type,
                        "pitches": pitches,
                        "usage_pct": (100.0 * pitches / total_pitches) if total_pitches else 0.0,
                        "avg_velo": (sum(bucket["avg_velo_vals"]) / len(bucket["avg_velo_vals"])) if bucket["avg_velo_vals"] else None,
                        "max_velo": max(bucket["max_velo_vals"]) if bucket["max_velo_vals"] else None,
                        "avg_spin": (sum(bucket["avg_spin_vals"]) / len(bucket["avg_spin_vals"])) if bucket["avg_spin_vals"] else None,
                        "avg_ivb": (sum(bucket["avg_ivb_vals"]) / len(bucket["avg_ivb_vals"])) if bucket["avg_ivb_vals"] else None,
                        "avg_hb": (sum(bucket["avg_hb_vals"]) / len(bucket["avg_hb_vals"])) if bucket["avg_hb_vals"] else None,
                    }
                )
            raw_pitch_type_rows.sort(key=lambda r: (pitch_order.get(str(r.get("pitch_type") or ""), 99), str(r.get("pitch_type") or "")))

            stuff_rows = [
                {
                    "id": r.get("id"),
                    "session_date": r.get("session_date"),
                    "pitch_no": r.get("pitch_no"),
                    "pitch_uid": r.get("pitch_uid"),
                    "play_id": r.get("play_id"),
                    "pitch_number": r.get("pitch_number"),
                    "pitcher": r.get("pitcher"),
                    "pitch_type": r.get("pitch_type"),
                    "rel_speed": r.get("rel_speed"),
                    "ivb": r.get("ivb"),
                    "hb": r.get("hb"),
                    "rel_height": r.get("rel_height"),
                    "ext_value": r.get("ext_value"),
                    "is_lefty": r.get("is_lefty"),
                    "hb_adj": r.get("hb") if bool(r.get("is_lefty")) else (-float(r["hb"]) if _is_num(r.get("hb")) else None),
                }
                for r in table_source_rows
            ]
            avg_stuff, avg_stuff_by_pitch_type = _compute_stuff_by_pitch_type(
                stuff_rows, stuff_base or "Fastball", stuff_level or "College"
            )
            table_columns, table_rows, available_table_columns = _build_dynamic_table(
                table_source_rows,
                table_mode,
                split_by,
                avg_stuff_by_pitch_type,
                selected_custom_columns,
            )
            pitch_type_rows = [
                PitchTypeSummaryRow(
                    **row,
                    avg_stuff=avg_stuff_by_pitch_type.get(str(row.get("pitch_type") or "")),
                )
                for row in raw_pitch_type_rows
            ]
            chart_points = (
                _build_chart_points(
                    (
                        _latest_rows_for_chart_points(table_source_rows, parsed_chart_points_limit)
                        if (school_code == "LEAGUE" and parsed_chart_points_limit is not None)
                        else _downsample_rows_for_chart_points(table_source_rows)
                    ),
                    avg_stuff_by_pitch_type,
                )
                if include_chart_points
                else []
            )
            row_pitches_by_key = (
                _build_row_pitch_map(table_source_rows, split_by, avg_stuff_by_pitch_type)
                if include_row_pitches
                else {}
            )
            trend_rows = (
                _build_trend_rows(
                    table_source_rows,
                    avg_stuff_by_pitch_type,
                    use_osu_date_session_rules=use_osu_date_session_rules,
                )
                if include_trend_rows
                else []
            )

        response_payload = PitchingOverviewResponse(
            school_code=school_code,
            pitcher=selected_pitchers[0] if len(selected_pitchers) == 1 else None,
            team_type=team_type,
            opp_hitter=selected_opp_hitters[0] if len(selected_opp_hitters) == 1 else None,
            with_video=with_video,
            break_lines=break_lines,
            stuff_level=stuff_level,
            stuff_base=stuff_base,
            hand=hand,
            batter_side=batter_side,
            in_zone=selected_in_zone[0] if len(selected_in_zone) == 1 else None,
            qp_locations=qp_locations,
            session_type=(session_type_filter if session_type_filter != "Live" else "Live BP"),
            table_mode=table_mode,
            split_by=split_by,
            selected_zone_locations=selected_zone_locations,
            selected_pitch_types=selected_pitch_types,
            selected_pitch_results=selected_pitch_results,
            selected_count_filters=selected_count_filters,
            selected_after_count_filters=selected_after_count_filters,
            start_date=start_date.isoformat() if start_date else None,
            end_date=end_date.isoformat() if end_date else None,
            total_pitches=int(overview.get("total_pitches") or 0),
            avg_velo=overview.get("avg_velo"),
            max_velo=overview.get("max_velo"),
            avg_spin=overview.get("avg_spin"),
            avg_ivb=overview.get("avg_ivb"),
            avg_hb=overview.get("avg_hb"),
            avg_stuff=avg_stuff,
            zone_pct=(float(overview.get("zone_pct")) * 100.0) if overview.get("zone_pct") is not None else None,
            strike_pct=(float(overview.get("strike_pct")) * 100.0) if overview.get("strike_pct") is not None else None,
            whiff_pct=(float(overview.get("whiff_pct")) * 100.0) if overview.get("whiff_pct") is not None else None,
            table_columns=table_columns,
            available_table_columns=available_table_columns,
            table_rows=table_rows,
            row_pitches_by_key=row_pitches_by_key,
            pitch_types=pitch_type_rows,
            chart_points=chart_points,
            trend_rows=trend_rows,
        )
        _overview_cache_set(overview_cache_key, response_payload)
        return response_payload
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"overview query failed: {exc}") from exc


@app.get("/v1/pitching/ab-report", response_model=PitchingAbReportResponse)
def pitching_ab_report(
    school_code: str = Query(..., min_length=1),
    pitcher: str = Query(..., min_length=1),
    game_date: Optional[date] = Query(default=None),
    game_key: Optional[str] = Query(default=None),
    opp_hitter: Optional[str] = Query(default=None),
    hand: Optional[str] = Query(default=None),
    batter_side: Optional[str] = Query(default=None),
    session_type: Optional[str] = Query(default=None),
    pitch_types: Optional[str] = Query(default=None),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
) -> PitchingAbReportResponse:
    school_code = _validate_school_code(school_code)
    _sync_modifications_into_pitch_events(school_code)
    roster = _load_school_roster(school_code)
    team_markers_norm = sorted(set(roster.get("team_markers_norm", []) or []))
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date.")

    selected_pitchers = _parse_name_list(pitcher)
    selected_pitcher_keys = _name_filter_keys(selected_pitchers)
    if len(selected_pitchers) != 1:
        raise HTTPException(status_code=400, detail="Select exactly one pitcher for AB Report.")

    selected_opp_hitters = _parse_name_list(opp_hitter)
    selected_opp_hitter_keys = _name_filter_keys(selected_opp_hitters)
    hand = (hand or "").strip() or None
    batter_side = (batter_side or "").strip() or None
    session_type_filter = _normalize_session_type_filter(session_type)
    use_osu_date_session_rules = school_code.upper() == "OSU"
    selected_pitch_types = _valid_pitch_types(_parse_csv_list(pitch_types))
    game_key = (game_key or "").strip() or None

    params = {
        "school_code": school_code,
        "pitchers_norm": selected_pitcher_keys,
        "pitchers_count": len(selected_pitcher_keys),
        "opp_hitters_norm": selected_opp_hitter_keys,
        "opp_hitters_count": len(selected_opp_hitter_keys),
        "hand": hand,
        "batter_side": batter_side,
        "session_type_filter": session_type_filter,
        "use_osu_date_session_rules": use_osu_date_session_rules,
        "osu_season_start": OSU_SEASON_START,
        "osu_season_end": OSU_SEASON_END,
        "pitch_types": selected_pitch_types,
        "pitch_types_count": len(selected_pitch_types),
        "start_date": start_date,
        "end_date": end_date,
        "team_markers_norm": team_markers_norm,
    }

    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                WITH base AS (
                  SELECT
                    id,
                    session_date,
                    COALESCE(
                      NULLIF(TRIM(pitcher), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'Pitcher', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'pitcher_name', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'PitcherName', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'athlete_name', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'AthleteName', '')), ''),
                      'Unknown Pitcher'
                    ) AS pitcher,
                    COALESCE(NULLIF(TRIM(batter), ''), '') AS batter,
                    COALESCE(NULLIF(TRIM(catcher), ''), '') AS catcher,
                    COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), 'Unknown') AS session_type_norm,
                    """ + PITCH_TYPE_NORMALIZE_SQL + """ AS pitch_type,
                    COALESCE(NULLIF(TRIM(pitchcall), ''), '') AS pitch_call,
                    COALESCE(NULLIF(TRIM(korbb), ''), '') AS korbb,
                    COALESCE(NULLIF(TRIM(playresult), ''), '') AS play_result,
                    COALESCE(NULLIF(TRIM(taggedhittype), ''), '') AS tagged_hit_type,
                    (regexp_match(COALESCE(to_jsonb(pe)->>'pitchid', to_jsonb(pe)->>'pitchno', ''), '[-+]?[0-9]+'))[1]::int AS pitch_no,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'pitchuid', to_jsonb(pe)->>'pitch_uid', '')), ''), '') AS pitch_uid,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', '')), ''), '') AS play_id,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameid', to_jsonb(pe)->>'GameID', '')), ''), '') AS game_id,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameuid', to_jsonb(pe)->>'GameUID', '')), ''), '') AS game_uid,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameforeignid', to_jsonb(pe)->>'GameForeignID', '')), ''), '') AS game_foreign_id,
                    (regexp_match(COALESCE(relspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_speed,
                    (regexp_match(COALESCE(spinrate, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_rate,
                    COALESCE(NULLIF(TRIM(releasetilt), ''), '') AS release_tilt,
                    COALESCE(NULLIF(TRIM(breaktilt), ''), '') AS break_tilt,
                    (regexp_match(COALESCE(spinefficiency, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_eff,
                    (regexp_match(COALESCE(exitspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS exit_speed,
                    (regexp_match(COALESCE(angle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS angle,
                    (regexp_match(COALESCE(distance, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS distance,
                    (regexp_match(COALESCE(inducedvertbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ivb,
                    (regexp_match(COALESCE(horzbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS hb,
                    (regexp_match(COALESCE(relheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_height,
                    (regexp_match(COALESCE(relside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_side,
                    (regexp_match(COALESCE(extension, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ext_value,
                    (regexp_match(COALESCE(outsonplay::text, ''), '[-+]?[0-9]+'))[1]::int AS outs_on_play_num,
                    (regexp_match(COALESCE(to_jsonb(pe)->>'outs', ''), '[-+]?[0-9]+'))[1]::int AS outs_num,
                    (regexp_match(COALESCE(platelocside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_side,
                    (regexp_match(COALESCE(platelocheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_height,
                    (regexp_match(COALESCE(balls::text, ''), '[-+]?[0-9]+'))[1]::int AS balls_num,
                    (regexp_match(COALESCE(strikes::text, ''), '[-+]?[0-9]+'))[1]::int AS strikes_num,
                    UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'L' AS is_lefty,
                    pitcherthrows,
                    batterside,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip', '')), ''), '') AS video_clip_1,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip2', '')), ''), '') AS video_clip_2,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip3', '')), ''), '') AS video_clip_3,
                    ROW_NUMBER() OVER (ORDER BY session_date, COALESCE(created_at, NOW()), id) AS pitch_number
                  FROM public.pitch_events pe
                  WHERE school_code = %(school_code)s
                    AND (""" + PITCH_TYPE_NORMALIZE_SQL + """) <> 'Undefined'
                    AND (%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)
                    AND (%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)
                    AND (
                      %(pitchers_count)s::int = 0 OR
                      """ + PITCHER_NAME_NORM_SQL + """ = ANY(%(pitchers_norm)s::text[])
                    )
                    AND (
                      %(opp_hitters_count)s::int = 0 OR
                      """ + BATTER_NAME_NORM_SQL + """ = ANY(%(opp_hitters_norm)s::text[])
                    )
                    AND (
                      %(hand)s::text IS NULL OR %(hand)s::text = '' OR %(hand)s::text = 'All' OR
                      (%(hand)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'L') OR
                      (%(hand)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'R')
                    )
                    AND (
                      %(batter_side)s::text IS NULL OR %(batter_side)s::text = '' OR %(batter_side)s::text = 'All' OR
                      (%(batter_side)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'L') OR
                      (%(batter_side)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'R')
                    )
                    AND (
                      %(pitch_types_count)s::int = 0 OR
                      (""" + PITCH_TYPE_NORMALIZE_SQL + """) = ANY(%(pitch_types)s::text[])
                    )
                    AND (
                      %(session_type_filter)s::text IS NULL OR
                      (
                        %(session_type_filter)s::text = 'Bullpen' AND
                        regexp_replace(lower(COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), '')), '\\s+', '', 'g') ~ '(bull|prac|bp)'
                      ) OR
                      (
                        %(session_type_filter)s::text = 'Live' AND (
                          """ + PITCHER_TEAM_IS_MARKER_SQL + """ AND
                          """ + BATTER_TEAM_NORM_SQL + """ <> '' AND
                          (""" + BATTER_TEAM_IS_MARKER_SQL + """)
                        )
                      ) OR
                      (
                        %(session_type_filter)s::text = 'Season' AND (
                          (
                            """ + PITCHER_TEAM_IS_MARKER_SQL + """ AND
                            """ + BATTER_TEAM_NORM_SQL + """ <> '' AND
                            NOT (""" + BATTER_TEAM_IS_MARKER_SQL + """)
                          )
                          OR
                          (
                            """ + BATTER_TEAM_IS_MARKER_SQL + """ AND
                            """ + PITCHER_TEAM_NORM_SQL + """ <> '' AND
                            NOT (""" + PITCHER_TEAM_IS_MARKER_SQL + """)
                          )
                        )
                      )
                    )
                )
                SELECT * FROM base
                ORDER BY session_date, pitch_number, id
                """,
                params,
            )
            rows = cur.fetchall()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"ab report query failed: {exc}") from exc

    if not rows:
        return PitchingAbReportResponse(
            school_code=school_code,
            pitcher=selected_pitchers[0] if selected_pitchers else "",
            selected_game_key=game_key,
            selected_game_date=game_date.isoformat() if game_date else None,
            available_games=[],
            pitch_type_legend=[],
            pa_groups=[],
            total_pa=0,
        )

    # Compute stuff+ lookup for payload compatibility with modal.
    stuff_rows = []
    for row in rows:
        r = dict(row)
        hb_value = r.get("hb")
        is_lefty = bool(r.get("is_lefty"))
        r["hb_adj"] = hb_value if is_lefty else (-hb_value if _is_num(hb_value) else None)
        stuff_rows.append(r)
    _, avg_stuff_by_pitch_type = _compute_stuff_by_pitch_type(stuff_rows, "Fastball", "College")

    def _row_game_key(row: Dict[str, Any]) -> Optional[str]:
        for field in ("game_id", "game_uid", "game_foreign_id"):
            value = str(row.get(field) or "").strip()
            if value:
                return value
        session_dt = row.get("session_date")
        return session_dt.isoformat() if session_dt else None

    game_meta: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key = _row_game_key(dict(row))
        if not key:
            continue
        session_dt = row.get("session_date")
        current = game_meta.get(key)
        if current is None:
            game_meta[key] = {"date": session_dt}
        elif session_dt and (current.get("date") is None or session_dt > current.get("date")):
            current["date"] = session_dt

    sorted_games = sorted(
        game_meta.items(),
        key=lambda item: (
            item[1].get("date") or date.min,
            item[0],
        ),
    )
    available_games = [
        {
            "game_key": key,
            "date": meta["date"].isoformat() if meta.get("date") else "",
            "label": (
                f"{(meta['date'].month if meta.get('date') else '')}/"
                f"{(meta['date'].day if meta.get('date') else '')}/"
                f"{(str(meta['date'].year)[-2:] if meta.get('date') else '')} | {key}"
            ) if meta.get("date") else key,
        }
        for key, meta in sorted_games
    ]

    selected_game_key = game_key
    if game_date and not selected_game_key:
        date_iso = game_date.isoformat()
        date_matches = [entry["game_key"] for entry in available_games if entry.get("date") == date_iso]
        if date_matches:
            selected_game_key = date_matches[-1]
    if not selected_game_key and available_games:
        selected_game_key = available_games[-1]["game_key"]
    if selected_game_key and available_games and selected_game_key not in {entry["game_key"] for entry in available_games}:
        selected_game_key = available_games[-1]["game_key"]

    rows_for_game = []
    selected_game_date = None
    if selected_game_key:
        rows_for_game = [row for row in rows if _row_game_key(dict(row)) == selected_game_key]
        game_entry = next((entry for entry in available_games if entry["game_key"] == selected_game_key), None)
        selected_game_date = game_entry.get("date") if game_entry else None
    elif rows:
        rows_for_game = list(rows)
        dated_rows = [row.get("session_date") for row in rows if row.get("session_date")]
        if dated_rows:
            latest = max(dated_rows)
            selected_game_date = latest.isoformat() if hasattr(latest, "isoformat") else str(latest)
    grouped_pas = _ab_group_rows(rows_for_game)

    batter_sections: Dict[str, List[Dict[str, Any]]] = {}
    pa_counter = 0
    for pa_rows in grouped_pas:
        pa_counter += 1
        last_row = pa_rows[-1]
        batter_name = str(last_row.get("batter") or "Unknown Batter")
        pa_payload = {
            "pa_index": pa_counter,
            "result_label": _ab_pa_result_label(last_row),
            "pitcher_label": str(last_row.get("pitcher") or ""),
            "pitches": [_pitch_action_payload(row, avg_stuff_by_pitch_type) for row in pa_rows],
        }
        batter_sections.setdefault(batter_name, []).append(pa_payload)

    pa_groups = [
        {"batter": batter, "pas": pas}
        for batter, pas in batter_sections.items()
    ]
    pitch_type_legend = sorted({str(row.get("pitch_type") or "Undefined") for row in rows})

    return PitchingAbReportResponse(
        school_code=school_code,
        pitcher=selected_pitchers[0] if selected_pitchers else "",
        selected_game_key=selected_game_key,
        selected_game_date=selected_game_date,
        available_games=available_games,
        pitch_type_legend=pitch_type_legend,
        pa_groups=pa_groups,
        total_pa=pa_counter,
    )


@app.get("/v1/hitting/ab-report", response_model=HittingAbReportResponse)
def hitting_ab_report(
    school_code: str = Query(..., min_length=1),
    hitter: str = Query(..., min_length=1),
    game_date: Optional[date] = Query(default=None),
    game_key: Optional[str] = Query(default=None),
    opp_pitcher: Optional[str] = Query(default=None),
    hand: Optional[str] = Query(default=None),
    batter_side: Optional[str] = Query(default=None),
    session_type: Optional[str] = Query(default=None),
    pitch_types: Optional[str] = Query(default=None),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
) -> HittingAbReportResponse:
    school_code = _validate_school_code(school_code)
    roster = _load_school_roster(school_code)
    team_markers_norm = sorted(set(roster.get("team_markers_norm", []) or []))
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date.")

    selected_hitters = _parse_name_list(hitter)
    selected_hitter_keys = _name_filter_keys(selected_hitters)
    if len(selected_hitters) != 1:
        raise HTTPException(status_code=400, detail="Select exactly one hitter for AB Report.")

    selected_opp_pitchers = _parse_name_list(opp_pitcher)
    selected_opp_pitcher_keys = _name_filter_keys(selected_opp_pitchers)
    hand = (hand or "").strip() or None
    batter_side = (batter_side or "").strip() or None
    session_type_filter = _normalize_session_type_filter(session_type)
    use_osu_date_session_rules = school_code.upper() == "OSU"
    selected_pitch_types = _valid_pitch_types(_parse_csv_list(pitch_types))
    game_key = (game_key or "").strip() or None

    params = {
        "school_code": school_code,
        "hitters_norm": selected_hitter_keys,
        "hitters_count": len(selected_hitter_keys),
        "opp_pitchers_norm": selected_opp_pitcher_keys,
        "opp_pitchers_count": len(selected_opp_pitcher_keys),
        "hand": hand,
        "batter_side": batter_side,
        "session_type_filter": session_type_filter,
        "use_osu_date_session_rules": use_osu_date_session_rules,
        "osu_season_start": OSU_SEASON_START,
        "osu_season_end": OSU_SEASON_END,
        "pitch_types": selected_pitch_types,
        "pitch_types_count": len(selected_pitch_types),
        "start_date": start_date,
        "end_date": end_date,
        "team_markers_norm": team_markers_norm,
    }

    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                WITH base AS (
                  SELECT
                    id,
                    session_date,
                    COALESCE(
                      NULLIF(TRIM(pitcher), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'Pitcher', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'pitcher_name', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'PitcherName', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'athlete_name', '')), ''),
                      NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'AthleteName', '')), ''),
                      'Unknown Pitcher'
                    ) AS pitcher,
                    COALESCE(NULLIF(TRIM(batter), ''), '') AS batter,
                    COALESCE(NULLIF(TRIM(catcher), ''), '') AS catcher,
                    COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), 'Unknown') AS session_type_norm,
                    """ + PITCH_TYPE_NORMALIZE_SQL + """ AS pitch_type,
                    COALESCE(NULLIF(TRIM(pitchcall), ''), '') AS pitch_call,
                    COALESCE(NULLIF(TRIM(korbb), ''), '') AS korbb,
                    COALESCE(NULLIF(TRIM(playresult), ''), '') AS play_result,
                    COALESCE(NULLIF(TRIM(taggedhittype), ''), '') AS tagged_hit_type,
                    (regexp_match(COALESCE(to_jsonb(pe)->>'pitchid', to_jsonb(pe)->>'pitchno', ''), '[-+]?[0-9]+'))[1]::int AS pitch_no,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'pitchuid', to_jsonb(pe)->>'pitch_uid', '')), ''), '') AS pitch_uid,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'playid', to_jsonb(pe)->>'play_id', '')), ''), '') AS play_id,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameid', to_jsonb(pe)->>'GameID', '')), ''), '') AS game_id,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameuid', to_jsonb(pe)->>'GameUID', '')), ''), '') AS game_uid,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'gameforeignid', to_jsonb(pe)->>'GameForeignID', '')), ''), '') AS game_foreign_id,
                    (regexp_match(COALESCE(relspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_speed,
                    (regexp_match(COALESCE(spinrate, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_rate,
                    COALESCE(NULLIF(TRIM(releasetilt), ''), '') AS release_tilt,
                    COALESCE(NULLIF(TRIM(breaktilt), ''), '') AS break_tilt,
                    (regexp_match(COALESCE(spinefficiency, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_eff,
                    (regexp_match(COALESCE(exitspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS exit_speed,
                    (regexp_match(COALESCE(angle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS angle,
                    (regexp_match(COALESCE(distance, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS distance,
                    (regexp_match(COALESCE(inducedvertbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ivb,
                    (regexp_match(COALESCE(horzbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS hb,
                    (regexp_match(COALESCE(relheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_height,
                    (regexp_match(COALESCE(relside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_side,
                    (regexp_match(COALESCE(extension, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ext_value,
                    (regexp_match(COALESCE(outsonplay::text, ''), '[-+]?[0-9]+'))[1]::int AS outs_on_play_num,
                    (regexp_match(COALESCE(to_jsonb(pe)->>'outs', ''), '[-+]?[0-9]+'))[1]::int AS outs_num,
                    (regexp_match(COALESCE(platelocside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_side,
                    (regexp_match(COALESCE(platelocheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_height,
                    (regexp_match(COALESCE(balls::text, ''), '[-+]?[0-9]+'))[1]::int AS balls_num,
                    (regexp_match(COALESCE(strikes::text, ''), '[-+]?[0-9]+'))[1]::int AS strikes_num,
                    UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'L' AS is_lefty,
                    pitcherthrows,
                    batterside,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip', '')), ''), '') AS video_clip_1,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip2', '')), ''), '') AS video_clip_2,
                    COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'videoclip3', '')), ''), '') AS video_clip_3,
                    ROW_NUMBER() OVER (ORDER BY session_date, COALESCE(created_at, NOW()), id) AS pitch_number
                  FROM public.pitch_events pe
                  WHERE school_code = %(school_code)s
                    AND (""" + PITCH_TYPE_NORMALIZE_SQL + """) <> 'Undefined'
                    AND (%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)
                    AND (%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)
                    AND (
                      %(hitters_count)s::int = 0 OR
                      """ + BATTER_NAME_NORM_SQL + """ = ANY(%(hitters_norm)s::text[])
                    )
                    AND (
                      %(opp_pitchers_count)s::int = 0 OR
                      """ + PITCHER_NAME_NORM_SQL + """ = ANY(%(opp_pitchers_norm)s::text[])
                    )
                    AND (
                      %(hand)s::text IS NULL OR %(hand)s::text = '' OR %(hand)s::text = 'All' OR
                      (%(hand)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'L') OR
                      (%(hand)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'R')
                    )
                    AND (
                      %(batter_side)s::text IS NULL OR %(batter_side)s::text = '' OR %(batter_side)s::text = 'All' OR
                      (%(batter_side)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'L') OR
                      (%(batter_side)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'R')
                    )
                    AND (
                      %(pitch_types_count)s::int = 0 OR
                      (""" + PITCH_TYPE_NORMALIZE_SQL + """) = ANY(%(pitch_types)s::text[])
                    )
                    AND (
                      %(session_type_filter)s::text IS NULL OR
                      (
                        %(session_type_filter)s::text = 'Bullpen' AND
                        regexp_replace(lower(COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), '')), '\\s+', '', 'g') ~ '(bull|prac|bp)'
                      ) OR
                      (
                        %(session_type_filter)s::text = 'Live' AND (
                          """ + PITCHER_TEAM_IS_MARKER_SQL + """ AND
                          """ + BATTER_TEAM_NORM_SQL + """ <> '' AND
                          (""" + BATTER_TEAM_IS_MARKER_SQL + """)
                        )
                      ) OR
                      (
                        %(session_type_filter)s::text = 'Season' AND (
                          (
                            """ + PITCHER_TEAM_IS_MARKER_SQL + """ AND
                            """ + BATTER_TEAM_NORM_SQL + """ <> '' AND
                            NOT (""" + BATTER_TEAM_IS_MARKER_SQL + """)
                          )
                          OR
                          (
                            """ + BATTER_TEAM_IS_MARKER_SQL + """ AND
                            """ + PITCHER_TEAM_NORM_SQL + """ <> '' AND
                            NOT (""" + PITCHER_TEAM_IS_MARKER_SQL + """)
                          )
                        )
                      )
                    )
                )
                SELECT * FROM base
                ORDER BY session_date, pitch_number, id
                """,
                params,
            )
            rows = cur.fetchall()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"hitting ab report query failed: {exc}") from exc

    if not rows:
        return HittingAbReportResponse(
            school_code=school_code,
            hitter=selected_hitters[0] if selected_hitters else "",
            selected_game_key=game_key,
            selected_game_date=game_date.isoformat() if game_date else None,
            available_games=[],
            pitch_type_legend=[],
            pa_groups=[],
            total_pa=0,
        )

    stuff_rows = []
    for row in rows:
        r = dict(row)
        hb_value = r.get("hb")
        is_lefty = bool(r.get("is_lefty"))
        r["hb_adj"] = hb_value if is_lefty else (-hb_value if _is_num(hb_value) else None)
        stuff_rows.append(r)
    _, avg_stuff_by_pitch_type = _compute_stuff_by_pitch_type(stuff_rows, "Fastball", "College")

    def _row_game_key(row: Dict[str, Any]) -> Optional[str]:
        for field in ("game_id", "game_uid", "game_foreign_id"):
            value = str(row.get(field) or "").strip()
            if value:
                return value
        session_dt = row.get("session_date")
        return session_dt.isoformat() if session_dt else None

    game_meta: Dict[str, Dict[str, Any]] = {}
    for row in rows:
        key = _row_game_key(dict(row))
        if not key:
            continue
        session_dt = row.get("session_date")
        current = game_meta.get(key)
        if current is None:
            game_meta[key] = {"date": session_dt}
        elif session_dt and (current.get("date") is None or session_dt > current.get("date")):
            current["date"] = session_dt

    sorted_games = sorted(
        game_meta.items(),
        key=lambda item: (
            item[1].get("date") or date.min,
            item[0],
        ),
    )
    available_games = [
        {
            "game_key": key,
            "date": meta["date"].isoformat() if meta.get("date") else "",
            "label": (
                f"{(meta['date'].month if meta.get('date') else '')}/"
                f"{(meta['date'].day if meta.get('date') else '')}/"
                f"{(str(meta['date'].year)[-2:] if meta.get('date') else '')} | {key}"
            ) if meta.get("date") else key,
        }
        for key, meta in sorted_games
    ]

    selected_game_key = game_key
    if game_date and not selected_game_key:
        date_iso = game_date.isoformat()
        date_matches = [entry["game_key"] for entry in available_games if entry.get("date") == date_iso]
        if date_matches:
            selected_game_key = date_matches[-1]
    if not selected_game_key and available_games:
        selected_game_key = available_games[-1]["game_key"]
    if selected_game_key and available_games and selected_game_key not in {entry["game_key"] for entry in available_games}:
        selected_game_key = available_games[-1]["game_key"]

    rows_for_game = []
    selected_game_date = None
    if selected_game_key:
        rows_for_game = [row for row in rows if _row_game_key(dict(row)) == selected_game_key]
        game_entry = next((entry for entry in available_games if entry["game_key"] == selected_game_key), None)
        selected_game_date = game_entry.get("date") if game_entry else None
    elif rows:
        rows_for_game = list(rows)
        dated_rows = [row.get("session_date") for row in rows if row.get("session_date")]
        if dated_rows:
            latest = max(dated_rows)
            selected_game_date = latest.isoformat() if hasattr(latest, "isoformat") else str(latest)
    grouped_pas = _ab_group_rows(rows_for_game)

    pitcher_sections: Dict[str, List[Dict[str, Any]]] = {}
    pa_counter = 0
    for pa_rows in grouped_pas:
        pa_counter += 1
        last_row = pa_rows[-1]
        pitcher_name = str(last_row.get("pitcher") or "Unknown Pitcher")
        pa_payload = {
            "pa_index": pa_counter,
            "result_label": _ab_pa_result_label(last_row),
            "hitter_label": str(last_row.get("batter") or ""),
            "pitches": [_pitch_action_payload(row, avg_stuff_by_pitch_type) for row in pa_rows],
        }
        pitcher_sections.setdefault(pitcher_name, []).append(pa_payload)

    pa_groups = [
        {"pitcher": pitcher_name, "pas": pas}
        for pitcher_name, pas in pitcher_sections.items()
    ]
    pitch_type_legend = sorted({str(row.get("pitch_type") or "Undefined") for row in rows})

    return HittingAbReportResponse(
        school_code=school_code,
        hitter=selected_hitters[0] if selected_hitters else "",
        selected_game_key=selected_game_key,
        selected_game_date=selected_game_date,
        available_games=available_games,
        pitch_type_legend=pitch_type_legend,
        pa_groups=pa_groups,
        total_pa=pa_counter,
    )


def _ensure_manual_velocity_table(cur: Any) -> None:
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS public.manual_velocity_entries (
          id BIGSERIAL PRIMARY KEY,
          school_code TEXT NOT NULL,
          entry_date DATE NOT NULL,
          pitcher TEXT NOT NULL,
          throw_type TEXT NOT NULL,
          plyo_drill TEXT NOT NULL DEFAULT '',
          ball_weight_oz DOUBLE PRECISION NOT NULL,
          velocity_mph DOUBLE PRECISION NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    cur.execute("ALTER TABLE public.manual_velocity_entries ADD COLUMN IF NOT EXISTS school_code TEXT")
    cur.execute("ALTER TABLE public.manual_velocity_entries ADD COLUMN IF NOT EXISTS entry_date DATE")
    cur.execute("ALTER TABLE public.manual_velocity_entries ADD COLUMN IF NOT EXISTS pitcher TEXT")
    cur.execute("ALTER TABLE public.manual_velocity_entries ADD COLUMN IF NOT EXISTS throw_type TEXT")
    cur.execute("ALTER TABLE public.manual_velocity_entries ADD COLUMN IF NOT EXISTS plyo_drill TEXT DEFAULT ''")
    cur.execute("ALTER TABLE public.manual_velocity_entries ADD COLUMN IF NOT EXISTS ball_weight_oz DOUBLE PRECISION")
    cur.execute("ALTER TABLE public.manual_velocity_entries ADD COLUMN IF NOT EXISTS velocity_mph DOUBLE PRECISION")
    cur.execute("ALTER TABLE public.manual_velocity_entries ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''")
    cur.execute("ALTER TABLE public.manual_velocity_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()")
    # Backfill school_code from legacy app_id when present.
    cur.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'manual_velocity_entries'
              AND column_name = 'app_id'
          ) THEN
            EXECUTE '
              UPDATE public.manual_velocity_entries
                 SET school_code = COALESCE(NULLIF(TRIM(school_code), ''''), NULLIF(TRIM(app_id::text), ''''))
               WHERE school_code IS NULL OR TRIM(school_code) = ''''
            ';
          END IF;
        END $$;
        """
    )
    cur.execute(
        """
        UPDATE public.manual_velocity_entries
           SET notes = ''
         WHERE notes IS NULL
        """
    )
    cur.execute(
        """
        UPDATE public.manual_velocity_entries
           SET plyo_drill = ''
         WHERE plyo_drill IS NULL
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_manual_velocity_entries_school_date
          ON public.manual_velocity_entries (school_code, entry_date DESC)
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_manual_velocity_entries_school_pitcher
          ON public.manual_velocity_entries (school_code, pitcher)
        """
    )


def _manual_velocity_schema_info(cur: Any) -> Dict[str, Any]:
    cur.execute(
        """
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'manual_velocity_entries'
        """
    )
    cols = {str(row.get("column_name") or ""): row for row in (cur.fetchall() or [])}
    id_type = str((cols.get("id") or {}).get("data_type") or "").lower()
    return {
        "id_is_text": id_type in {"text", "character varying", "varchar"},
        "has_app_id": "app_id" in cols,
    }


def _map_manual_velocity_entry(row: Dict[str, Any]) -> ManualVelocityEntry:
    return ManualVelocityEntry(
        id=str(row.get("id") or ""),
        school_code=str(row.get("school_code") or ""),
        entry_date=(row.get("entry_date").isoformat() if hasattr(row.get("entry_date"), "isoformat") else str(row.get("entry_date") or "")),
        pitcher=str(row.get("pitcher") or ""),
        throw_type=str(row.get("throw_type") or ""),
        plyo_drill=str(row.get("plyo_drill") or ""),
        ball_weight_oz=float(row.get("ball_weight_oz") or 0.0),
        velocity_mph=float(row.get("velocity_mph") or 0.0),
        notes=str(row.get("notes") or ""),
        created_at=(row.get("created_at").isoformat() if hasattr(row.get("created_at"), "isoformat") else str(row.get("created_at") or "")),
    )


@app.get("/v1/pitching/manual-velocity", response_model=ManualVelocityListResponse)
def pitching_manual_velocity_list(
    school_code: str = Query(..., min_length=1),
) -> ManualVelocityListResponse:
    school_code = _validate_school_code(school_code)
    try:
        with get_conn() as conn, conn.cursor() as cur:
            _ensure_manual_velocity_table(cur)
            cur.execute(
                """
                SELECT id, school_code, entry_date, pitcher, throw_type, plyo_drill, ball_weight_oz, velocity_mph, notes, created_at
                FROM public.manual_velocity_entries
                WHERE school_code = %(school_code)s
                ORDER BY entry_date DESC, created_at DESC, id DESC
                """,
                {"school_code": school_code},
            )
            rows = cur.fetchall()
        return ManualVelocityListResponse(
            school_code=school_code,
            entries=[_map_manual_velocity_entry(row) for row in rows],
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"manual velocity list failed: {exc}") from exc


@app.post("/v1/pitching/manual-velocity", response_model=ManualVelocityCreateResponse)
def pitching_manual_velocity_create(payload: ManualVelocityCreateRequest) -> ManualVelocityCreateResponse:
    school_code = _validate_school_code(payload.school_code)
    pitcher = str(payload.pitcher or "").strip()
    throw_type = str(payload.throw_type or "").strip()
    plyo_drill = str(payload.plyo_drill or "").strip()
    notes = str(payload.notes or "").strip()
    if not pitcher or pitcher == "All":
        raise HTTPException(status_code=400, detail="Pick a specific pitcher for manual entries.")
    if not throw_type:
        raise HTTPException(status_code=400, detail="throw_type is required.")
    if throw_type == "Plyo Velo" and not plyo_drill:
        raise HTTPException(status_code=400, detail="plyo_drill is required for Plyo Velo.")
    if not _is_num(payload.ball_weight_oz) or float(payload.ball_weight_oz) <= 0:
        raise HTTPException(status_code=400, detail="ball_weight_oz must be a positive number.")
    velocities = [float(v) for v in (payload.velocities or []) if _is_num(v) and float(v) > 0]
    if not velocities:
        raise HTTPException(status_code=400, detail="No valid velocity values provided.")

    entry_date_val = date.today()
    raw_entry_date = str(payload.entry_date or "").strip()
    if raw_entry_date:
        try:
            entry_date_val = date.fromisoformat(raw_entry_date[:10])
        except ValueError:
            raise HTTPException(status_code=400, detail="entry_date must be YYYY-MM-DD.")

    try:
        with get_conn() as conn, conn.cursor() as cur:
            _ensure_manual_velocity_table(cur)
            schema = _manual_velocity_schema_info(cur)
            common_params = {
                "school_code": school_code,
                "entry_date": entry_date_val.isoformat(),
                "pitcher": pitcher,
                "throw_type": throw_type,
                "plyo_drill": plyo_drill,
                "ball_weight_oz": float(payload.ball_weight_oz),
                "velocities": velocities,
                "notes": notes,
            }
            if schema["id_is_text"]:
                if schema["has_app_id"]:
                    cur.execute(
                        """
                        INSERT INTO public.manual_velocity_entries (
                          id, app_id, school_code, entry_date, pitcher, throw_type, plyo_drill, ball_weight_oz, velocity_mph, notes, created_at
                        )
                        SELECT
                          CONCAT('mv_', to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), '_', ord)::text,
                          %(school_code)s,
                          %(school_code)s,
                          %(entry_date)s::date,
                          %(pitcher)s,
                          %(throw_type)s,
                          %(plyo_drill)s,
                          %(ball_weight_oz)s::double precision,
                          v::double precision,
                          %(notes)s,
                          NOW()
                        FROM unnest(%(velocities)s::double precision[]) WITH ORDINALITY AS u(v, ord)
                        RETURNING id, school_code, entry_date, pitcher, throw_type, plyo_drill, ball_weight_oz, velocity_mph, notes, created_at
                        """,
                        common_params,
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO public.manual_velocity_entries (
                          id, school_code, entry_date, pitcher, throw_type, plyo_drill, ball_weight_oz, velocity_mph, notes, created_at
                        )
                        SELECT
                          CONCAT('mv_', to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS'), '_', ord)::text,
                          %(school_code)s,
                          %(entry_date)s::date,
                          %(pitcher)s,
                          %(throw_type)s,
                          %(plyo_drill)s,
                          %(ball_weight_oz)s::double precision,
                          v::double precision,
                          %(notes)s,
                          NOW()
                        FROM unnest(%(velocities)s::double precision[]) WITH ORDINALITY AS u(v, ord)
                        RETURNING id, school_code, entry_date, pitcher, throw_type, plyo_drill, ball_weight_oz, velocity_mph, notes, created_at
                        """,
                        common_params,
                    )
            else:
                if schema["has_app_id"]:
                    cur.execute(
                        """
                        INSERT INTO public.manual_velocity_entries (
                          app_id, school_code, entry_date, pitcher, throw_type, plyo_drill, ball_weight_oz, velocity_mph, notes
                        )
                        SELECT
                          %(school_code)s,
                          %(school_code)s,
                          %(entry_date)s::date,
                          %(pitcher)s,
                          %(throw_type)s,
                          %(plyo_drill)s,
                          %(ball_weight_oz)s::double precision,
                          v::double precision,
                          %(notes)s
                        FROM unnest(%(velocities)s::double precision[]) AS u(v)
                        RETURNING id, school_code, entry_date, pitcher, throw_type, plyo_drill, ball_weight_oz, velocity_mph, notes, created_at
                        """,
                        common_params,
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO public.manual_velocity_entries (
                          school_code, entry_date, pitcher, throw_type, plyo_drill, ball_weight_oz, velocity_mph, notes
                        )
                        SELECT
                          %(school_code)s, %(entry_date)s::date, %(pitcher)s, %(throw_type)s, %(plyo_drill)s, %(ball_weight_oz)s::double precision, v::double precision, %(notes)s
                        FROM unnest(%(velocities)s::double precision[]) AS v
                        RETURNING id, school_code, entry_date, pitcher, throw_type, plyo_drill, ball_weight_oz, velocity_mph, notes, created_at
                        """,
                        common_params,
                    )
            rows = cur.fetchall()
        return ManualVelocityCreateResponse(
            ok=True,
            created_count=len(rows),
            entries=[_map_manual_velocity_entry(row) for row in rows],
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"manual velocity save failed: {exc}") from exc


@app.delete("/v1/pitching/manual-velocity", response_model=ManualVelocityDeleteResponse)
def pitching_manual_velocity_delete(
    school_code: str = Query(..., min_length=1),
    entry_id: str = Query(..., min_length=1),
) -> ManualVelocityDeleteResponse:
    school_code = _validate_school_code(school_code)
    try:
        with get_conn() as conn, conn.cursor() as cur:
            _ensure_manual_velocity_table(cur)
            cur.execute(
                """
                DELETE FROM public.manual_velocity_entries
                WHERE school_code = %(school_code)s AND id::text = %(entry_id)s
                """,
                {"school_code": school_code, "entry_id": entry_id},
            )
            if cur.rowcount <= 0:
                raise HTTPException(status_code=404, detail="Manual velocity entry not found.")
        return ManualVelocityDeleteResponse(ok=True, deleted_id=str(entry_id))
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"manual velocity delete failed: {exc}") from exc


@app.get("/v1/pitching/debug-team-codes")
def pitching_debug_team_codes(
    school_code: str = Query(..., min_length=1),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
) -> Dict[str, object]:
    school_code = _validate_school_code(school_code)
    roster = _load_school_roster(school_code)
    markers = roster.get("team_markers_norm", [])

    params = {
        "school_code": school_code,
        "start_date": start_date,
        "end_date": end_date,
        "markers": markers,
    }

    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                WITH base AS (
                  SELECT
                    """
                + PITCHER_TEAM_NORM_SQL
                + """ AS pitcher_team_norm,
                    """
                + BATTER_TEAM_NORM_SQL
                + """ AS batter_team_norm,
                    """
                + HOME_TEAM_NORM_SQL
                + """ AS home_team_norm,
                    """
                + AWAY_TEAM_NORM_SQL
                + """ AS away_team_norm
                  FROM public.pitch_events
                  WHERE school_code = %(school_code)s
                    AND (%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)
                    AND (%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)
                )
                SELECT
                  COUNT(*)::int AS total_rows,
                  COUNT(*) FILTER (WHERE pitcher_team_norm = ANY(%(markers)s::text[]))::int AS pitcher_marker_rows,
                  COUNT(*) FILTER (WHERE batter_team_norm = ANY(%(markers)s::text[]))::int AS batter_marker_rows,
                  COUNT(*) FILTER (WHERE home_team_norm = ANY(%(markers)s::text[]))::int AS home_marker_rows,
                  COUNT(*) FILTER (WHERE away_team_norm = ANY(%(markers)s::text[]))::int AS away_marker_rows,
                  COUNT(*) FILTER (
                    WHERE (
                      (pitcher_team_norm = ANY(%(markers)s::text[]) AND batter_team_norm <> '' AND NOT (batter_team_norm = ANY(%(markers)s::text[])))
                      OR
                      (batter_team_norm = ANY(%(markers)s::text[]) AND pitcher_team_norm <> '' AND NOT (pitcher_team_norm = ANY(%(markers)s::text[])))
                      OR
                      (home_team_norm = ANY(%(markers)s::text[]) AND away_team_norm <> '' AND NOT (away_team_norm = ANY(%(markers)s::text[])))
                      OR
                      (away_team_norm = ANY(%(markers)s::text[]) AND home_team_norm <> '' AND NOT (home_team_norm = ANY(%(markers)s::text[])))
                    )
                  )::int AS season_rule_rows,
                  COUNT(*) FILTER (
                    WHERE (
                      (pitcher_team_norm = ANY(%(markers)s::text[]) AND batter_team_norm = ANY(%(markers)s::text[]))
                      OR
                      (home_team_norm = ANY(%(markers)s::text[]) AND away_team_norm = ANY(%(markers)s::text[]))
                    )
                  )::int AS live_rule_rows
                FROM base
                """,
                params,
            )
            counts = cur.fetchone() or {}

            cur.execute(
                """
                WITH base AS (
                  SELECT """
                + PITCHER_TEAM_NORM_SQL
                + """ AS code
                  FROM public.pitch_events
                  WHERE school_code = %(school_code)s
                    AND (%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)
                    AND (%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)
                )
                SELECT code, COUNT(*)::int AS n
                FROM base
                GROUP BY code
                ORDER BY n DESC, code
                LIMIT 25
                """,
                params,
            )
            top_pitcher = cur.fetchall()

            cur.execute(
                """
                WITH base AS (
                  SELECT """
                + BATTER_TEAM_NORM_SQL
                + """ AS code
                  FROM public.pitch_events
                  WHERE school_code = %(school_code)s
                    AND (%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)
                    AND (%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)
                )
                SELECT code, COUNT(*)::int AS n
                FROM base
                GROUP BY code
                ORDER BY n DESC, code
                LIMIT 25
                """,
                params,
            )
            top_batter = cur.fetchall()

        return {
            "school_code": school_code,
            "markers": markers,
            "counts": counts,
            "top_pitcher_team_codes": top_pitcher,
            "top_batter_team_codes": top_batter,
        }
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"debug query failed: {exc}") from exc


def _hit_result_label(pitch_call: Any, play_result: Any) -> str:
    pc = str(pitch_call or "").strip()
    pr = _canonical_play_result(play_result)
    if pc == "HitByPitch":
        return "Ball"
    if pc == "StrikeCalled":
        return "Called Strike"
    if pc in {"BallCalled", "BallIntentional", "BallinDirt"}:
        return "Ball"
    if pc in {"FoulBallNotFieldable", "FoulBallFieldable", "FoulBall"}:
        return "Foul"
    if pc == "StrikeSwinging":
        return "Whiff"
    if pc == "InPlay":
        if pr in {"Out", "FieldersChoice", "Sacrifice"}:
            return "In Play (Out)"
        if pr in {"Single", "Double", "Triple", "HomeRun"}:
            return "In Play (Hit)"
        if pr == "Error":
            return "Error"
        return "In Play (Out)"
    return "Ball"


def _canonical_play_result(play_result: Any) -> str:
    raw = str(play_result or "").strip()
    if not raw:
        return ""
    compact = re.sub(r"[^a-z0-9]", "", raw.lower())
    aliases = {
        "single": "Single",
        "double": "Double",
        "triple": "Triple",
        "homerun": "HomeRun",
        "homeruns": "HomeRun",
        "homer": "HomeRun",
        "homeurn": "HomeRun",
        "out": "Out",
        "fielderschoice": "FieldersChoice",
        "sacrifice": "Sacrifice",
        "error": "Error",
        "walk": "Walk",
        "intentionalwalk": "IntentionalWalk",
        "hitbypitch": "HitByPitch",
        "undefined": "Undefined",
    }
    return aliases.get(compact, raw)


def _pitch_result_filter_match(selected_pitch_results: List[str], result_label: str, play_result: Any) -> bool:
    if not selected_pitch_results:
        return True
    selected = {str(token or "").strip() for token in selected_pitch_results if str(token or "").strip()}
    if not selected:
        return True
    if result_label in selected:
        return True
    pr = _canonical_play_result(play_result)
    if not pr:
        return False
    if pr in selected:
        return True
    if pr in {"Single", "Double", "Triple", "HomeRun"} and "In Play (Hit)" in selected:
        return True
    if pr in {"Out", "FieldersChoice", "Sacrifice"} and "In Play (Out)" in selected:
        return True
    return False


def _count_token_match(token: str, balls: Any, strikes: Any) -> bool:
    b = int(float(balls)) if _is_num(balls) else None
    s = int(float(strikes)) if _is_num(strikes) else None
    if b is None or s is None:
        return False
    t = (token or "").strip()
    if not t:
        return True
    if t == "Even":
        return (b, s) in {(0, 0), (1, 1), (2, 2), (3, 2)}
    if t == "Behind":
        return (b, s) in {(1, 0), (2, 0), (3, 0), (3, 1), (2, 1)}
    if t == "Ahead":
        return (b, s) in {(0, 1), (0, 2), (1, 2)}
    if t == "2KNF":
        return s == 2 and b < 3
    return t == f"{b}-{s}"


def _zone_location_match(token: str, row: Dict[str, Any]) -> bool:
    ph = row.get("plate_height")
    ps = row.get("plate_side")
    if not (_is_num(ph) and _is_num(ps)):
        return False
    phf = float(ph)
    psf = float(ps)
    is_lefty = _norm_hand(row.get("pitcherthrows")) == "Left"
    upper = phf >= ZONE_MID_Y
    glove_half = psf >= ZONE_MID_X if is_lefty else psf <= ZONE_MID_X
    if token == "Upper Half":
        return upper
    if token == "Bottom Half":
        return not upper
    if token == "Glove Side Half":
        return glove_half
    if token == "Arm Side Half":
        return not glove_half
    if token == "Upper 3rd":
        return phf >= (ZONE_BOTTOM + 2 * ZONE_DY)
    if token == "Bottom 3rd":
        return phf < (ZONE_BOTTOM + ZONE_DY)
    if token == "Glove Side 3rd":
        return (psf >= (ZONE_LEFT + 2 * ZONE_DX)) if is_lefty else (psf < (ZONE_LEFT + ZONE_DX))
    if token == "Arm Side 3rd":
        return (psf < (ZONE_LEFT + ZONE_DX)) if is_lefty else (psf >= (ZONE_LEFT + 2 * ZONE_DX))
    return False


@app.get("/v1/hitting/filters")
def hitting_filters(school_code: str = Query(..., min_length=1)) -> Dict[str, Any]:
    school_code = _validate_school_code(school_code)
    _ensure_performance_indexes()
    roster = _load_school_roster(school_code)
    campers_norm = set(roster.get("campers_norm", []) or [])
    hitter_norm_set = set(roster.get("hitter_norm", []) or [])
    team_hitter_norm = sorted(hitter_norm_set - campers_norm)
    team_markers_norm = sorted(set(roster.get("team_markers_norm", []) or []))
    hitters_by_team_code: Dict[str, List[str]] = {}
    opp_pitchers_by_team_code: Dict[str, List[str]] = {}
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  MIN(session_date)::text AS min_date,
                  MAX(session_date)::text AS max_date
                FROM public.pitch_events
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                """,
                {"school_code": school_code, "team_markers_norm": team_markers_norm},
            )
            date_row = cur.fetchone() or {}

            cur.execute(
                """
                SELECT DISTINCT TRIM(batter) AS hitter
                FROM public.pitch_events
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                  AND COALESCE(TRIM(batter), '') <> ''
                  AND (
                    %(hitter_count)s::int = 0 OR
                    regexp_replace(lower(COALESCE(TRIM(batter), '')), '[^a-z0-9]', '', 'g') = ANY(%(hitters_norm)s::text[])
                  )
                ORDER BY hitter ASC
                """,
                {
                    "school_code": school_code,
                    "hitters_norm": team_hitter_norm,
                    "hitter_count": len(team_hitter_norm),
                    "team_markers_norm": team_markers_norm,
                },
            )
            hitters = [str(row["hitter"]) for row in cur.fetchall()]

            cur.execute(
                """
                SELECT DISTINCT TRIM(pitcher) AS opp_pitcher
                FROM public.pitch_events
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                  AND COALESCE(TRIM(pitcher), '') <> ''
                ORDER BY opp_pitcher ASC
                """,
                {"school_code": school_code, "team_markers_norm": team_markers_norm},
            )
            opp_pitchers = [str(row["opp_pitcher"]) for row in cur.fetchall()]
            if team_hitter_norm:
                team_hitter_keys = set(team_hitter_norm)
                opp_pitchers = [name for name in opp_pitchers if _normalize_name_key(name) not in team_hitter_keys]

            cur.execute(
                """
                SELECT pitch_type
                FROM (
                  SELECT DISTINCT
                    """
                + PITCH_TYPE_NORMALIZE_SQL
                + """ AS pitch_type,
                    """
                + PITCH_TYPE_ORDER_SQL
                + """ AS pitch_sort
                  FROM public.pitch_events
                  WHERE school_code = %(school_code)s
                    AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                ) t
                ORDER BY t.pitch_sort ASC, t.pitch_type ASC
                """,
                {"school_code": school_code, "team_markers_norm": team_markers_norm},
            )
            pitch_types = [str(row["pitch_type"]) for row in cur.fetchall() if str(row["pitch_type"]) != "Undefined"]
            team_types: List[str]
            if school_code == "LEAGUE":
                cur.execute(_league_team_codes_sql_expr(), {"school_code": school_code})
                league_team_codes = [str(row["team_code"]) for row in cur.fetchall() if str(row.get("team_code") or "").strip()]
                team_types = ["All", *league_team_codes]
                cur.execute(_league_name_map_sql_expr("batterteam", "batter"), {"school_code": school_code})
                hitters_by_team_code = {
                    str(row["team_code"]): [str(name) for name in (row.get("names") or []) if str(name).strip()]
                    for row in cur.fetchall()
                }
                cur.execute(_league_name_map_sql_expr("batterteam", "pitcher"), {"school_code": school_code})
                opp_pitchers_by_team_code = {
                    str(row["team_code"]): [str(name) for name in (row.get("names") or []) if str(name).strip()]
                    for row in cur.fetchall()
                }
            else:
                team_types = ["All", school_code, "Opponents", "Campers"]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"hitting filters query failed: {exc}") from exc

    return {
        "school_code": school_code,
        "min_date": date_row.get("min_date"),
        "max_date": date_row.get("max_date"),
        "hitters": hitters,
        "opp_pitchers": opp_pitchers,
        "team_types": team_types,
        "hands": ["All", "Left", "Right"],
        "batter_sides": ["All", "Left", "Right"],
        "pitch_types": pitch_types,
        "zone_locations": ZONE_LOCATION_CHOICES,
        "in_zone_options": ["All", "Yes", "No", "Competitive"],
        "pitch_results": PITCH_RESULT_CHOICES,
        "count_options": COUNT_CHOICES,
        "after_count_options": COUNT_CHOICES,
        "bip_results": ["All", "Single", "Double", "Triple", "HomeRun", "Out"],
        "hitters_by_team_code": hitters_by_team_code,
        "opp_pitchers_by_team_code": opp_pitchers_by_team_code,
        "table_modes": ["Results", "Swing Decisions", "Batted Ball Data", "Custom"],
        "split_by_options": [
            "Pitch Types",
            "Pitcher Hand",
            "Count",
            "After Count",
            "Zone Location",
            "Times Through Order",
            "Velocity",
            "IVB",
            "HB",
            "Pitcher",
            "Catcher",
        ],
    }


@app.get("/v1/hitting/overview")
def hitting_overview(
    school_code: str = Query(..., min_length=1),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    session_type: Optional[str] = Query(default=None),
    team_type: Optional[str] = Query(default=None),
    hitter: Optional[str] = Query(default=None),
    opp_pitcher: Optional[str] = Query(default=None),
    hand: Optional[str] = Query(default=None),
    batter_side: Optional[str] = Query(default=None),
    table_mode: Optional[str] = Query(default=None),
    split_by: Optional[str] = Query(default=None),
    custom_columns: Optional[str] = Query(default=None),
    in_zone: Optional[str] = Query(default=None),
    pitch_types: Optional[str] = Query(default=None),
    zone_locations: Optional[str] = Query(default=None),
    pitch_results: Optional[str] = Query(default=None),
    count_filter: Optional[str] = Query(default=None),
    after_count_filter: Optional[str] = Query(default=None),
    bip_result: Optional[str] = Query(default=None),
    velo_min: Optional[str] = Query(default=None),
    velo_max: Optional[str] = Query(default=None),
    ivb_min: Optional[str] = Query(default=None),
    ivb_max: Optional[str] = Query(default=None),
    hb_min: Optional[str] = Query(default=None),
    hb_max: Optional[str] = Query(default=None),
    pc_min: Optional[str] = Query(default=None),
    pc_max: Optional[str] = Query(default=None),
    include_chart_points: bool = Query(default=True),
) -> Dict[str, Any]:
    school_code = _validate_school_code(school_code)
    _ensure_performance_indexes()
    roster = _load_school_roster(school_code)
    hitter_norm = set(roster.get("hitter_norm", []) or [])
    campers_norm = set(roster.get("campers_norm", []) or [])
    team_hitter_norm = set(hitter_norm - campers_norm)
    team_markers_norm = set(roster.get("team_markers_norm", []) or [])
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date.")

    team_type_value = (team_type or "").strip() or "All"
    use_team_filter = team_type_value not in {"", "All"}
    selected_hitter_keys = _name_filter_keys(_parse_name_list(hitter))
    selected_opp_pitcher_keys = _name_filter_keys(_parse_name_list(opp_pitcher))
    selected_in_zone = _parse_csv_list(in_zone)
    selected_pitch_types = _valid_pitch_types(_parse_csv_list(pitch_types))
    selected_zone_locations = _parse_csv_list(zone_locations)
    selected_pitch_results = _parse_csv_list(pitch_results)
    selected_count_filters = _parse_csv_list(count_filter)
    selected_after_count_filters = _parse_csv_list(after_count_filter)
    selected_bip_results = _parse_csv_list(bip_result)
    selected_custom_columns = _parse_csv_list(custom_columns)
    session_type_filter = _normalize_session_type_filter(session_type)

    parsed_velo_min = _parse_optional_float(velo_min, "velo_min")
    parsed_velo_max = _parse_optional_float(velo_max, "velo_max")
    parsed_ivb_min = _parse_optional_float(ivb_min, "ivb_min")
    parsed_ivb_max = _parse_optional_float(ivb_max, "ivb_max")
    parsed_hb_min = _parse_optional_float(hb_min, "hb_min")
    parsed_hb_max = _parse_optional_float(hb_max, "hb_max")
    parsed_pc_min = _parse_optional_int(pc_min, "pc_min")
    parsed_pc_max = _parse_optional_int(pc_max, "pc_max")

    mode_raw = (table_mode or "Results").strip()
    mode_map = {"Results": "Hitting Results", "Swing Decisions": "Swing Decisions", "Batted Ball Data": "Batted Ball Data", "Custom": "Custom"}
    table_mode_mapped = mode_map.get(mode_raw, "Results")
    split_by = (split_by or "Pitch Types").strip() or "Pitch Types"
    overview_cache_key = _overview_cache_key(
        "hitting_overview",
        school_code,
        {
            "school_code": school_code,
            "start_date": start_date,
            "end_date": end_date,
            "session_type": session_type_filter,
            "team_type": team_type_value,
            "hitter": sorted(selected_hitter_keys),
            "opp_pitcher": sorted(selected_opp_pitcher_keys),
            "hand": hand,
            "batter_side": batter_side,
            "table_mode": table_mode_mapped,
            "split_by": split_by,
            "custom_columns": selected_custom_columns,
            "in_zone": selected_in_zone,
            "pitch_types": selected_pitch_types,
            "zone_locations": selected_zone_locations,
            "pitch_results": selected_pitch_results,
            "count_filter": selected_count_filters,
            "after_count_filter": selected_after_count_filters,
            "bip_result": selected_bip_results,
            "velo_min": parsed_velo_min,
            "velo_max": parsed_velo_max,
            "ivb_min": parsed_ivb_min,
            "ivb_max": parsed_ivb_max,
            "hb_min": parsed_hb_min,
            "hb_max": parsed_hb_max,
            "pc_min": parsed_pc_min,
            "pc_max": parsed_pc_max,
            "include_chart_points": include_chart_points,
        },
    )
    cached_overview = _overview_cache_get(overview_cache_key)
    if cached_overview is not None:
        return cached_overview
    need_prev_counts = bool(selected_after_count_filters) or (split_by == "After Count")
    need_pitch_number = parsed_pc_min is not None or parsed_pc_max is not None

    try:
        with get_conn() as conn, conn.cursor() as cur:
            prev_balls_sql = (
                "LAG((regexp_match(COALESCE(balls::text, ''), '[-+]?[0-9]+'))[1]::int) OVER (ORDER BY session_date, COALESCE(created_at, NOW()), id) AS prev_balls"
                if need_prev_counts
                else "NULL::int AS prev_balls"
            )
            prev_strikes_sql = (
                "LAG((regexp_match(COALESCE(strikes::text, ''), '[-+]?[0-9]+'))[1]::int) OVER (ORDER BY session_date, COALESCE(created_at, NOW()), id) AS prev_strikes"
                if need_prev_counts
                else "NULL::int AS prev_strikes"
            )
            pitch_number_sql = (
                "ROW_NUMBER() OVER (ORDER BY session_date, COALESCE(created_at, NOW()), id) AS pitch_number"
                if need_pitch_number
                else "NULL::int AS pitch_number"
            )
            cur.execute(
                (
                """
                SELECT
                  id AS pitch_event_id,
                  session_date,
                  COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), 'Unknown') AS session_type_norm,
                  COALESCE(NULLIF(TRIM(pitcher), ''), 'Unknown Pitcher') AS pitcher,
                  COALESCE(NULLIF(TRIM(batter), ''), '') AS batter,
                  COALESCE(NULLIF(TRIM(catcher), ''), '') AS catcher,
                  COALESCE(NULLIF(TRIM(pitcherteam), ''), '') AS pitcher_team_code,
                  COALESCE(NULLIF(TRIM(batterteam), ''), '') AS batter_team_code,
                  COALESCE(NULLIF(TRIM(hometeam), ''), '') AS home_team_code,
                  COALESCE(NULLIF(TRIM(awayteam), ''), '') AS away_team_code,
                  COALESCE(NULLIF(TRIM(pitcherthrows), ''), '') AS pitcherthrows,
                  COALESCE(NULLIF(TRIM(batterside), ''), '') AS batterside,
                  """
                + PITCH_TYPE_NORMALIZE_SQL
                + """ AS pitch_type,
                  COALESCE(NULLIF(TRIM(pitchcall), ''), '') AS pitch_call,
                  COALESCE(NULLIF(TRIM(playresult), ''), '') AS play_result,
                  COALESCE(NULLIF(TRIM(korbb), ''), '') AS korbb,
                  COALESCE(NULLIF(TRIM(taggedhittype), ''), '') AS tagged_hit_type,
                  (regexp_match(COALESCE(relspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_speed,
                  (regexp_match(COALESCE(inducedvertbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ivb,
                  (regexp_match(COALESCE(horzbreak, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS hb,
                  (regexp_match(COALESCE(spinrate, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_rate,
                  COALESCE(NULLIF(TRIM(releasetilt), ''), '') AS release_tilt,
                  COALESCE(NULLIF(TRIM(breaktilt), ''), '') AS break_tilt,
                  (regexp_match(COALESCE(spinefficiency, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_eff,
                  (regexp_match(COALESCE(relheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_height,
                  (regexp_match(COALESCE(relside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_side,
                  (regexp_match(COALESCE(extension, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ext_value,
                  (regexp_match(COALESCE(vertapprangle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS vaa,
                  (regexp_match(COALESCE(horzapprangle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS haa,
                  (regexp_match(COALESCE(exitspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS exit_speed,
                  (regexp_match(COALESCE(angle, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS angle,
                  (regexp_match(
                    COALESCE(
                      distance,
                      to_jsonb(pe)->>'distance',
                      to_jsonb(pe)->>'lasttrackeddistance',
                      to_jsonb(pe)->>'LastTrackedDistance',
                      ''
                    ),
                    '[-+]?[0-9]*\\.?[0-9]+'
                  ))[1]::double precision AS distance,
                  (regexp_match(
                    COALESCE(
                      direction,
                      to_jsonb(pe)->>'direction',
                      to_jsonb(pe)->>'bearing',
                      to_jsonb(pe)->>'Bearing',
                      ''
                    ),
                    '[-+]?[0-9]*\\.?[0-9]+'
                  ))[1]::double precision AS direction,
                  (regexp_match(COALESCE(platelocside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_side,
                  (regexp_match(COALESCE(platelocheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_height,
                  (regexp_match(
                    COALESCE(
                      to_jsonb(pe)->>'contactpositionx',
                      to_jsonb(pe)->>'ContactPositionX',
                      to_jsonb(pe)->>'contact_position_x',
                      to_jsonb(pe)->>'Contact_Position_X',
                      ''
                    ),
                    '[-+]?[0-9]*\\.?[0-9]+'
                  ))[1]::double precision AS contact_position_x,
                  (regexp_match(
                    COALESCE(
                      to_jsonb(pe)->>'contactpositiony',
                      to_jsonb(pe)->>'ContactPositionY',
                      to_jsonb(pe)->>'contact_position_y',
                      to_jsonb(pe)->>'Contact_Position_Y',
                      ''
                    ),
                    '[-+]?[0-9]*\\.?[0-9]+'
                  ))[1]::double precision AS contact_position_y,
                  (regexp_match(
                    COALESCE(
                      to_jsonb(pe)->>'contactpositionz',
                      to_jsonb(pe)->>'ContactPositionZ',
                      to_jsonb(pe)->>'contact_position_z',
                      to_jsonb(pe)->>'Contact_Position_Z',
                      ''
                    ),
                    '[-+]?[0-9]*\\.?[0-9]+'
                  ))[1]::double precision AS contact_position_z,
                  (regexp_match(
                    COALESCE(
                      to_jsonb(pe)->>'verticalattackangle',
                      to_jsonb(pe)->>'VerticalAttackAngle',
                      to_jsonb(pe)->>'vertical_attack_angle',
                      to_jsonb(pe)->>'Vertical_Attack_Angle',
                      ''
                    ),
                    '[-+]?[0-9]*\\.?[0-9]+'
                  ))[1]::double precision AS vertical_attack_angle,
                  (regexp_match(
                    COALESCE(
                      to_jsonb(pe)->>'horizontalattackangle',
                      to_jsonb(pe)->>'HorizontalAttackAngle',
                      to_jsonb(pe)->>'horizontal_attack_angle',
                      to_jsonb(pe)->>'Horizontal_Attack_Angle',
                      ''
                    ),
                    '[-+]?[0-9]*\\.?[0-9]+'
                  ))[1]::double precision AS horizontal_attack_angle,
                  (regexp_match(
                    COALESCE(
                      to_jsonb(pe)->>'batspeed',
                      to_jsonb(pe)->>'BatSpeed',
                      to_jsonb(pe)->>'bat_speed',
                      to_jsonb(pe)->>'Bat_Speed',
                      ''
                    ),
                    '[-+]?[0-9]*\\.?[0-9]+'
                  ))[1]::double precision AS bat_speed,
                  (regexp_match(COALESCE(balls::text, ''), '[-+]?[0-9]+'))[1]::int AS balls_num,
                  (regexp_match(COALESCE(strikes::text, ''), '[-+]?[0-9]+'))[1]::int AS strikes_num,
                  __PREV_BALLS_SQL__,
                  __PREV_STRIKES_SQL__,
                  __PITCH_NUMBER_SQL__
                FROM public.pitch_events pe
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                  AND (""" + PITCH_TYPE_NORMALIZE_SQL + """) <> 'Undefined'
                  AND (%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)
                  AND (%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)
                  AND (%(hitter_count)s::int = 0 OR """ + BATTER_NAME_NORM_SQL + """ = ANY(%(hitters_norm)s::text[]))
                  AND (%(opp_pitcher_count)s::int = 0 OR """ + PITCHER_NAME_NORM_SQL + """ = ANY(%(opp_pitchers_norm)s::text[]))
                  AND (
                    %(hand_filter)s::text IS NULL OR %(hand_filter)s::text = '' OR %(hand_filter)s::text = 'All' OR
                    (%(hand_filter)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'L') OR
                    (%(hand_filter)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'R')
                  )
                  AND (
                    %(batter_side_filter)s::text IS NULL OR %(batter_side_filter)s::text = '' OR %(batter_side_filter)s::text = 'All' OR
                    (%(batter_side_filter)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'L') OR
                    (%(batter_side_filter)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'R')
                  )
                  AND (%(pitch_types_count)s::int = 0 OR """ + PITCH_TYPE_NORMALIZE_SQL + """ = ANY(%(pitch_types)s::text[]))
                ORDER BY session_date, COALESCE(created_at, NOW()), id
                """
                ).replace("__PREV_BALLS_SQL__", prev_balls_sql).replace("__PREV_STRIKES_SQL__", prev_strikes_sql).replace("__PITCH_NUMBER_SQL__", pitch_number_sql),
                {
                    "school_code": school_code,
                    "start_date": start_date,
                    "end_date": end_date,
                    "team_markers_norm": sorted(team_markers_norm),
                    "hitter_count": len(selected_hitter_keys),
                    "hitters_norm": sorted(selected_hitter_keys),
                    "opp_pitcher_count": len(selected_opp_pitcher_keys),
                    "opp_pitchers_norm": sorted(selected_opp_pitcher_keys),
                    "hand_filter": hand,
                    "batter_side_filter": batter_side,
                    "pitch_types_count": len(selected_pitch_types),
                    "pitch_types": selected_pitch_types,
                },
            )
            rows = [dict(row) for row in cur.fetchall() if str(row.get("pitch_type") or "") != "Undefined"]
            _annotate_times_through_order(rows)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"hitting overview query failed: {exc}") from exc

    out_rows: List[Dict[str, Any]] = []
    for row in rows:
        row_session_bucket = _session_bucket_for_row(row, team_markers_norm)
        if session_type_filter and row_session_bucket != session_type_filter:
            continue
        if use_team_filter:
            if school_code == "LEAGUE":
                selected_code = _normalize_team_code(team_type_value)
                row_code = _normalize_team_code(str(row.get("batter_team_code") or ""))
                if not selected_code or row_code != selected_code:
                    continue
            else:
                batter_key = _normalize_name_key(str(row.get("batter") or ""))
                pitcher_team_code = _normalize_team_code(str(row.get("pitcher_team_code") or ""))
                batter_team_code = _normalize_team_code(str(row.get("batter_team_code") or ""))
                pitcher_is_marker = pitcher_team_code in team_markers_norm if pitcher_team_code else False
                batter_is_marker = batter_team_code in team_markers_norm if batter_team_code else False
                is_pcu_blank_team_row = (
                    school_code == "PCU"
                    and not pitcher_team_code
                    and not batter_team_code
                    and bool(batter_key)
                    and batter_key in (team_hitter_norm | campers_norm)
                )
                is_team_hitting_row = (batter_is_marker and not pitcher_is_marker) or is_pcu_blank_team_row
                is_opponent_hitting_row = pitcher_is_marker and bool(batter_team_code) and not batter_is_marker

                if team_type_value == "Opponents":
                    row_team_bucket = "Opponents" if is_opponent_hitting_row else None
                elif team_type_value == "Campers":
                    row_team_bucket = "Campers" if (batter_key in campers_norm and is_team_hitting_row) else None
                elif team_type_value == school_code:
                    if batter_key in campers_norm:
                        row_team_bucket = "Campers" if is_team_hitting_row else None
                    else:
                        row_team_bucket = school_code if is_team_hitting_row else None
                else:
                    row_team_bucket = None
                if row_team_bucket != team_type_value:
                    continue
        if selected_hitter_keys and _normalize_name_key(str(row.get("batter") or "")) not in selected_hitter_keys:
            continue
        if selected_opp_pitcher_keys and _normalize_name_key(str(row.get("pitcher") or "")) not in selected_opp_pitcher_keys:
            continue
        if hand and hand != "All" and _norm_hand(row.get("pitcherthrows")) != hand:
            continue
        if batter_side and batter_side != "All" and _norm_hand(row.get("batterside")) != batter_side:
            continue
        if selected_pitch_types and str(row.get("pitch_type") or "") not in selected_pitch_types:
            continue
        if selected_zone_locations and not any(_zone_location_match(tok, row) for tok in selected_zone_locations):
            continue
        if selected_in_zone:
            inz = _in_zone_label(row.get("plate_side"), row.get("plate_height"))
            if not any(tok == inz for tok in selected_in_zone):
                continue
        result_label = _hit_result_label(row.get("pitch_call"), row.get("play_result"))
        if not _pitch_result_filter_match(selected_pitch_results, result_label, row.get("play_result")):
            continue
        if selected_count_filters and not any(_count_token_match(tok, row.get("balls_num"), row.get("strikes_num")) for tok in selected_count_filters):
            continue
        if selected_after_count_filters and not any(_count_token_match(tok, row.get("prev_balls"), row.get("prev_strikes")) for tok in selected_after_count_filters):
            continue
        if selected_bip_results and "All" not in selected_bip_results:
            if str(row.get("pitch_call") or "") != "InPlay":
                continue
            pr = str(row.get("play_result") or "")
            mapped_pr = "Out" if pr in {"Out", "FieldersChoice", "Sacrifice"} else pr
            if mapped_pr not in selected_bip_results:
                continue
        if parsed_velo_min is not None and (not _is_num(row.get("rel_speed")) or float(row.get("rel_speed")) < parsed_velo_min):
            continue
        if parsed_velo_max is not None and (not _is_num(row.get("rel_speed")) or float(row.get("rel_speed")) > parsed_velo_max):
            continue
        if parsed_ivb_min is not None and (not _is_num(row.get("ivb")) or float(row.get("ivb")) < parsed_ivb_min):
            continue
        if parsed_ivb_max is not None and (not _is_num(row.get("ivb")) or float(row.get("ivb")) > parsed_ivb_max):
            continue
        if parsed_hb_min is not None and (not _is_num(row.get("hb")) or float(row.get("hb")) < parsed_hb_min):
            continue
        if parsed_hb_max is not None and (not _is_num(row.get("hb")) or float(row.get("hb")) > parsed_hb_max):
            continue
        if parsed_pc_min is not None and (not _is_num(row.get("pitch_number")) or int(float(row.get("pitch_number"))) < parsed_pc_min):
            continue
        if parsed_pc_max is not None and (not _is_num(row.get("pitch_number")) or int(float(row.get("pitch_number"))) > parsed_pc_max):
            continue
        row["result_label"] = result_label
        out_rows.append(row)

    _, avg_stuff_by_type = _compute_stuff_by_pitch_type(out_rows, "Fastball", "College")
    table_columns, table_rows, available_columns = _build_dynamic_table(
        out_rows,
        table_mode_mapped,
        split_by,
        avg_stuff_by_type,
        selected_custom_columns,
    )

    pitch_type_legend = sorted(
        {str(row.get("pitch_type") or "Undefined") for row in out_rows},
        key=lambda name: (_pitch_type_sort_rank(name), name),
    )

    chart_points = (
        [
            {
                "pitch_event_id": row.get("pitch_event_id"),
                "session_date": row.get("session_date").isoformat() if row.get("session_date") else None,
                "pitcher": str(row.get("pitcher") or ""),
                "batter": str(row.get("batter") or ""),
                "pitcherthrows": str(row.get("pitcherthrows") or ""),
                "batterside": str(row.get("batterside") or ""),
                "pitch_type": str(row.get("pitch_type") or "Undefined"),
                "pitch_call": str(row.get("pitch_call") or ""),
                "play_result": str(row.get("play_result") or ""),
                "result_label": str(row.get("result_label") or ""),
                "session_type": str(row.get("session_type_norm") or ""),
                "rel_speed": row.get("rel_speed"),
                "exit_speed": row.get("exit_speed"),
                "angle": row.get("angle"),
                "distance": row.get("distance"),
                "direction": row.get("direction"),
                "plate_side": row.get("plate_side"),
                "plate_height": row.get("plate_height"),
                "contact_position_x": row.get("contact_position_x"),
                "contact_position_y": row.get("contact_position_y"),
                "contact_position_z": row.get("contact_position_z"),
                "vertical_attack_angle": row.get("vertical_attack_angle"),
                "horizontal_attack_angle": row.get("horizontal_attack_angle"),
                "bat_speed": row.get("bat_speed"),
                "pitch_number": row.get("pitch_number"),
            }
            for row in _downsample_rows_for_chart_points(out_rows)
        ]
        if include_chart_points
        else []
    )

    response_payload = {
        "school_code": school_code,
        "hitter": hitter or None,
        "opp_pitcher": opp_pitcher or None,
        "hand": hand or None,
        "batter_side": batter_side or None,
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "total_pitches": len(out_rows),
        "selected_pitch_types": selected_pitch_types,
        "selected_zone_locations": selected_zone_locations,
        "selected_pitch_results": selected_pitch_results,
        "selected_count_filters": selected_count_filters,
        "selected_after_count_filters": selected_after_count_filters,
        "selected_bip_results": selected_bip_results,
        "table_mode": mode_raw,
        "split_by": split_by,
        "pitch_type_legend": pitch_type_legend,
        "table_columns": table_columns,
        "available_table_columns": available_columns,
        "table_rows": table_rows,
        "chart_points": chart_points,
    }
    _overview_cache_set(overview_cache_key, response_payload)
    return response_payload


@app.get("/v1/catching/filters")
def catching_filters(
    school_code: str = Query(..., min_length=1),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    session_type: Optional[str] = Query(default=None),
) -> Dict[str, Any]:
    school_code = _validate_school_code(school_code)
    _ensure_performance_indexes()
    roster = _load_school_roster(school_code)
    campers_norm = set(roster.get("campers_norm", []) or [])
    team_catcher_norm = set(roster.get("hitter_norm", []) or []) - campers_norm
    team_markers_norm = sorted(set(roster.get("team_markers_norm", []) or []))
    catchers_by_team_code: Dict[str, List[str]] = {}
    session_type_filter = _normalize_session_type_filter(session_type)
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date.")
    try:
        with get_conn() as conn, conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  MIN(session_date)::text AS min_date,
                  MAX(session_date)::text AS max_date
                FROM public.pitch_events
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                """,
                {"school_code": school_code, "team_markers_norm": team_markers_norm},
            )
            date_row = cur.fetchone() or {}

            cur.execute(
                """
                SELECT DISTINCT TRIM(catcher) AS catcher
                FROM public.pitch_events
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                  AND COALESCE(TRIM(catcher), '') <> ''
                  AND (%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)
                  AND (%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)
                  AND (
                    %(session_type_filter)s::text IS NULL
                    OR (
                      %(session_type_filter)s::text = 'Bullpen' AND
                      regexp_replace(lower(COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), '')), '\\s+', '', 'g') ~ '(bull|prac|bp)'
                    )
                    OR (
                      %(session_type_filter)s::text = 'Live' AND (
                        """ + PITCHER_TEAM_IS_MARKER_SQL + """ AND
                        """ + BATTER_TEAM_NORM_SQL + """ <> '' AND
                        (""" + BATTER_TEAM_IS_MARKER_SQL + """)
                      )
                    )
                    OR (
                      %(session_type_filter)s::text = 'Season' AND (
                        (
                          """ + PITCHER_TEAM_IS_MARKER_SQL + """ AND
                          """ + BATTER_TEAM_NORM_SQL + """ <> '' AND
                          NOT (""" + BATTER_TEAM_IS_MARKER_SQL + """)
                        )
                        OR
                        (
                          """ + BATTER_TEAM_IS_MARKER_SQL + """ AND
                          """ + PITCHER_TEAM_NORM_SQL + """ <> '' AND
                          NOT (""" + PITCHER_TEAM_IS_MARKER_SQL + """)
                        )
                      )
                    )
                  )
                ORDER BY catcher ASC
                """,
                {
                    "school_code": school_code,
                    "start_date": start_date,
                    "end_date": end_date,
                    "session_type_filter": session_type_filter,
                    "team_markers_norm": team_markers_norm,
                },
            )
            catchers = [str(row["catcher"]) for row in cur.fetchall()]
            if team_catcher_norm:
                catchers = [name for name in catchers if _normalize_name_key(name) in team_catcher_norm]

            cur.execute(
                """
                SELECT pitch_type
                FROM (
                  SELECT DISTINCT
                    """
                + PITCH_TYPE_NORMALIZE_SQL
                + """ AS pitch_type,
                    """
                + PITCH_TYPE_ORDER_SQL
                + """ AS pitch_sort
                  FROM public.pitch_events
                  WHERE school_code = %(school_code)s
                    AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                ) t
                ORDER BY t.pitch_sort ASC, t.pitch_type ASC
                """,
                {"school_code": school_code, "team_markers_norm": team_markers_norm},
            )
            pitch_types = [str(row["pitch_type"]) for row in cur.fetchall() if str(row["pitch_type"]) != "Undefined"]
            team_types: List[str]
            if school_code == "LEAGUE":
                cur.execute(_league_team_codes_sql_expr(), {"school_code": school_code})
                league_team_codes = [str(row["team_code"]) for row in cur.fetchall() if str(row.get("team_code") or "").strip()]
                team_types = ["All", *league_team_codes]
                cur.execute(_league_name_map_sql_expr("pitcherteam", "catcher"), {"school_code": school_code})
                catchers_by_team_code = {
                    str(row["team_code"]): [str(name) for name in (row.get("names") or []) if str(name).strip()]
                    for row in cur.fetchall()
                }
            else:
                team_types = ["All", school_code, "Opponents", "Campers"]
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"catching filters query failed: {exc}") from exc

    return {
        "school_code": school_code,
        "min_date": date_row.get("min_date"),
        "max_date": date_row.get("max_date"),
        "catchers": catchers,
        "team_types": team_types,
        "pitch_types": pitch_types,
        "hands": ["All", "Left", "Right"],
        "batter_sides": ["All", "Left", "Right"],
        "zone_locations": ZONE_LOCATION_CHOICES,
        "in_zone_options": ["All", "Yes", "No", "Competitive"],
        "pitch_results": PITCH_RESULT_CHOICES,
        "count_options": COUNT_CHOICES,
        "after_count_options": COUNT_CHOICES,
        "catchers_by_team_code": catchers_by_team_code,
    }


@app.get("/v1/catching/overview")
def catching_overview(
    school_code: str = Query(..., min_length=1),
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    session_type: Optional[str] = Query(default=None),
    team_type: Optional[str] = Query(default=None),
    catcher: Optional[str] = Query(default=None),
    hand: Optional[str] = Query(default=None),
    batter_side: Optional[str] = Query(default=None),
    in_zone: Optional[str] = Query(default=None),
    pitch_types: Optional[str] = Query(default=None),
    zone_locations: Optional[str] = Query(default=None),
    pitch_results: Optional[str] = Query(default=None),
    count_filter: Optional[str] = Query(default=None),
    after_count_filter: Optional[str] = Query(default=None),
    table_mode: Optional[str] = Query(default=None),
    split_by: Optional[str] = Query(default=None),
    custom_columns: Optional[str] = Query(default=None),
    hm_results: Optional[str] = Query(default=None),
    velo_min: Optional[str] = Query(default=None),
    velo_max: Optional[str] = Query(default=None),
    pc_min: Optional[str] = Query(default=None),
    pc_max: Optional[str] = Query(default=None),
    include_chart_points: bool = Query(default=True),
) -> Dict[str, Any]:
    school_code = _validate_school_code(school_code)
    _ensure_performance_indexes()
    roster = _load_school_roster(school_code)
    campers_norm = set(roster.get("campers_norm", []) or [])
    hitter_norm = set(roster.get("hitter_norm", []) or [])
    team_norm = set(hitter_norm - campers_norm)
    team_markers_norm = set(roster.get("team_markers_norm", []) or [])
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=400, detail="start_date must be <= end_date.")

    selected_catcher_keys = _name_filter_keys(_parse_name_list(catcher))
    team_type_value = (team_type or "").strip() or "All"
    use_team_filter = team_type_value not in {"", "All"}
    selected_in_zone = _parse_csv_list(in_zone)
    selected_pitch_types = _valid_pitch_types(_parse_csv_list(pitch_types))
    selected_zone_locations = _parse_csv_list(zone_locations)
    selected_pitch_results = _parse_csv_list(pitch_results)
    selected_count_filters = _parse_csv_list(count_filter)
    selected_after_count_filters = _parse_csv_list(after_count_filter)
    selected_hm_results = _parse_csv_list(hm_results)
    selected_custom_columns = _parse_csv_list(custom_columns)
    session_type_filter = _normalize_session_type_filter(session_type)
    parsed_velo_min = _parse_optional_float(velo_min, "velo_min")
    parsed_velo_max = _parse_optional_float(velo_max, "velo_max")
    parsed_pc_min = _parse_optional_int(pc_min, "pc_min")
    parsed_pc_max = _parse_optional_int(pc_max, "pc_max")
    mode_raw = (table_mode or "Catching Data").strip() or "Catching Data"
    if mode_raw == "Data":
        mode_raw = "Catching Data"
    split_by_raw = (split_by or "Pitch Types").strip() or "Pitch Types"
    overview_cache_key = _overview_cache_key(
        "catching_overview",
        school_code,
        {
            "school_code": school_code,
            "start_date": start_date,
            "end_date": end_date,
            "session_type": session_type_filter,
            "team_type": team_type_value,
            "catcher": sorted(selected_catcher_keys),
            "hand": hand,
            "batter_side": batter_side,
            "in_zone": selected_in_zone,
            "pitch_types": selected_pitch_types,
            "zone_locations": selected_zone_locations,
            "pitch_results": selected_pitch_results,
            "count_filter": selected_count_filters,
            "after_count_filter": selected_after_count_filters,
            "table_mode": mode_raw,
            "split_by": split_by_raw,
            "custom_columns": selected_custom_columns,
            "hm_results": selected_hm_results,
            "velo_min": parsed_velo_min,
            "velo_max": parsed_velo_max,
            "pc_min": parsed_pc_min,
            "pc_max": parsed_pc_max,
            "include_chart_points": include_chart_points,
        },
    )
    cached_overview = _overview_cache_get(overview_cache_key)
    if cached_overview is not None:
        return cached_overview
    need_prev_counts = bool(selected_after_count_filters) or (split_by_raw == "After Count")
    need_pitch_number = parsed_pc_min is not None or parsed_pc_max is not None

    def _catch_bucket_label(row: Dict[str, Any]) -> str:
        ps = row.get("plate_side")
        ph = row.get("plate_height")
        if not _is_num(ps) or not _is_num(ph):
            return "Unknown"
        psf = float(ps)
        phf = float(ph)
        lefty = _norm_hand(row.get("pitcherthrows")) == "Left"
        upper = phf >= ZONE_MID_Y
        glove_half = psf >= ZONE_MID_X if lefty else psf <= ZONE_MID_X
        if upper and glove_half:
            return "Upper Half, Glove Side Half"
        if upper and not glove_half:
            return "Upper Half, Arm Side Half"
        if (not upper) and glove_half:
            return "Bottom Half, Glove Side Half"
        return "Bottom Half, Arm Side Half"

    try:
        with get_conn() as conn, conn.cursor() as cur:
            prev_balls_sql = (
                "LAG((regexp_match(COALESCE(balls::text, ''), '[-+]?[0-9]+'))[1]::int) OVER (ORDER BY session_date, COALESCE(created_at, NOW()), id) AS prev_balls"
                if need_prev_counts
                else "NULL::int AS prev_balls"
            )
            prev_strikes_sql = (
                "LAG((regexp_match(COALESCE(strikes::text, ''), '[-+]?[0-9]+'))[1]::int) OVER (ORDER BY session_date, COALESCE(created_at, NOW()), id) AS prev_strikes"
                if need_prev_counts
                else "NULL::int AS prev_strikes"
            )
            pitch_number_sql = (
                "ROW_NUMBER() OVER (ORDER BY session_date, COALESCE(created_at, NOW()), id) AS pitch_number"
                if need_pitch_number
                else "NULL::int AS pitch_number"
            )
            cur.execute(
                (
                """
                SELECT
                  id AS pitch_event_id,
                  session_date,
                  COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), 'Unknown') AS session_type_norm,
                  COALESCE(NULLIF(TRIM(catcher), ''), '') AS catcher,
                  COALESCE(NULLIF(TRIM(pitcher), ''), 'Unknown Pitcher') AS pitcher,
                  COALESCE(NULLIF(TRIM(batter), ''), '') AS batter,
                  COALESCE(NULLIF(TRIM(pitcherteam), ''), '') AS pitcher_team_code,
                  COALESCE(NULLIF(TRIM(batterteam), ''), '') AS batter_team_code,
                  COALESCE(NULLIF(TRIM(hometeam), ''), '') AS home_team_code,
                  COALESCE(NULLIF(TRIM(awayteam), ''), '') AS away_team_code,
                  COALESCE(NULLIF(TRIM(pitcherthrows), ''), '') AS pitcherthrows,
                  COALESCE(NULLIF(TRIM(batterside), ''), '') AS batterside,
                  """
                + PITCH_TYPE_NORMALIZE_SQL
                + """ AS pitch_type,
                  COALESCE(NULLIF(TRIM(pitchcall), ''), '') AS pitch_call,
                  COALESCE(NULLIF(TRIM(to_jsonb(pe)->>'KorBB'), ''), NULLIF(TRIM(to_jsonb(pe)->>'korbb'), ''), '') AS korbb,
                  COALESCE(NULLIF(TRIM(playresult), ''), '') AS play_result,
                  COALESCE(NULLIF(TRIM(to_jsonb(pe)->>'TaggedHitType'), ''), NULLIF(TRIM(to_jsonb(pe)->>'taggedhittype'), ''), '') AS tagged_hit_type,
                  (regexp_match(COALESCE(relspeed, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_speed,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'SpinRate', to_jsonb(pe)->>'spinrate', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_rate,
                  COALESCE(NULLIF(TRIM(to_jsonb(pe)->>'ReleaseTilt'), ''), NULLIF(TRIM(to_jsonb(pe)->>'releasetilt'), ''), NULLIF(TRIM(to_jsonb(pe)->>'Tilt'), ''), NULLIF(TRIM(to_jsonb(pe)->>'tilt'), ''), '') AS release_tilt,
                  COALESCE(NULLIF(TRIM(to_jsonb(pe)->>'BreakTilt'), ''), NULLIF(TRIM(to_jsonb(pe)->>'breaktilt'), ''), NULLIF(TRIM(to_jsonb(pe)->>'Tilt'), ''), NULLIF(TRIM(to_jsonb(pe)->>'tilt'), ''), '') AS break_tilt,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'SpinEfficiency', to_jsonb(pe)->>'spinefficiency', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_eff,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'RelHeight', to_jsonb(pe)->>'relheight', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_height,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'RelSide', to_jsonb(pe)->>'relside', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS rel_side,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'Extension', to_jsonb(pe)->>'extension', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ext_value,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'VertApprAngle', to_jsonb(pe)->>'vertapprangle', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS vaa,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'HorzApprAngle', to_jsonb(pe)->>'horzapprangle', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS haa,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'ExitSpeed', to_jsonb(pe)->>'exitspeed', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS exit_speed,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'Angle', to_jsonb(pe)->>'angle', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS angle,
                  (regexp_match(COALESCE(platelocside, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_side,
                  (regexp_match(COALESCE(platelocheight, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS plate_height,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'InducedVertBreak', to_jsonb(pe)->>'inducedvertbreak', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS ivb,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'HorzBreak', to_jsonb(pe)->>'horzbreak', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS hb,
                  CASE WHEN UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'L' THEN TRUE ELSE FALSE END AS is_lefty,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'Outs', to_jsonb(pe)->>'outs', ''), '[-+]?[0-9]+'))[1]::int AS outs_num,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'OutsOnPlay', to_jsonb(pe)->>'outs_on_play', to_jsonb(pe)->>'outsonplay', ''), '[-+]?[0-9]+'))[1]::int AS outs_on_play_num,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'ThrowSpeed', to_jsonb(pe)->>'throwspeed', to_jsonb(pe)->>'throw_speed', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS throw_speed,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'ExchangeTime', to_jsonb(pe)->>'exchangetime', to_jsonb(pe)->>'exchange_time', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS exchange_time,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'PopTime', to_jsonb(pe)->>'poptime', to_jsonb(pe)->>'pop_time', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS pop_time,
                  COALESCE(NULLIF(TRIM(COALESCE(to_jsonb(pe)->>'TargetBase', to_jsonb(pe)->>'targetbase', to_jsonb(pe)->>'target_base', '')), ''), '2B') AS target_base,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'BasePositionX', to_jsonb(pe)->>'basepositionx', to_jsonb(pe)->>'ThrowEndX', to_jsonb(pe)->>'throwendx', to_jsonb(pe)->>'ArrivalX', to_jsonb(pe)->>'arrivalx', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS base_x,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'BasePositionY', to_jsonb(pe)->>'basepositiony', to_jsonb(pe)->>'ThrowEndY', to_jsonb(pe)->>'throwendy', to_jsonb(pe)->>'ArrivalY', to_jsonb(pe)->>'arrivaly', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS base_y,
                  (regexp_match(COALESCE(to_jsonb(pe)->>'BasePositionZ', to_jsonb(pe)->>'basepositionz', to_jsonb(pe)->>'ThrowEndZ', to_jsonb(pe)->>'throwendz', to_jsonb(pe)->>'ArrivalZ', to_jsonb(pe)->>'arrivalz', ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS base_z,
                  (regexp_match(COALESCE(balls::text, ''), '[-+]?[0-9]+'))[1]::int AS balls_num,
                  (regexp_match(COALESCE(strikes::text, ''), '[-+]?[0-9]+'))[1]::int AS strikes_num,
                  __PREV_BALLS_SQL__,
                  __PREV_STRIKES_SQL__,
                  __PITCH_NUMBER_SQL__
                FROM public.pitch_events pe
                WHERE school_code = %(school_code)s
                  AND """ + SCHOOL_RELEVANT_TEAM_SQL + """
                  AND (""" + PITCH_TYPE_NORMALIZE_SQL + """) <> 'Undefined'
                  AND (%(start_date)s::date IS NULL OR session_date >= %(start_date)s::date)
                  AND (%(end_date)s::date IS NULL OR session_date <= %(end_date)s::date)
                  AND (%(catcher_count)s::int = 0 OR """ + CATCHER_NAME_NORM_SQL + """ = ANY(%(catchers_norm)s::text[]))
                  AND (
                    %(hand_filter)s::text IS NULL OR %(hand_filter)s::text = '' OR %(hand_filter)s::text = 'All' OR
                    (%(hand_filter)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'L') OR
                    (%(hand_filter)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(pitcherthrows), ''), ''), 1)) = 'R')
                  )
                  AND (
                    %(batter_side_filter)s::text IS NULL OR %(batter_side_filter)s::text = '' OR %(batter_side_filter)s::text = 'All' OR
                    (%(batter_side_filter)s::text = 'Left' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'L') OR
                    (%(batter_side_filter)s::text = 'Right' AND UPPER(LEFT(COALESCE(NULLIF(TRIM(batterside), ''), ''), 1)) = 'R')
                  )
                  AND (%(pitch_types_count)s::int = 0 OR """ + PITCH_TYPE_NORMALIZE_SQL + """ = ANY(%(pitch_types)s::text[]))
                ORDER BY session_date, COALESCE(created_at, NOW()), id
                """
                ).replace("__PREV_BALLS_SQL__", prev_balls_sql).replace("__PREV_STRIKES_SQL__", prev_strikes_sql).replace("__PITCH_NUMBER_SQL__", pitch_number_sql),
                {
                    "school_code": school_code,
                    "start_date": start_date,
                    "end_date": end_date,
                    "team_markers_norm": sorted(team_markers_norm),
                    "catcher_count": len(selected_catcher_keys),
                    "catchers_norm": sorted(selected_catcher_keys),
                    "hand_filter": hand,
                    "batter_side_filter": batter_side,
                    "pitch_types_count": len(selected_pitch_types),
                    "pitch_types": selected_pitch_types,
                },
            )
            rows = [dict(row) for row in cur.fetchall() if str(row.get("pitch_type") or "") != "Undefined"]
            _annotate_times_through_order(rows)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"catching overview query failed: {exc}") from exc

    filtered: List[Dict[str, Any]] = []
    for row in rows:
        if use_team_filter:
            if school_code == "LEAGUE":
                selected_code = _normalize_team_code(team_type_value)
                row_code = _normalize_team_code(str(row.get("pitcher_team_code") or ""))
                if not selected_code or row_code != selected_code:
                    continue
            else:
                catcher_key = _normalize_name_key(str(row.get("catcher") or ""))
                pitcher_team_code = _normalize_team_code(str(row.get("pitcher_team_code") or ""))
                batter_team_code = _normalize_team_code(str(row.get("batter_team_code") or ""))
                pitcher_is_marker = pitcher_team_code in team_markers_norm if pitcher_team_code else False
                batter_is_marker = batter_team_code in team_markers_norm if batter_team_code else False
                # Catching team/opponent split is driven by pitcherteam/batterteam markers.
                is_pcu_blank_team_row = (
                    school_code == "PCU"
                    and not pitcher_team_code
                    and not batter_team_code
                    and bool(catcher_key)
                    and catcher_key in (team_norm | campers_norm)
                )
                is_team_catching_row = (pitcher_is_marker and not batter_is_marker) or is_pcu_blank_team_row
                is_opponent_catching_row = batter_is_marker and bool(pitcher_team_code) and not pitcher_is_marker

                if team_type_value == "Opponents":
                    row_team_bucket = "Opponents" if is_opponent_catching_row else None
                elif team_type_value == "Campers":
                    row_team_bucket = "Campers" if (catcher_key in campers_norm and is_team_catching_row) else None
                elif team_type_value == school_code:
                    if catcher_key in campers_norm:
                        row_team_bucket = "Campers" if is_team_catching_row else None
                    else:
                        row_team_bucket = school_code if is_team_catching_row else None
                else:
                    row_team_bucket = None
                if row_team_bucket != team_type_value:
                    continue
        if selected_catcher_keys and _normalize_name_key(str(row.get("catcher") or "")) not in selected_catcher_keys:
            continue
        row_session_bucket = _session_bucket_for_row(row, team_markers_norm)
        if session_type_filter and row_session_bucket != session_type_filter:
            continue
        if hand and hand != "All" and _norm_hand(row.get("pitcherthrows")) != hand:
            continue
        if batter_side and batter_side != "All" and _norm_hand(row.get("batterside")) != batter_side:
            continue
        if selected_pitch_types and str(row.get("pitch_type") or "") not in selected_pitch_types:
            continue
        if selected_zone_locations and not any(_zone_location_match(tok, row) for tok in selected_zone_locations):
            continue
        if selected_in_zone:
            inz = _in_zone_label(row.get("plate_side"), row.get("plate_height"))
            if not any(tok == inz for tok in selected_in_zone):
                continue
        result_label = _hit_result_label(row.get("pitch_call"), row.get("play_result"))
        if not _pitch_result_filter_match(selected_pitch_results, result_label, row.get("play_result")):
            continue
        if selected_count_filters and not any(_count_token_match(tok, row.get("balls_num"), row.get("strikes_num")) for tok in selected_count_filters):
            continue
        if selected_after_count_filters and not any(_count_token_match(tok, row.get("prev_balls"), row.get("prev_strikes")) for tok in selected_after_count_filters):
            continue
        if parsed_velo_min is not None and (not _is_num(row.get("rel_speed")) or float(row.get("rel_speed")) < parsed_velo_min):
            continue
        if parsed_velo_max is not None and (not _is_num(row.get("rel_speed")) or float(row.get("rel_speed")) > parsed_velo_max):
            continue
        if parsed_pc_min is not None and (not _is_num(row.get("pitch_number")) or int(float(row.get("pitch_number"))) < parsed_pc_min):
            continue
        if parsed_pc_max is not None and (not _is_num(row.get("pitch_number")) or int(float(row.get("pitch_number"))) > parsed_pc_max):
            continue
        row["result_label"] = result_label
        filtered.append(row)

    takes = [r for r in filtered if str(r.get("pitch_call") or "") in {"StrikeCalled", "BallCalled", "BallinDirt"}]
    bucket_stats: Dict[str, Dict[str, float]] = {}
    for r in takes:
        b = _catch_bucket_label(r)
        if b not in bucket_stats:
            bucket_stats[b] = {"n": 0.0, "cs": 0.0}
        bucket_stats[b]["n"] += 1.0
        if str(r.get("pitch_call") or "") == "StrikeCalled":
            bucket_stats[b]["cs"] += 1.0
    overall_rate = None
    if bucket_stats:
        tot_n = sum(v["n"] for v in bucket_stats.values())
        tot_cs = sum(v["cs"] for v in bucket_stats.values())
        overall_rate = (tot_cs / tot_n) if tot_n > 0 else None
    bucket_rate: Dict[str, float] = {}
    for k, v in bucket_stats.items():
        bucket_rate[k] = (v["cs"] / v["n"]) if v["n"] > 0 else (overall_rate or 0.0)

    def _split_label(row: Dict[str, Any]) -> str:
        if split_by_raw == "Session Type":
            return str(row.get("session_type_norm") or "Unknown")
        return _split_key_from_row(row, split_by_raw)

    throws = [r for r in filtered if _is_num(r.get("pop_time")) and _is_num(r.get("throw_speed")) and float(r.get("throw_speed")) >= 70.0]
    grouped_filtered: Dict[str, List[Dict[str, Any]]] = {}
    for r in filtered:
        grp = _split_label(r)
        grouped_filtered.setdefault(grp, []).append(r)
    grouped_throws: Dict[str, List[Dict[str, Any]]] = {}
    for r in throws:
        grp = _split_label(r)
        grouped_throws.setdefault(grp, []).append(r)

    grouped_takes: Dict[str, List[Dict[str, Any]]] = {}
    for r in takes:
        grp = _split_label(r)
        grouped_takes.setdefault(grp, []).append(r)

    sl_by_group: Dict[str, Optional[float]] = {}
    for grp_name in set(grouped_throws.keys()) | set(grouped_takes.keys()):
        grp_takes = grouped_takes.get(grp_name, [])
        if not grp_takes:
            sl_by_group[grp_name] = None
            continue
        obs = sum(1 for r in grp_takes if str(r.get("pitch_call") or "") == "StrikeCalled") / float(len(grp_takes))
        exp_num = 0.0
        exp_den = 0.0
        for r in grp_takes:
            b = _catch_bucket_label(r)
            exp_num += bucket_rate.get(b, overall_rate or 0.0)
            exp_den += 1.0
        exp = (exp_num / exp_den) if exp_den > 0 else None
        sl_by_group[grp_name] = round(100.0 * obs / exp, 1) if (exp is not None and exp > 0) else None

    def _group_sort_key(name: str) -> Any:
        if split_by_raw == "Pitch Types":
            return (_pitch_type_sort_rank(name), name)
        if split_by_raw in {"Pitcher Hand", "Batter Hand"}:
            order = {"Right": 0, "Left": 1, "Unknown": 9}
            return (order.get(name, 8), name)
        if split_by_raw in {"Count", "After Count"}:
            if re.match(r"^\d-\d$", name):
                b, s = name.split("-", 1)
                return (0, int(b), int(s))
            return (1, name)
        if split_by_raw == "Times Through Order":
            order = {"1": 0, "2": 1, "3": 2, "4+": 3}
            return (order.get(name, 9), name)
        return (0, name)

    table_rows: List[Dict[str, Any]] = []
    for grp_name in sorted(grouped_filtered.keys(), key=_group_sort_key):
        pitch_rows = grouped_filtered[grp_name]
        throw_rows = grouped_throws.get(grp_name, [])
        velo_vals = [float(r["throw_speed"]) for r in throw_rows if _is_num(r.get("throw_speed"))]
        exch_vals = [float(r["exchange_time"]) for r in throw_rows if _is_num(r.get("exchange_time"))]
        pop_vals = [float(r["pop_time"]) for r in throw_rows if _is_num(r.get("pop_time"))]
        table_rows.append(
            {
                "Split": grp_name,
                "#": len(pitch_rows),
                "# Throws": len(throw_rows),
                "Velo": round(sum(velo_vals) / len(velo_vals), 1) if velo_vals else None,
                "ExchangeTime": round(sum(exch_vals) / len(exch_vals), 2) if exch_vals else None,
                "PopTime": round(sum(pop_vals) / len(pop_vals), 2) if pop_vals else None,
                "SL+": sl_by_group.get(grp_name),
            }
        )
    if grouped_filtered:
        all_rows = [row for group_rows in grouped_filtered.values() for row in group_rows]
        all_throw_rows = [row for group_rows in grouped_throws.values() for row in group_rows]
        all_velo_vals = [float(r["throw_speed"]) for r in all_throw_rows if _is_num(r.get("throw_speed"))]
        all_exch_vals = [float(r["exchange_time"]) for r in all_throw_rows if _is_num(r.get("exchange_time"))]
        all_pop_vals = [float(r["pop_time"]) for r in all_throw_rows if _is_num(r.get("pop_time"))]
        all_takes = [row for group_rows in grouped_takes.values() for row in group_rows]
        all_sl: Optional[float] = None
        if all_takes:
            obs = sum(1 for r in all_takes if str(r.get("pitch_call") or "") == "StrikeCalled") / float(len(all_takes))
            exp_num = 0.0
            exp_den = 0.0
            for r in all_takes:
                b = _catch_bucket_label(r)
                exp_num += bucket_rate.get(b, overall_rate or 0.0)
                exp_den += 1.0
            exp = (exp_num / exp_den) if exp_den > 0 else None
            all_sl = round(100.0 * obs / exp, 1) if (exp is not None and exp > 0) else None
        table_rows.append(
            {
                "Split": "All",
                "#": len(all_rows),
                "# Throws": len(all_throw_rows),
                "Velo": round(sum(all_velo_vals) / len(all_velo_vals), 1) if all_velo_vals else None,
                "ExchangeTime": round(sum(all_exch_vals) / len(all_exch_vals), 2) if all_exch_vals else None,
                "PopTime": round(sum(all_pop_vals) / len(all_pop_vals), 2) if all_pop_vals else None,
                "SL+": all_sl,
            }
        )

    # Build Stuff+ map for Catching when using Pitching-style table modes.
    stuff_rows_for_calc: List[Dict[str, Any]] = []
    for row in filtered:
        hb_value = row.get("hb")
        is_lefty = bool(row.get("is_lefty"))
        row_copy = dict(row)
        row_copy["hb_adj"] = hb_value if is_lefty else (-hb_value if _is_num(hb_value) else None)
        stuff_rows_for_calc.append(row_copy)
    _, avg_stuff_by_pitch_type = _compute_stuff_by_pitch_type(
        stuff_rows_for_calc,
        "Fastball",
        "College",
    )

    pitching_modes = {
        "Stuff",
        "Process",
        "Results",
        "Bullpen",
        "Live",
        "Usage",
        "Raw Data",
        "Batted Ball Data",
        "Swing Decisions",
        "Custom",
    }
    if mode_raw in pitching_modes:
        table_columns, table_rows, available_columns = _build_dynamic_table(
            filtered,
            mode_raw,
            split_by_raw,
            avg_stuff_by_pitch_type,
            selected_custom_columns,
        )
    else:
        if mode_raw == "Custom":
            mode_raw = "Catching Data"
        table_columns = ["Split", "#", "# Throws", "Velo", "ExchangeTime", "PopTime", "SL+"]
        available_columns = ["#", "# Throws", "Velo", "ExchangeTime", "PopTime", "SL+"]

    chart_points = (
        [
            {
                "pitch_event_id": row.get("pitch_event_id"),
                "session_date": row.get("session_date").isoformat() if row.get("session_date") else None,
                "session_type": str(row.get("session_type_norm") or ""),
                "catcher": str(row.get("catcher") or ""),
                "pitcher": str(row.get("pitcher") or ""),
                "batter": str(row.get("batter") or ""),
                "pitcherthrows": str(row.get("pitcherthrows") or ""),
                "batterside": str(row.get("batterside") or ""),
                "pitch_type": str(row.get("pitch_type") or "Undefined"),
                "pitch_call": str(row.get("pitch_call") or ""),
                "play_result": str(row.get("play_result") or ""),
                "result_label": str(row.get("result_label") or ""),
                "rel_speed": row.get("rel_speed"),
                "plate_side": row.get("plate_side"),
                "plate_height": row.get("plate_height"),
                "throw_speed": row.get("throw_speed"),
                "exchange_time": row.get("exchange_time"),
                "pop_time": row.get("pop_time"),
                "target_base": row.get("target_base"),
                "base_x": row.get("base_x"),
                "base_y": row.get("base_y"),
                "base_z": row.get("base_z"),
                "pitch_number": row.get("pitch_number"),
            }
            for row in _downsample_rows_for_chart_points(filtered)
        ]
        if include_chart_points
        else []
    )

    pitch_type_legend = sorted(
        {str(row.get("pitch_type") or "Undefined") for row in filtered},
        key=lambda name: (_pitch_type_sort_rank(name), name),
    )

    if selected_hm_results and "All" not in selected_hm_results:
        hm_points = [p for p in chart_points if str(p.get("result_label") or "") in selected_hm_results]
    else:
        hm_points = chart_points

    response_payload = {
        "school_code": school_code,
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "session_type": session_type or None,
        "catcher": catcher or None,
        "hand": hand or None,
        "batter_side": batter_side or None,
        "total_pitches": len(filtered),
        "table_mode": mode_raw,
        "split_by": split_by_raw,
        "selected_count_filters": selected_count_filters,
        "selected_after_count_filters": selected_after_count_filters,
        "table_columns": table_columns,
        "available_table_columns": available_columns,
        "table_rows": table_rows,
        "pitch_type_legend": pitch_type_legend,
        "chart_points": chart_points,
        "heatmap_points": hm_points,
    }
    _overview_cache_set(overview_cache_key, response_payload)
    return response_payload


@app.post("/v1/pitching/pitch-edit", response_model=PitchEditResponse)
def pitching_pitch_edit(payload: PitchEditRequest) -> PitchEditResponse:
    school_code = _validate_school_code(payload.school_code)
    pitch_type = (payload.pitch_type or "").strip()
    pitcher = (payload.pitcher or "").strip()
    if not pitch_type:
        raise HTTPException(status_code=400, detail="pitch_type is required.")
    if not pitcher:
        raise HTTPException(status_code=400, detail="pitcher is required.")

    pitch_ids = payload.pitch_event_ids or []

    try:
        with get_conn() as conn, conn.cursor() as cur:
            _ensure_pitch_event_edits_table(cur)
            cur.execute(
                """
                UPDATE public.pitch_events
                   SET taggedpitchtype = %(pitch_type)s,
                       pitcher = %(pitcher)s
                 WHERE id = ANY(%(pitch_event_ids)s::int[])
                   AND school_code = %(school_code)s
                """,
                {
                    "pitch_type": pitch_type,
                    "pitcher": pitcher,
                    "pitch_event_ids": pitch_ids,
                    "school_code": school_code,
                },
            )
            if cur.rowcount <= 0:
                raise HTTPException(status_code=404, detail="Pitch event not found for this school_code.")
            cur.execute(
                """
                INSERT INTO public.pitch_event_edits (school_code, pitch_event_id, pitch_type, pitcher)
                SELECT %(school_code)s, pitch_id::int, %(pitch_type)s, %(pitcher)s
                FROM unnest(%(pitch_event_ids)s::int[]) AS pitch_id
                ON CONFLICT (school_code, pitch_event_id, pitch_type, pitcher) DO NOTHING
                """,
                {
                    "school_code": school_code,
                    "pitch_type": pitch_type,
                    "pitcher": pitcher,
                    "pitch_event_ids": pitch_ids,
                },
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"pitch edit failed: {exc}") from exc

    _overview_cache_invalidate_school(school_code)
    return PitchEditResponse(ok=True, updated_count=len(pitch_ids))


@app.get("/v1/pitching/pitch-edit-count", response_model=PitchEditCountResponse)
def pitching_pitch_edit_count(school_code: str = Query(..., min_length=2, max_length=32)) -> PitchEditCountResponse:
    school_code = _validate_school_code(school_code)
    _sync_modifications_into_pitch_events(school_code)
    mod_namespaces = _mod_namespaces_for_school(school_code)
    try:
        with get_conn() as conn, conn.cursor() as cur:
            _ensure_pitch_event_edits_table(cur)
            cur.execute(
                """
                SELECT to_regclass('public.modifications')::text AS table_name
                """,
            )
            reg = cur.fetchone() or {}
            has_modifications_table = bool(reg.get("table_name"))

            if has_modifications_table and mod_namespaces:
                cur.execute(
                    """
                    WITH manual AS (
                      SELECT DISTINCT pe.pitch_event_id
                      FROM public.pitch_event_edits pe
                      WHERE pe.school_code = %(school_code)s
                    ),
                    mod AS (
                      SELECT DISTINCT pe.id AS pitch_event_id
                      FROM public.pitch_events pe
                      JOIN (
                        SELECT DISTINCT ON (btrim(m.pitch_key))
                          btrim(m.pitch_key) AS pitch_key
                        FROM public.modifications m
                        WHERE lower(btrim(COALESCE(m.namespace, ''))) = ANY(%(mod_namespaces)s::text[])
                          AND COALESCE(m.is_deleted, 0) = 0
                          AND NULLIF(btrim(COALESCE(m.pitch_key, '')), '') IS NOT NULL
                        ORDER BY btrim(m.pitch_key), COALESCE(m.modified_at, m.created_at) DESC, m.id DESC
                      ) m
                        ON btrim(COALESCE(pe.pitch_key, '')) = m.pitch_key
                      WHERE pe.school_code = %(school_code)s
                    )
                    SELECT COUNT(*)::int AS edit_count
                    FROM (
                      SELECT pitch_event_id FROM manual
                      UNION
                      SELECT pitch_event_id FROM mod
                    ) u
                    """,
                    {
                        "school_code": school_code,
                        "mod_namespaces": mod_namespaces,
                    },
                )
                row = cur.fetchone() or {}
                edit_count = int(row.get("edit_count") or 0)
            else:
                cur.execute(
                    """
                    SELECT COUNT(DISTINCT pe.pitch_event_id)::int AS edit_count
                    FROM public.pitch_event_edits pe
                    WHERE pe.school_code = %(school_code)s
                    """,
                    {"school_code": school_code},
                )
                row = cur.fetchone() or {}
                edit_count = int(row.get("edit_count") or 0)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"pitch edit count failed: {exc}") from exc

    return PitchEditCountResponse(school_code=school_code, edit_count=edit_count)
