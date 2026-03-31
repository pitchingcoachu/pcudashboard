#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any, Dict, Iterable, List, Optional, Tuple

import psycopg


API_BASE = "https://statsapi.mlb.com/api/v1"
API_BASE_GAME_FEED = "https://statsapi.mlb.com/api/v1.1"


def _require_env(name: str) -> str:
    value = (os.getenv(name) or "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _with_system_sslrootcert(db_url: str) -> str:
    value = (db_url or "").strip()
    if not value:
        return value
    parsed = urllib.parse.urlsplit(value)
    query = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
    # Local macOS Python cert stores can fail verify-full in some setups.
    # Force encrypted transport without certificate file requirements.
    query["sslmode"] = ["require"]
    query.pop("sslrootcert", None)
    new_query = urllib.parse.urlencode(query, doseq=True)
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, new_query, parsed.fragment))


def _json_get(url: str, timeout: int = 60) -> Dict[str, Any]:
    req = urllib.request.Request(url, headers={"User-Agent": "pcu-pro-sync/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _daterange(start: date, end: date) -> Iterable[date]:
    curr = start
    while curr <= end:
        yield curr
        curr += timedelta(days=1)


def _norm_pitch_type(code: str, desc: str) -> str:
    c = (code or "").strip().upper()
    d = (desc or "").strip().lower()
    mapping = {
        "FF": "Fastball",
        "FA": "Fastball",
        "SI": "Sinker",
        "FT": "Sinker",
        "CH": "ChangeUp",
        "ST": "Sweeper",
        "SP": "Splitter",
        "FS": "Splitter",
        "CU": "Curveball",
        "KC": "Curveball",
        "FC": "Cutter",
        "SL": "Slider",
        "KN": "Knuckleball",
    }
    if c in mapping:
        return mapping[c]
    if "sweeper" in d:
        return "Sweeper"
    if "curve" in d:
        return "Curveball"
    if "slider" in d:
        return "Slider"
    if "change" in d:
        return "ChangeUp"
    if "split" in d:
        return "Splitter"
    if "cutter" in d:
        return "Cutter"
    if "sinker" in d or "two-seam" in d:
        return "Sinker"
    if "fastball" in d or "four-seam" in d:
        return "Fastball"
    return desc or code or "Undefined"


def _safe_num(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        return float(value)
    except Exception:
        return None


def _safe_int(value: Any) -> Optional[int]:
    try:
        if value is None or value == "":
            return None
        return int(float(value))
    except Exception:
        return None


def _norm_name(value: Any) -> str:
    raw = str(value or "").strip().lower()
    if not raw:
        return ""
    return "".join(ch for ch in raw if ch.isalnum())


@dataclass
class PitchEventRow:
    school_code: str
    sport_id: int
    game_pk: int
    game_date: str
    game_type: str
    season: str
    home_team_id: Optional[int]
    away_team_id: Optional[int]
    home_team: Optional[str]
    away_team: Optional[str]
    pitcher_team: Optional[str]
    batter_team: Optional[str]
    inning: Optional[int]
    at_bat_index: int
    play_id: str
    event_index: int
    pitch_number: Optional[int]
    is_pitch: bool
    pitcher_id: Optional[int]
    pitcher_name: Optional[str]
    batter_id: Optional[int]
    batter_name: Optional[str]
    pitcher_hand: Optional[str]
    batter_side: Optional[str]
    pitch_code: Optional[str]
    pitch_description: Optional[str]
    pitch_call: Optional[str]
    pitch_type_norm: str
    result_event: Optional[str]
    result_event_type: Optional[str]
    bb_type: Optional[str]
    balls: Optional[int]
    strikes: Optional[int]
    zone: Optional[int]
    outs: Optional[int]
    start_speed: Optional[float]
    end_speed: Optional[float]
    extension: Optional[float]
    spin_rate: Optional[float]
    spin_direction: Optional[float]
    delta_pitcher_run_exp: Optional[float]
    break_h: Optional[float]
    break_v_induced: Optional[float]
    px: Optional[float]
    pz: Optional[float]
    pfx_x: Optional[float]
    pfx_z: Optional[float]
    rel_x: Optional[float]
    rel_y: Optional[float]
    rel_z: Optional[float]
    launch_speed: Optional[float]
    launch_angle: Optional[float]
    estimated_woba_using_speedangle: Optional[float]
    woba_value: Optional[float]
    iso_value: Optional[float]
    babip_value: Optional[float]
    hit_distance: Optional[float]
    outs_on_play: Optional[int]
    official_earned_runs: Optional[int]
    official_outs_recorded: Optional[int]
    raw_json: Dict[str, Any]


def _ip_string_to_outs(value: Any) -> Optional[int]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parts = text.split(".")
        whole = int(parts[0]) if parts and parts[0] else 0
        frac = int(parts[1]) if len(parts) > 1 and parts[1] else 0
        if frac not in {0, 1, 2}:
            return None
        return (whole * 3) + frac
    except Exception:
        return None


def _extract_pitcher_game_stats(feed: Dict[str, Any]) -> tuple[Dict[int, Dict[str, int]], Dict[str, Dict[str, int]]]:
    by_id: Dict[int, Dict[str, int]] = {}
    by_name: Dict[str, Dict[str, int]] = {}
    teams = (((feed.get("liveData") or {}).get("boxscore") or {}).get("teams") or {})
    for side in ("home", "away"):
        players = ((teams.get(side) or {}).get("players") or {})
        if not isinstance(players, dict):
            continue
        for pobj in players.values():
            if not isinstance(pobj, dict):
                continue
            person = pobj.get("person") or {}
            pid = _safe_int(person.get("id"))
            pname = str(person.get("fullName") or "").strip()
            stats = ((pobj.get("stats") or {}).get("pitching") or {})
            if not isinstance(stats, dict):
                continue
            earned_runs = _safe_int(stats.get("earnedRuns"))
            outs_recorded = _safe_int(stats.get("outs"))
            if outs_recorded is None:
                outs_recorded = _ip_string_to_outs(stats.get("inningsPitched"))
            if earned_runs is None and outs_recorded is None:
                continue
            payload = {
                "earned_runs": int(earned_runs or 0),
                "outs_recorded": int(outs_recorded or 0),
            }
            if isinstance(pid, int):
                by_id[pid] = payload
            if pname:
                by_name[_norm_name(pname)] = payload
    return by_id, by_name


def _fetch_game_pks(game_date: date, sport_ids: List[int]) -> List[int]:
    params = urllib.parse.urlencode(
        {
            "sportId": ",".join(str(s) for s in sport_ids),
            "date": game_date.isoformat(),
            "hydrate": "team,probablePitcher",
        }
    )
    payload = _json_get(f"{API_BASE}/schedule?{params}")
    out: List[int] = []
    for day in payload.get("dates") or []:
        for game in day.get("games") or []:
            gpk = game.get("gamePk")
            if isinstance(gpk, int):
                out.append(gpk)
    return out


def _fetch_game_pitches(game_pk: int) -> Tuple[Dict[str, Any], List[PitchEventRow]]:
    try:
        feed = _json_get(f"{API_BASE_GAME_FEED}/game/{game_pk}/feed/live")
    except Exception:
        # Fallback for environments where v1.1 may not be reachable.
        feed = _json_get(f"{API_BASE}/game/{game_pk}/feed/live")
    game_data = feed.get("gameData") or {}
    game = game_data.get("game") or {}
    dt = game.get("datetime") or {}
    teams = game_data.get("teams") or {}
    home = teams.get("home") or {}
    away = teams.get("away") or {}
    sport = game_data.get("sport") or {}

    game_date = str(
        dt.get("officialDate")
        or dt.get("originalDate")
        or str(dt.get("dateTime") or "")[:10]
        or ""
    )
    game_type = str(game.get("type") or "")
    season = str(game.get("season") or "")
    sport_id = int(sport.get("id") or 1)
    home_team_id = home.get("id")
    away_team_id = away.get("id")
    home_team = home.get("abbreviation")
    away_team = away.get("abbreviation")

    stats_by_pitcher_id, stats_by_pitcher_name = _extract_pitcher_game_stats(feed)
    plays = (((feed.get("liveData") or {}).get("plays") or {}).get("allPlays") or [])
    rows: List[PitchEventRow] = []
    for play in plays:
        at_bat_index = int(play.get("atBatIndex") or 0)
        about = play.get("about") or {}
        half_inning = str(about.get("halfInning") or "").lower()
        if half_inning == "top":
            pitcher_team = str(home_team or "") or None
            batter_team = str(away_team or "") or None
        elif half_inning == "bottom":
            pitcher_team = str(away_team or "") or None
            batter_team = str(home_team or "") or None
        else:
            pitcher_team = None
            batter_team = None
        matchup = play.get("matchup") or {}
        pitcher = matchup.get("pitcher") or {}
        batter = matchup.get("batter") or {}
        pitch_hand = ((matchup.get("pitchHand") or {}).get("code") or None)
        bat_side = ((matchup.get("batSide") or {}).get("code") or None)
        play_result = play.get("result") or {}
        play_events = play.get("playEvents") or []
        pitch_event_indexes = [
            int(ev.get("index") or 0)
            for ev in play_events
            if bool(ev.get("isPitch"))
        ]
        terminal_pitch_index = max(pitch_event_indexes) if pitch_event_indexes else None
        runners = play.get("runners") or []
        play_outs_recorded = sum(
            1
            for runner in runners
            if bool((runner.get("details") or {}).get("isOut"))
        )
        if play_outs_recorded == 0:
            result_event_type = str(play_result.get("eventType") or "").lower()
            if result_event_type in {"strikeout", "strikeout_double_play"}:
                play_outs_recorded = 1

        state_balls = 0
        state_strikes = 0
        for event in play_events:
            is_pitch = bool(event.get("isPitch"))
            details = event.get("details") or {}
            ptype = details.get("type") or {}
            pcode = str(ptype.get("code") or "")
            pdesc = str(ptype.get("description") or "")
            pdata = event.get("pitchData") or {}
            breaks = pdata.get("breaks") or {}
            coords = pdata.get("coordinates") or {}
            hdata = event.get("hitData") or {}
            bb_type = str(
                hdata.get("trajectory")
                or hdata.get("launchTrajectory")
                or hdata.get("type")
                or ""
            ).strip()

            is_terminal_pitch = (
                terminal_pitch_index is not None
                and int(event.get("index") or 0) == terminal_pitch_index
            )

            # Reconstruct count per pitch event.
            # Store pre-pitch count in row (matches dashboard formulas),
            # then advance state for next pitch.
            pre_balls = state_balls
            pre_strikes = state_strikes
            balls_after = state_balls
            strikes_after = state_strikes
            code = str(details.get("code") or "").upper()
            desc_lower = str(details.get("description") or "").lower()
            is_in_play = bool(details.get("isInPlay")) or code == "X" or "in play" in desc_lower
            is_ball = details.get("isBall")
            is_strike = details.get("isStrike")
            if is_pitch:
                if is_in_play:
                    pass
                elif is_ball is True or code in {"B", "I", "P", "V"}:
                    balls_after = min(3, state_balls + 1)
                elif is_strike is True or code in {"C", "S", "T", "L", "M", "Q", "R"}:
                    strikes_after = min(2, state_strikes + 1)
                elif code == "F":
                    strikes_after = min(2, state_strikes + 1)
                # Unknown code -> leave unchanged.

            row = PitchEventRow(
                school_code="PRO",
                sport_id=sport_id,
                game_pk=game_pk,
                game_date=game_date,
                game_type=game_type,
                season=season,
                home_team_id=int(home_team_id) if isinstance(home_team_id, int) else None,
                away_team_id=int(away_team_id) if isinstance(away_team_id, int) else None,
                home_team=str(home_team) if home_team else None,
                away_team=str(away_team) if away_team else None,
                pitcher_team=pitcher_team,
                batter_team=batter_team,
                inning=_safe_int(about.get("inning")),
                at_bat_index=at_bat_index,
                play_id=str(event.get("playId") or ""),
                event_index=int(event.get("index") or 0),
                pitch_number=int(event.get("pitchNumber")) if isinstance(event.get("pitchNumber"), int) else None,
                is_pitch=is_pitch,
                pitcher_id=int(pitcher.get("id")) if isinstance(pitcher.get("id"), int) else None,
                pitcher_name=str(pitcher.get("fullName") or "") or None,
                batter_id=int(batter.get("id")) if isinstance(batter.get("id"), int) else None,
                batter_name=str(batter.get("fullName") or "") or None,
                pitcher_hand=pitch_hand,
                batter_side=bat_side,
                pitch_code=pcode or None,
                pitch_description=pdesc or None,
                pitch_call=str(details.get("description") or "") or None,
                pitch_type_norm=_norm_pitch_type(pcode, pdesc),
                result_event=(str(play_result.get("event") or "") or None) if is_terminal_pitch else None,
                result_event_type=(str(play_result.get("eventType") or "") or None) if is_terminal_pitch else None,
                bb_type=(bb_type or None),
                balls=(pre_balls if is_pitch else None),
                strikes=(pre_strikes if is_pitch else None),
                zone=_safe_int(pdata.get("zone")),
                outs=(int(count.get("outs")) if isinstance((count := (play.get("count") or {})).get("outs"), int) else None),
                start_speed=_safe_num(pdata.get("startSpeed")),
                end_speed=_safe_num(pdata.get("endSpeed")),
                extension=_safe_num(pdata.get("extension")),
                spin_rate=_safe_num(breaks.get("spinRate")),
                spin_direction=_safe_num(breaks.get("spinDirection")),
                delta_pitcher_run_exp=(
                    _safe_num(event.get("deltaPitcherRunExp"))
                    or _safe_num(event.get("delta_pitcher_run_exp"))
                    or _safe_num((event.get("details") or {}).get("deltaPitcherRunExp"))
                    or _safe_num((event.get("details") or {}).get("delta_pitcher_run_exp"))
                ),
                break_h=_safe_num(breaks.get("breakHorizontal")),
                break_v_induced=_safe_num(breaks.get("breakVerticalInduced")),
                px=_safe_num(coords.get("pX")),
                pz=_safe_num(coords.get("pZ")),
                pfx_x=_safe_num(coords.get("pfxX")),
                pfx_z=_safe_num(coords.get("pfxZ")),
                rel_x=_safe_num(coords.get("x0")),
                rel_y=_safe_num(coords.get("y0")),
                rel_z=_safe_num(coords.get("z0")),
                launch_speed=_safe_num(hdata.get("launchSpeed")),
                launch_angle=_safe_num(hdata.get("launchAngle")),
                estimated_woba_using_speedangle=(
                    _safe_num(hdata.get("estimated_woba_using_speedangle"))
                    or _safe_num(hdata.get("estimatedWobaUsingSpeedangle"))
                    or _safe_num(event.get("estimated_woba_using_speedangle"))
                    or _safe_num(event.get("estimatedWobaUsingSpeedangle"))
                    or _safe_num((event.get("details") or {}).get("estimated_woba_using_speedangle"))
                    or _safe_num((event.get("details") or {}).get("estimatedWobaUsingSpeedangle"))
                ),
                woba_value=(
                    _safe_num(hdata.get("woba_value"))
                    or _safe_num(hdata.get("wobaValue"))
                    or _safe_num(event.get("woba_value"))
                    or _safe_num(event.get("wobaValue"))
                    or _safe_num((event.get("details") or {}).get("woba_value"))
                    or _safe_num((event.get("details") or {}).get("wobaValue"))
                ),
                iso_value=(
                    _safe_num(hdata.get("iso_value"))
                    or _safe_num(hdata.get("isoValue"))
                    or _safe_num(event.get("iso_value"))
                    or _safe_num(event.get("isoValue"))
                    or _safe_num((event.get("details") or {}).get("iso_value"))
                    or _safe_num((event.get("details") or {}).get("isoValue"))
                ),
                babip_value=(
                    _safe_num(hdata.get("babip_value"))
                    or _safe_num(hdata.get("babipValue"))
                    or _safe_num(event.get("babip_value"))
                    or _safe_num(event.get("babipValue"))
                    or _safe_num((event.get("details") or {}).get("babip_value"))
                    or _safe_num((event.get("details") or {}).get("babipValue"))
                ),
                hit_distance=_safe_num(hdata.get("totalDistance")),
                outs_on_play=(
                    int(play_outs_recorded)
                    if (
                        terminal_pitch_index is not None
                        and int(event.get("index") or 0) == terminal_pitch_index
                        and int(play_outs_recorded) > 0
                    )
                    else None
                ),
                official_earned_runs=(
                    stats_by_pitcher_id.get(int(pitcher.get("id")) if isinstance(pitcher.get("id"), int) else -1, {}).get("earned_runs")
                    if isinstance(pitcher.get("id"), int)
                    else stats_by_pitcher_name.get(_norm_name(pitcher.get("fullName")), {}).get("earned_runs")
                ),
                official_outs_recorded=(
                    stats_by_pitcher_id.get(int(pitcher.get("id")) if isinstance(pitcher.get("id"), int) else -1, {}).get("outs_recorded")
                    if isinstance(pitcher.get("id"), int)
                    else stats_by_pitcher_name.get(_norm_name(pitcher.get("fullName")), {}).get("outs_recorded")
                ),
                raw_json=event,
            )
            rows.append(row)
            if is_pitch:
                state_balls = balls_after
                state_strikes = strikes_after

    return feed, rows


DDL = """
CREATE TABLE IF NOT EXISTS public.pro_mlb_pitch_events_raw (
  id BIGSERIAL PRIMARY KEY,
  school_code TEXT NOT NULL DEFAULT 'PRO',
  sport_id INTEGER NOT NULL,
  game_pk BIGINT NOT NULL,
  game_date DATE,
  game_type TEXT,
  season TEXT,
  home_team_id INTEGER,
  away_team_id INTEGER,
  home_team TEXT,
  away_team TEXT,
  at_bat_index INTEGER NOT NULL,
  play_id TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  pitch_number INTEGER,
  is_pitch BOOLEAN NOT NULL,
  pitcher_id INTEGER,
  pitcher_name TEXT,
  batter_id INTEGER,
  batter_name TEXT,
  pitcher_hand TEXT,
  batter_side TEXT,
  pitch_code TEXT,
  pitch_description TEXT,
  pitch_type_norm TEXT,
  result_event TEXT,
  result_event_type TEXT,
  balls INTEGER,
  strikes INTEGER,
  zone INTEGER,
  outs INTEGER,
  start_speed DOUBLE PRECISION,
  end_speed DOUBLE PRECISION,
  extension DOUBLE PRECISION,
  spin_rate DOUBLE PRECISION,
  spin_direction DOUBLE PRECISION,
  delta_pitcher_run_exp DOUBLE PRECISION,
  break_h DOUBLE PRECISION,
  break_v_induced DOUBLE PRECISION,
  px DOUBLE PRECISION,
  pz DOUBLE PRECISION,
  pfx_x DOUBLE PRECISION,
  pfx_z DOUBLE PRECISION,
  rel_x DOUBLE PRECISION,
  rel_y DOUBLE PRECISION,
  rel_z DOUBLE PRECISION,
  launch_speed DOUBLE PRECISION,
  launch_angle DOUBLE PRECISION,
  estimated_woba_using_speedangle DOUBLE PRECISION,
  woba_value DOUBLE PRECISION,
  iso_value DOUBLE PRECISION,
  babip_value DOUBLE PRECISION,
  hit_distance DOUBLE PRECISION,
  raw_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_pk, play_id, event_index)
);
CREATE INDEX IF NOT EXISTS idx_pro_mlb_pitch_events_raw_game_date
  ON public.pro_mlb_pitch_events_raw (game_date);
CREATE INDEX IF NOT EXISTS idx_pro_mlb_pitch_events_raw_pitcher_name
  ON public.pro_mlb_pitch_events_raw (pitcher_name);
CREATE INDEX IF NOT EXISTS idx_pro_mlb_pitch_events_raw_pitch_type
  ON public.pro_mlb_pitch_events_raw (pitch_type_norm);
ALTER TABLE public.pro_mlb_pitch_events_raw ADD COLUMN IF NOT EXISTS delta_pitcher_run_exp DOUBLE PRECISION;
ALTER TABLE public.pro_mlb_pitch_events_raw ADD COLUMN IF NOT EXISTS zone INTEGER;
ALTER TABLE public.pro_mlb_pitch_events_raw ADD COLUMN IF NOT EXISTS estimated_woba_using_speedangle DOUBLE PRECISION;
ALTER TABLE public.pro_mlb_pitch_events_raw ADD COLUMN IF NOT EXISTS woba_value DOUBLE PRECISION;
ALTER TABLE public.pro_mlb_pitch_events_raw ADD COLUMN IF NOT EXISTS iso_value DOUBLE PRECISION;
ALTER TABLE public.pro_mlb_pitch_events_raw ADD COLUMN IF NOT EXISTS babip_value DOUBLE PRECISION;

CREATE TABLE IF NOT EXISTS public.pro_pitch_events (
  id BIGSERIAL PRIMARY KEY,
  school_code TEXT NOT NULL DEFAULT 'PRO',
  sport_id INTEGER NOT NULL,
  game_pk BIGINT NOT NULL,
  game_date DATE,
  session_date DATE,
  game_type TEXT,
  season TEXT,
  home_team TEXT,
  away_team TEXT,
  inning INTEGER,
  at_bat_index INTEGER NOT NULL,
  play_id TEXT NOT NULL,
  event_index INTEGER NOT NULL,
  pitchid INTEGER,
  pitchuid TEXT,
  gameid TEXT,
  pitcher TEXT,
  batter TEXT,
  catcher TEXT,
  pitcherthrows TEXT,
  batterside TEXT,
  pitcherteam TEXT,
  batterteam TEXT,
  taggedpitchtype TEXT,
  pitchcall TEXT,
  playresult TEXT,
  korbb TEXT,
  taggedhittype TEXT,
  balls INTEGER,
  strikes INTEGER,
  zone INTEGER,
  outs INTEGER,
  outsonplay INTEGER,
  official_earned_runs INTEGER,
  official_outs_recorded INTEGER,
  relspeed DOUBLE PRECISION,
  spinrate DOUBLE PRECISION,
  releasetilt TEXT,
  breaktilt TEXT,
  spinefficiency DOUBLE PRECISION,
  inducedvertbreak DOUBLE PRECISION,
  horzbreak DOUBLE PRECISION,
  relheight DOUBLE PRECISION,
  relside DOUBLE PRECISION,
  extension DOUBLE PRECISION,
  platelocside DOUBLE PRECISION,
  platelocheight DOUBLE PRECISION,
  exitspeed DOUBLE PRECISION,
  angle DOUBLE PRECISION,
  estimated_woba_using_speedangle DOUBLE PRECISION,
  woba_value DOUBLE PRECISION,
  iso_value DOUBLE PRECISION,
  babip_value DOUBLE PRECISION,
  hit_distance_sc DOUBLE PRECISION,
  hc_x DOUBLE PRECISION,
  hc_y DOUBLE PRECISION,
  spray_direction DOUBLE PRECISION,
  session_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (game_pk, play_id, event_index)
);
CREATE INDEX IF NOT EXISTS idx_pro_pitch_events_session_date
  ON public.pro_pitch_events (session_date);
CREATE INDEX IF NOT EXISTS idx_pro_pitch_events_pitcher
  ON public.pro_pitch_events (pitcher);
CREATE INDEX IF NOT EXISTS idx_pro_pitch_events_pitcherteam
  ON public.pro_pitch_events (pitcherteam);
CREATE INDEX IF NOT EXISTS idx_pro_pitch_events_batterteam
  ON public.pro_pitch_events (batterteam);
CREATE INDEX IF NOT EXISTS idx_pro_pitch_events_pitch_type
  ON public.pro_pitch_events (taggedpitchtype);
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS delta_pitcher_run_exp DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS official_earned_runs INTEGER;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS official_outs_recorded INTEGER;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS inning INTEGER;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS zone INTEGER;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS estimated_woba_using_speedangle DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS woba_value DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS iso_value DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS babip_value DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS hit_distance_sc DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS hc_x DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS hc_y DOUBLE PRECISION;
ALTER TABLE public.pro_pitch_events ADD COLUMN IF NOT EXISTS spray_direction DOUBLE PRECISION;
"""




UPSERT = """
INSERT INTO public.pro_mlb_pitch_events_raw (
  school_code, sport_id, game_pk, game_date, game_type, season,
  home_team_id, away_team_id, home_team, away_team, at_bat_index, play_id, event_index, pitch_number, is_pitch,
  pitcher_id, pitcher_name, batter_id, batter_name, pitcher_hand, batter_side,
  pitch_code, pitch_description, pitch_type_norm, result_event, result_event_type,
  balls, strikes, zone, outs, start_speed, end_speed, extension, spin_rate, spin_direction, delta_pitcher_run_exp,
  break_h, break_v_induced, px, pz, pfx_x, pfx_z, rel_x, rel_y, rel_z,
  launch_speed, launch_angle, estimated_woba_using_speedangle, woba_value, iso_value, babip_value, hit_distance, raw_json, updated_at
)
VALUES (
  %(school_code)s, %(sport_id)s, %(game_pk)s, %(game_date)s, %(game_type)s, %(season)s,
  %(home_team_id)s, %(away_team_id)s, %(home_team)s, %(away_team)s, %(at_bat_index)s, %(play_id)s, %(event_index)s, %(pitch_number)s, %(is_pitch)s,
  %(pitcher_id)s, %(pitcher_name)s, %(batter_id)s, %(batter_name)s, %(pitcher_hand)s, %(batter_side)s,
  %(pitch_code)s, %(pitch_description)s, %(pitch_type_norm)s, %(result_event)s, %(result_event_type)s,
  %(balls)s, %(strikes)s, %(zone)s, %(outs)s, %(start_speed)s, %(end_speed)s, %(extension)s, %(spin_rate)s, %(spin_direction)s, %(delta_pitcher_run_exp)s,
  %(break_h)s, %(break_v_induced)s, %(px)s, %(pz)s, %(pfx_x)s, %(pfx_z)s, %(rel_x)s, %(rel_y)s, %(rel_z)s,
  %(launch_speed)s, %(launch_angle)s, %(estimated_woba_using_speedangle)s, %(woba_value)s, %(iso_value)s, %(babip_value)s, %(hit_distance)s, %(raw_json)s::jsonb, NOW()
)
ON CONFLICT (game_pk, play_id, event_index) DO UPDATE SET
  school_code = EXCLUDED.school_code,
  sport_id = EXCLUDED.sport_id,
  game_date = EXCLUDED.game_date,
  game_type = EXCLUDED.game_type,
  season = EXCLUDED.season,
  home_team_id = EXCLUDED.home_team_id,
  away_team_id = EXCLUDED.away_team_id,
  home_team = EXCLUDED.home_team,
  away_team = EXCLUDED.away_team,
  at_bat_index = EXCLUDED.at_bat_index,
  pitch_number = EXCLUDED.pitch_number,
  is_pitch = EXCLUDED.is_pitch,
  pitcher_id = EXCLUDED.pitcher_id,
  pitcher_name = EXCLUDED.pitcher_name,
  batter_id = EXCLUDED.batter_id,
  batter_name = EXCLUDED.batter_name,
  pitcher_hand = EXCLUDED.pitcher_hand,
  batter_side = EXCLUDED.batter_side,
  pitch_code = EXCLUDED.pitch_code,
  pitch_description = EXCLUDED.pitch_description,
  pitch_type_norm = EXCLUDED.pitch_type_norm,
  result_event = EXCLUDED.result_event,
  result_event_type = EXCLUDED.result_event_type,
  balls = EXCLUDED.balls,
  strikes = EXCLUDED.strikes,
  zone = EXCLUDED.zone,
  outs = EXCLUDED.outs,
  start_speed = EXCLUDED.start_speed,
  end_speed = EXCLUDED.end_speed,
  extension = EXCLUDED.extension,
  spin_rate = EXCLUDED.spin_rate,
  spin_direction = EXCLUDED.spin_direction,
  delta_pitcher_run_exp = EXCLUDED.delta_pitcher_run_exp,
  break_h = EXCLUDED.break_h,
  break_v_induced = EXCLUDED.break_v_induced,
  px = EXCLUDED.px,
  pz = EXCLUDED.pz,
  pfx_x = EXCLUDED.pfx_x,
  pfx_z = EXCLUDED.pfx_z,
  rel_x = EXCLUDED.rel_x,
  rel_y = EXCLUDED.rel_y,
  rel_z = EXCLUDED.rel_z,
  launch_speed = EXCLUDED.launch_speed,
  launch_angle = EXCLUDED.launch_angle,
  estimated_woba_using_speedangle = EXCLUDED.estimated_woba_using_speedangle,
  woba_value = EXCLUDED.woba_value,
  iso_value = EXCLUDED.iso_value,
  babip_value = EXCLUDED.babip_value,
  hit_distance = EXCLUDED.hit_distance,
  raw_json = EXCLUDED.raw_json,
  updated_at = NOW();
"""

UPSERT_NORM = """
INSERT INTO public.pro_pitch_events (
  school_code, sport_id, game_pk, game_date, session_date, game_type, season, home_team, away_team,
  inning, at_bat_index, play_id, event_index, pitchid, pitchuid, gameid,
  pitcher, batter, catcher, pitcherthrows, batterside, pitcherteam, batterteam,
  taggedpitchtype, pitchcall, playresult, korbb, taggedhittype,
  balls, strikes, zone, outs, outsonplay, official_earned_runs, official_outs_recorded, relspeed, spinrate, releasetilt, breaktilt, spinefficiency, delta_pitcher_run_exp,
  inducedvertbreak, horzbreak, relheight, relside, extension, platelocside, platelocheight,
  exitspeed, angle, estimated_woba_using_speedangle, woba_value, iso_value, babip_value,
  hit_distance_sc, hc_x, hc_y, spray_direction,
  session_type, updated_at
)
VALUES (
  %(school_code)s, %(sport_id)s, %(game_pk)s, %(game_date)s, %(session_date)s, %(game_type)s, %(season)s, %(home_team)s, %(away_team)s,
  %(inning)s, %(at_bat_index)s, %(play_id)s, %(event_index)s, %(pitchid)s, %(pitchuid)s, %(gameid)s,
  %(pitcher)s, %(batter)s, %(catcher)s, %(pitcherthrows)s, %(batterside)s, %(pitcherteam)s, %(batterteam)s,
  %(taggedpitchtype)s, %(pitchcall)s, %(playresult)s, %(korbb)s, %(taggedhittype)s,
  %(balls)s, %(strikes)s, %(zone)s, %(outs)s, %(outsonplay)s, %(official_earned_runs)s, %(official_outs_recorded)s, %(relspeed)s, %(spinrate)s, %(releasetilt)s, %(breaktilt)s, %(spinefficiency)s, %(delta_pitcher_run_exp)s,
  %(inducedvertbreak)s, %(horzbreak)s, %(relheight)s, %(relside)s, %(extension)s, %(platelocside)s, %(platelocheight)s,
  %(exitspeed)s, %(angle)s, %(estimated_woba_using_speedangle)s, %(woba_value)s, %(iso_value)s, %(babip_value)s,
  %(hit_distance_sc)s, %(hc_x)s, %(hc_y)s, %(spray_direction)s,
  %(session_type)s, NOW()
)
ON CONFLICT (game_pk, play_id, event_index) DO UPDATE SET
  school_code = EXCLUDED.school_code,
  sport_id = EXCLUDED.sport_id,
  game_date = EXCLUDED.game_date,
  session_date = EXCLUDED.session_date,
  game_type = EXCLUDED.game_type,
  season = EXCLUDED.season,
  home_team = EXCLUDED.home_team,
  away_team = EXCLUDED.away_team,
  inning = EXCLUDED.inning,
  at_bat_index = EXCLUDED.at_bat_index,
  pitchid = EXCLUDED.pitchid,
  pitchuid = EXCLUDED.pitchuid,
  gameid = EXCLUDED.gameid,
  pitcher = EXCLUDED.pitcher,
  batter = EXCLUDED.batter,
  catcher = EXCLUDED.catcher,
  pitcherthrows = EXCLUDED.pitcherthrows,
  batterside = EXCLUDED.batterside,
  pitcherteam = EXCLUDED.pitcherteam,
  batterteam = EXCLUDED.batterteam,
  taggedpitchtype = EXCLUDED.taggedpitchtype,
  pitchcall = EXCLUDED.pitchcall,
  playresult = EXCLUDED.playresult,
  korbb = EXCLUDED.korbb,
  taggedhittype = EXCLUDED.taggedhittype,
  balls = EXCLUDED.balls,
  strikes = EXCLUDED.strikes,
  zone = EXCLUDED.zone,
  outs = EXCLUDED.outs,
  outsonplay = EXCLUDED.outsonplay,
  official_earned_runs = EXCLUDED.official_earned_runs,
  official_outs_recorded = EXCLUDED.official_outs_recorded,
  relspeed = EXCLUDED.relspeed,
  spinrate = EXCLUDED.spinrate,
  releasetilt = EXCLUDED.releasetilt,
  breaktilt = EXCLUDED.breaktilt,
  spinefficiency = EXCLUDED.spinefficiency,
  delta_pitcher_run_exp = EXCLUDED.delta_pitcher_run_exp,
  inducedvertbreak = EXCLUDED.inducedvertbreak,
  horzbreak = EXCLUDED.horzbreak,
  relheight = EXCLUDED.relheight,
  relside = EXCLUDED.relside,
  extension = EXCLUDED.extension,
  platelocside = EXCLUDED.platelocside,
  platelocheight = EXCLUDED.platelocheight,
  exitspeed = EXCLUDED.exitspeed,
  angle = EXCLUDED.angle,
  estimated_woba_using_speedangle = EXCLUDED.estimated_woba_using_speedangle,
  woba_value = EXCLUDED.woba_value,
  iso_value = EXCLUDED.iso_value,
  babip_value = EXCLUDED.babip_value,
  hit_distance_sc = EXCLUDED.hit_distance_sc,
  hc_x = EXCLUDED.hc_x,
  hc_y = EXCLUDED.hc_y,
  spray_direction = EXCLUDED.spray_direction,
  session_type = EXCLUDED.session_type,
  updated_at = NOW();
"""


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Sync PRO MLB/AAA pitch events into Neon")
    parser.add_argument("--start-date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--end-date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--sport-ids", default="1,11", help="Comma-separated MLB StatsAPI sportIds (default: 1,11)")
    parser.add_argument(
        "--aaa-tracked-players",
        default="",
        help="Comma-separated AAA player names to keep (matches pitcher OR batter). Empty keeps all AAA.",
    )
    parser.add_argument("--sleep-ms", type=int, default=150, help="Sleep between game requests (default: 150)")
    return parser.parse_args()




def main() -> int:
    args = _parse_args()
    try:
        start = date.fromisoformat(args.start_date)
        end = date.fromisoformat(args.end_date)
    except Exception:
        print("Invalid date format. Use YYYY-MM-DD.", file=sys.stderr)
        return 2
    if end < start:
        print("end-date must be >= start-date", file=sys.stderr)
        return 2

    sport_ids = [int(token.strip()) for token in args.sport_ids.split(",") if token.strip().isdigit()]
    if not sport_ids:
        sport_ids = [1, 11]
    tracked_aaa_names = [
        token.strip() for token in str(args.aaa_tracked_players or "").split(",") if token.strip()
    ]
    tracked_aaa_norm = {_norm_name(name) for name in tracked_aaa_names if _norm_name(name)}

    db_url = _with_system_sslrootcert(_require_env("DASHBOARD_DATABASE_URL"))

    total_games = 0
    total_rows = 0
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(DDL)
            conn.commit()

        for day in _daterange(start, end):
            game_pks = _fetch_game_pks(day, sport_ids)
            if not game_pks:
                print(f"{day.isoformat()}: no games")
                continue
            print(f"{day.isoformat()}: {len(game_pks)} games")
            for game_pk in game_pks:
                try:
                    _, rows = _fetch_game_pitches(game_pk)
                except Exception as exc:
                    print(f"  game {game_pk}: fetch failed: {exc}", file=sys.stderr)
                    continue
                payloads = []
                norm_payloads = []
                for row in rows:
                    if not row.is_pitch:
                        continue
                    if int(row.sport_id or 0) == 11 and tracked_aaa_norm:
                        pitcher_norm = _norm_name(row.pitcher_name)
                        batter_norm = _norm_name(row.batter_name)
                        if pitcher_norm not in tracked_aaa_norm and batter_norm not in tracked_aaa_norm:
                            continue
                    item = dict(row.__dict__)
                    if not item.get("game_date"):
                        item["game_date"] = day.isoformat()
                    item["raw_json"] = json.dumps(item.get("raw_json") or {}, separators=(",", ":"))
                    payloads.append(item)
                    norm_payloads.append(
                        {
                            "school_code": "PRO",
                            "sport_id": int(item.get("sport_id") or 1),
                            "game_pk": int(item.get("game_pk") or 0),
                            "game_date": item.get("game_date"),
                            "session_date": item.get("game_date"),
                            "game_type": item.get("game_type"),
                            "season": item.get("season"),
                            "home_team": item.get("home_team"),
                            "away_team": item.get("away_team"),
                            "inning": item.get("inning"),
                            "at_bat_index": int(item.get("at_bat_index") or 0),
                            "play_id": str(item.get("play_id") or ""),
                            "event_index": int(item.get("event_index") or 0),
                            "pitchid": item.get("pitch_number"),
                            "pitchuid": str(item.get("play_id") or ""),
                            "gameid": str(item.get("game_pk") or ""),
                            "pitcher": item.get("pitcher_name"),
                            "batter": item.get("batter_name"),
                            "catcher": None,
                            "pitcherthrows": ("Left" if str(item.get("pitcher_hand") or "").upper() == "L" else "Right" if str(item.get("pitcher_hand") or "").upper() == "R" else None),
                            "batterside": ("Left" if str(item.get("batter_side") or "").upper() == "L" else "Right" if str(item.get("batter_side") or "").upper() == "R" else None),
                            "pitcherteam": item.get("pitcher_team"),
                            "batterteam": item.get("batter_team"),
                            "taggedpitchtype": item.get("pitch_type_norm"),
                            "pitchcall": item.get("pitch_call"),
                            "playresult": item.get("result_event"),
                            "korbb": ("Strikeout" if str(item.get("result_event_type") or "").lower() in {"strikeout", "strikeout_double_play"} else "Walk" if str(item.get("result_event_type") or "").lower() in {"walk", "intent_walk"} else None),
                            "taggedhittype": item.get("bb_type"),
                            "balls": item.get("balls"),
                            "strikes": item.get("strikes"),
                            "zone": item.get("zone"),
                            "outs": item.get("outs"),
                            "outsonplay": item.get("outs_on_play"),
                            "official_earned_runs": item.get("official_earned_runs"),
                            "official_outs_recorded": item.get("official_outs_recorded"),
                            "relspeed": item.get("start_speed"),
                            "spinrate": item.get("spin_rate"),
                            "releasetilt": item.get("spin_direction"),
                            "breaktilt": None,
                            "spinefficiency": None,
                            "delta_pitcher_run_exp": item.get("delta_pitcher_run_exp"),
                            "inducedvertbreak": item.get("break_v_induced"),
                            "horzbreak": item.get("break_h"),
                            "relheight": item.get("rel_z"),
                            "relside": item.get("rel_x"),
                            "extension": item.get("extension"),
                            "platelocside": item.get("px"),
                            "platelocheight": item.get("pz"),
                            "exitspeed": item.get("launch_speed"),
                            "angle": item.get("launch_angle"),
                            "estimated_woba_using_speedangle": item.get("estimated_woba_using_speedangle"),
                            "woba_value": item.get("woba_value"),
                            "iso_value": item.get("iso_value"),
                            "babip_value": item.get("babip_value"),
                            "hit_distance_sc": item.get("hit_distance"),
                            "hc_x": None,
                            "hc_y": None,
                            "spray_direction": None,
                            "session_type": "Season",
                        }
                    )
                if payloads:
                    with conn.cursor() as cur:
                        cur.executemany(UPSERT, payloads)
                        cur.executemany(UPSERT_NORM, norm_payloads)
                    conn.commit()
                total_games += 1
                total_rows += len(payloads)
                print(f"  game {game_pk}: pitches={len(payloads)} total={total_rows}")
                if args.sleep_ms > 0:
                    time.sleep(args.sleep_ms / 1000.0)

    print(f"done: games={total_games} rows={total_rows}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
