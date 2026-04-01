from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, model_validator


class PitchingFiltersResponse(BaseModel):
    school_code: str
    min_date: Optional[str]
    max_date: Optional[str]
    pitchers: List[str]
    team_types: List[str]
    opp_hitters: List[str]
    with_video_options: List[str]
    break_lines_options: List[str]
    stuff_level_options: List[str]
    stuff_base_options: List[str]
    hands: List[str]
    batter_sides: List[str]
    session_types: List[str]
    pitch_types: List[str]
    zone_locations: List[str]
    in_zone_options: List[str]
    qp_location_options: List[str]
    pitch_results: List[str]
    count_options: List[str]
    after_count_options: List[str]
    level_options: Optional[List[str]] = None
    pitchers_by_team_code: Optional[Dict[str, List[str]]] = None
    opp_hitters_by_team_code: Optional[Dict[str, List[str]]] = None


class PitchTypeSummaryRow(BaseModel):
    pitch_type: str
    pitches: int
    usage_pct: float
    avg_velo: Optional[float]
    max_velo: Optional[float]
    avg_spin: Optional[float]
    avg_ivb: Optional[float]
    avg_hb: Optional[float]
    avg_stuff: Optional[float]


class PitchingOverviewResponse(BaseModel):
    school_code: str
    pitcher: Optional[str]
    team_type: Optional[str]
    opp_hitter: Optional[str]
    with_video: Optional[str]
    break_lines: Optional[str]
    stuff_level: Optional[str]
    stuff_base: Optional[str]
    hand: Optional[str]
    batter_side: Optional[str]
    in_zone: Optional[str]
    qp_locations: Optional[str]
    session_type: Optional[str]
    table_mode: Optional[str]
    split_by: Optional[str]
    selected_zone_locations: List[str]
    selected_pitch_types: List[str]
    selected_pitch_results: List[str]
    selected_count_filters: List[str]
    selected_after_count_filters: List[str]
    start_date: Optional[str]
    end_date: Optional[str]
    total_pitches: int
    avg_velo: Optional[float]
    max_velo: Optional[float]
    avg_spin: Optional[float]
    avg_ivb: Optional[float]
    avg_hb: Optional[float]
    avg_stuff: Optional[float]
    zone_pct: Optional[float]
    strike_pct: Optional[float]
    whiff_pct: Optional[float]
    table_columns: List[str]
    available_table_columns: List[str]
    table_rows: List[Dict[str, Any]]
    row_pitches_by_key: Dict[str, List[Dict[str, Any]]]
    pitch_types: List[PitchTypeSummaryRow]
    chart_points: List[Dict[str, Any]]
    heatmap_points: List[Dict[str, Any]] = []
    trend_rows: List[Dict[str, Any]] = []

class PitchingAbReportResponse(BaseModel):
    school_code: str
    pitcher: str
    selected_game_key: Optional[str]
    selected_game_date: Optional[str]
    available_games: List[Dict[str, str]]
    pitch_type_legend: List[str]
    pa_groups: List[Dict[str, Any]]
    total_pa: int


class HittingAbReportResponse(BaseModel):
    school_code: str
    hitter: str
    selected_game_key: Optional[str]
    selected_game_date: Optional[str]
    available_games: List[Dict[str, str]]
    pitch_type_legend: List[str]
    pa_groups: List[Dict[str, Any]]
    total_pa: int


class PitchEditRequest(BaseModel):
    school_code: str
    pitch_event_id: Optional[int] = None
    pitch_event_ids: Optional[List[int]] = None
    pitch_type: str
    pitcher: str

    @model_validator(mode="after")
    def validate_pitch_keys(self) -> "PitchEditRequest":
        ids = [v for v in (self.pitch_event_ids or []) if isinstance(v, int) and v > 0]
        if self.pitch_event_id and self.pitch_event_id > 0:
            ids.append(self.pitch_event_id)
        if not ids:
            raise ValueError("pitch_event_id or pitch_event_ids is required")
        self.pitch_event_ids = sorted(set(ids))
        return self


class PitchEditResponse(BaseModel):
    ok: bool
    updated_count: int


class PitchEditCountResponse(BaseModel):
    school_code: str
    edit_count: int


class ManualVelocityEntry(BaseModel):
    id: str
    school_code: str
    entry_date: str
    pitcher: str
    throw_type: str
    plyo_drill: str
    ball_weight_oz: float
    velocity_mph: float
    notes: str
    created_at: str


class ManualVelocityListResponse(BaseModel):
    school_code: str
    entries: List[ManualVelocityEntry]


class ManualVelocityCreateRequest(BaseModel):
    school_code: str
    entry_date: Optional[str] = None
    pitcher: str
    throw_type: str
    plyo_drill: Optional[str] = ""
    ball_weight_oz: float
    velocities: List[float]
    notes: Optional[str] = ""


class ManualVelocityCreateResponse(BaseModel):
    ok: bool
    created_count: int
    entries: List[ManualVelocityEntry]


class ManualVelocityDeleteResponse(BaseModel):
    ok: bool
    deleted_id: str
