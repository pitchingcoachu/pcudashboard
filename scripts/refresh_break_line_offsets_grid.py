#!/usr/bin/env python3
"""
Refresh the break_line_offsets_grid table: a precomputed, fastball-shape-
conditioned lookup of "typical" off-speed pitch movement offsets relative to
a pitcher's own Fastball/Sinker shape.

For each pitcher we compute their average Fastball (ivb, hb) and average
Sinker (ivb, hb) location, mirror horizontal break into "righty space" for
lefties (sign-consistent with normalizeForHandedness() in
app/portal/dashboard/pitching-suite.tsx: LHP HB is negated), bucket that
reference point into a 2x2 grid cell, and then aggregate every off-speed
pitch (Cutter, Slider, Sweeper, Curveball, ChangeUp, Splitter) thrown by
pitchers whose reference point lands in that cell into an average
(ivb_offset, hb_offset) relative to that base pitch type. This is done per
level (D1/D2/D3/JUCO/NAIA from pitch_events.level for school_code='LEAGUE',
MLB from pro_pitch_events using the same team-code classification the rest
of the dashboard uses) plus a combined 'ALL' level that pools every level
together. Cells with fewer than MIN_SAMPLE_SIZE off-speed pitches at their
specific level fall back to the 'ALL'-level value for that same cell and are
marked used_fallback = true.

Each source table (pitch_events, pro_pitch_events) is scanned exactly once;
per-level and ALL-level aggregates are both derived from that single scan
(each offset row is counted once under its own level and once under 'ALL',
then grouped together) so runtime does not scale with the number of levels.

Usage:
  .venv/bin/python scripts/refresh_break_line_offsets_grid.py
  .venv/bin/python scripts/refresh_break_line_offsets_grid.py --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys
import time


_ADVISORY_LOCK_KEY = 910005
_MIN_SAMPLE_SIZE = 30

_OFFSPEED_PITCH_TYPES = ("Cutter", "Slider", "Sweeper", "Curveball", "ChangeUp", "Splitter")
_LEAGUE_LEVELS = ("D1", "D2", "D3", "JUCO", "NAIA")
_ALL_LEVELS = (*_LEAGUE_LEVELS, "MLB")

# Same taggedpitchtype normalization used by PITCH_TYPE_SQL in
# app/api/dashboard/pitching/overview/route.ts -- kept in lockstep with that
# canonical mapping so this grid classifies pitches identically to the rest
# of the dashboard.
def _pitch_type_case_sql(col: str) -> str:
    token = f"regexp_replace(lower(COALESCE(TRIM({col}), '')), '[^a-z0-9]', '', 'g')"
    return f"""
CASE
  WHEN {token} IN ('', 'unknown', 'undefined', 'other', 'untagged', 'na', 'none', 'null') THEN 'Undefined'
  WHEN {token} IN ('fastball', 'fourseam', 'fourseamfastball', 'ff', 'fa') THEN 'Fastball'
  WHEN {token} IN ('sinker', 'oneseamfastball', 'twoseam', 'twoseamfastball', 'twoseamfasball', 'si', 'ft') THEN 'Sinker'
  WHEN {token} IN ('changeup', 'ch') THEN 'ChangeUp'
  WHEN {token} IN ('sweeper', 'st') THEN 'Sweeper'
  WHEN {token} IN ('splitter', 'splitfinger', 'splitfingerfastball', 'sp', 'fs') THEN 'Splitter'
  WHEN {token} IN ('curveball', 'cu', 'knucklecurve', 'kc') THEN 'Curveball'
  WHEN {token} IN ('cutter', 'fc') THEN 'Cutter'
  WHEN {token} IN ('slider', 'sl') THEN 'Slider'
  WHEN {token} IN ('knuckleball', 'kn') THEN 'Knuckleball'
  ELSE COALESCE(NULLIF(TRIM({col}), ''), 'Undefined')
END
"""


def _hand_sql(col: str) -> str:
    return f"""
CASE
  WHEN lower(TRIM(COALESCE({col}, ''))) IN ('l', 'left') THEN 'L'
  WHEN lower(TRIM(COALESCE({col}, ''))) IN ('r', 'right') THEN 'R'
  ELSE NULL
END
"""


_CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS public.break_line_offsets_grid (
  level TEXT NOT NULL,
  base_pitch_type TEXT NOT NULL,
  fb_ivb_bucket INTEGER NOT NULL,
  fb_hb_bucket INTEGER NOT NULL,
  offspeed_pitch_type TEXT NOT NULL,
  avg_ivb_offset DOUBLE PRECISION NOT NULL,
  avg_hb_offset DOUBLE PRECISION NOT NULL,
  sample_size INTEGER NOT NULL,
  used_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT break_line_offsets_grid_pkey PRIMARY KEY (
    level, base_pitch_type, fb_ivb_bucket, fb_hb_bucket, offspeed_pitch_type
  )
);

CREATE INDEX IF NOT EXISTS idx_break_line_offsets_grid_lookup
  ON public.break_line_offsets_grid (level, base_pitch_type, fb_ivb_bucket, fb_hb_bucket);
"""

# MLB, sourced from pro_pitch_events, classified the same way the rest of the
# dashboard splits MLB vs AAA: primarily by team code, falling back to
# sport_id for teams whose code is shared between an MLB club and its AAA
# affiliate. Mirrors PRO_MLB_ONLY_TEAM_CODES / PRO_TEAM_CODE_OVERLAP from
# dashboard_api/app/main.py (loaded and passed in as bound params, see main()).
_MLB_FILTER_SQL = """
school_code = 'PRO' AND (
  UPPER(TRIM(COALESCE(pitcherteam, ''))) = ANY(%(mlb_only_team_codes)s::text[])
  OR (
    UPPER(TRIM(COALESCE(pitcherteam, ''))) = ANY(%(overlap_team_codes)s::text[])
    AND COALESCE(sport_id, 0) = 1
  )
)
"""


def _source_cells_sql(*, source_table: str, level_expr_sql: str, extra_where_sql: str) -> str:
    """
    One single-scan CTE chain over `source_table` that:
      1. pulls raw pitcher/pitch rows (`rows_<t>`),
      2. tags each row with its display level (`level_expr_sql`),
      3. computes per-pitcher average Fastball/Sinker reference points and
         buckets them,
      4. computes each off-speed pitch's offset from its pitcher's bucketed
         reference point,
      5. aggregates into cells per (level, base_pitch_type, buckets,
         offspeed_pitch_type), unioning each offset row in under both its
         own level and a synthetic 'ALL' level so a single GROUP BY produces
         both the per-level rows AND the ALL-pooled rows in one pass.
    `extra_where_sql` scopes the source rows (e.g. to school_code='LEAGUE'
    or the MLB team-code classification); `level_expr_sql` must evaluate to
    one of the literal level codes for every row that survives that filter.
    """
    ivb_col = "ivb_num" if source_table == "league" else "inducedvertbreak"
    hb_col = "hb_num" if source_table == "league" else "horzbreak"
    from_table = "public.pitch_events" if source_table == "league" else "public.pro_pitch_events"
    hand_sql = _hand_sql("pitcherthrows")
    pitch_type_sql = _pitch_type_case_sql("taggedpitchtype")

    return f"""
  rows_{source_table} AS (
    SELECT
      pitcher AS pitcher_key,
      pitcherteam AS pitcher_team_key,
      {level_expr_sql} AS level,
      {hand_sql} AS hand,
      {pitch_type_sql} AS pitch_type,
      {ivb_col} AS ivb_raw,
      CASE WHEN {hand_sql} = 'L' THEN -{hb_col} ELSE {hb_col} END AS hb_mirrored
    FROM {from_table}
    WHERE ({extra_where_sql})
      AND pitcher IS NOT NULL AND TRIM(pitcher) <> ''
      AND {ivb_col} IS NOT NULL AND {hb_col} IS NOT NULL
      AND {hand_sql} IS NOT NULL
  ),
  pitcher_base_avg_{source_table} AS (
    SELECT
      pitcher_key,
      pitcher_team_key,
      level,
      pitch_type AS base_pitch_type,
      AVG(ivb_raw) AS fb_ivb,
      AVG(hb_mirrored) AS fb_hb,
      COUNT(*) AS base_pitch_n
    FROM rows_{source_table}
    WHERE pitch_type IN ('Fastball', 'Sinker')
    GROUP BY pitcher_key, pitcher_team_key, level, pitch_type
    HAVING COUNT(*) >= 5
  ),
  pitcher_base_bucket_{source_table} AS (
    SELECT
      pitcher_key,
      pitcher_team_key,
      level,
      base_pitch_type,
      fb_ivb,
      fb_hb,
      (FLOOR(fb_ivb / 2.0) * 2)::int AS fb_ivb_bucket,
      (FLOOR(fb_hb / 2.0) * 2)::int AS fb_hb_bucket
    FROM pitcher_base_avg_{source_table}
  ),
  offspeed_offsets_{source_table} AS (
    SELECT
      b.level,
      b.base_pitch_type,
      b.fb_ivb_bucket,
      b.fb_hb_bucket,
      p.pitch_type AS offspeed_pitch_type,
      (p.ivb_raw - b.fb_ivb) AS ivb_offset,
      (p.hb_mirrored - b.fb_hb) AS hb_offset
    FROM rows_{source_table} p
    JOIN pitcher_base_bucket_{source_table} b
      ON b.pitcher_key = p.pitcher_key
      AND b.pitcher_team_key = p.pitcher_team_key
      AND b.level = p.level
    WHERE p.pitch_type IN ({", ".join(f"'{pt}'" for pt in _OFFSPEED_PITCH_TYPES)})
  ),
  cells_{source_table} AS (
    SELECT
      grouping_level,
      base_pitch_type,
      fb_ivb_bucket,
      fb_hb_bucket,
      offspeed_pitch_type,
      AVG(ivb_offset) AS avg_ivb_offset,
      AVG(hb_offset) AS avg_hb_offset,
      COUNT(*)::int AS sample_size
    FROM (
      SELECT level AS grouping_level, base_pitch_type, fb_ivb_bucket, fb_hb_bucket, offspeed_pitch_type, ivb_offset, hb_offset
      FROM offspeed_offsets_{source_table}
      UNION ALL
      SELECT 'ALL'::text AS grouping_level, base_pitch_type, fb_ivb_bucket, fb_hb_bucket, offspeed_pitch_type, ivb_offset, hb_offset
      FROM offspeed_offsets_{source_table}
    ) both_scopes
    GROUP BY grouping_level, base_pitch_type, fb_ivb_bucket, fb_hb_bucket, offspeed_pitch_type
  )
"""


def _build_sql() -> str:
    league_level_case = "CASE " + " ".join(f"WHEN level = '{lvl}' THEN '{lvl}'" for lvl in _LEAGUE_LEVELS) + " END"
    league_block = _source_cells_sql(
        source_table="league",
        level_expr_sql=league_level_case,
        extra_where_sql="school_code = 'LEAGUE' AND level IN (" + ", ".join(f"'{lvl}'" for lvl in _LEAGUE_LEVELS) + ")",
    )
    mlb_block = _source_cells_sql(
        source_table="pro",
        level_expr_sql="'MLB'::text",
        extra_where_sql=_MLB_FILTER_SQL,
    )

    return (
        "WITH " + league_block + ",\n" + mlb_block + "\n"
        "SELECT * FROM cells_league\n"
        "UNION ALL\n"
        "SELECT * FROM cells_pro"
    )


_UPSERT_SQL = """
INSERT INTO public.break_line_offsets_grid (
  level, base_pitch_type, fb_ivb_bucket, fb_hb_bucket, offspeed_pitch_type,
  avg_ivb_offset, avg_hb_offset, sample_size, used_fallback, updated_at
)
VALUES (
  %(level)s, %(base_pitch_type)s, %(fb_ivb_bucket)s, %(fb_hb_bucket)s, %(offspeed_pitch_type)s,
  %(avg_ivb_offset)s, %(avg_hb_offset)s, %(sample_size)s, %(used_fallback)s, NOW()
)
ON CONFLICT (level, base_pitch_type, fb_ivb_bucket, fb_hb_bucket, offspeed_pitch_type)
DO UPDATE SET
  avg_ivb_offset = EXCLUDED.avg_ivb_offset,
  avg_hb_offset = EXCLUDED.avg_hb_offset,
  sample_size = EXCLUDED.sample_size,
  used_fallback = EXCLUDED.used_fallback,
  updated_at = NOW()
"""

_DELETE_ALL_SQL = "DELETE FROM public.break_line_offsets_grid"


def _ensure_direct_connection() -> None:
    url = os.getenv("DASHBOARD_DATABASE_URL", "").strip() or os.getenv("DATABASE_URL", "").strip()
    if not url:
        return
    direct = url.replace("-pooler.", ".", 1)
    if direct != url:
        os.environ["DASHBOARD_DATABASE_URL"] = direct
        print("[refresh] Switched to direct connection (stripped pooler suffix).")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh break_line_offsets_grid.")
    parser.add_argument("--dry-run", action="store_true", help="Compute and print summary without writing rows.")
    parser.add_argument(
        "--keep-pooler",
        action="store_true",
        help="Keep the configured pooled database endpoint instead of switching to the direct endpoint",
    )
    parser.add_argument(
        "--statement-timeout-ms",
        type=int,
        default=0,
        help="Optional Postgres statement timeout for the aggregation query.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not args.keep_pooler:
        _ensure_direct_connection()

    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

    import psycopg
    from psycopg.rows import dict_row

    from dashboard_api.app.config import get_settings
    from dashboard_api.app.main import PRO_MLB_ONLY_TEAM_CODES, PRO_TEAM_CODE_OVERLAP

    start_time = time.monotonic()
    sql = _build_sql()

    params = {
        "mlb_only_team_codes": PRO_MLB_ONLY_TEAM_CODES,
        "overlap_team_codes": PRO_TEAM_CODE_OVERLAP,
    }

    with psycopg.connect(get_settings().database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_xact_lock(%(k)s) AS locked", {"k": _ADVISORY_LOCK_KEY})
            if not cur.fetchone()["locked"]:
                raise RuntimeError("another break_line_offsets_grid refresh is already running")

            cur.execute(_CREATE_TABLE_SQL)

            if args.statement_timeout_ms > 0:
                cur.execute("SELECT set_config('statement_timeout', %s, true)", (str(args.statement_timeout_ms),))

            print("[refresh] Computing cells (single pass per source table, all levels + ALL)...")
            t_query = time.monotonic()
            cur.execute(sql, params)
            rows = cur.fetchall()
            print(f"[refresh] Computed {len(rows)} raw cells in {time.monotonic() - t_query:.1f}s.")

            # 'ALL' rows come back once per source table (league, pro), each
            # already pooling that source's own levels internally. A cell
            # that both LEAGUE and MLB pitchers land in must be merged with a
            # pitch-count-weighted average here -- naively keeping only the
            # last-seen row (e.g. always MLB's) would silently drop LEAGUE
            # data out of the combined 'ALL' grid wherever both contribute.
            all_level_cells: dict[tuple, dict] = {}
            per_level_rows = []
            for row in rows:
                key = (row["base_pitch_type"], row["fb_ivb_bucket"], row["fb_hb_bucket"], row["offspeed_pitch_type"])
                if row["grouping_level"] == "ALL":
                    existing = all_level_cells.get(key)
                    if existing is None:
                        all_level_cells[key] = {
                            "avg_ivb_offset": row["avg_ivb_offset"],
                            "avg_hb_offset": row["avg_hb_offset"],
                            "sample_size": row["sample_size"],
                        }
                    else:
                        n1, n2 = existing["sample_size"], row["sample_size"]
                        total = n1 + n2
                        existing["avg_ivb_offset"] = (existing["avg_ivb_offset"] * n1 + row["avg_ivb_offset"] * n2) / total
                        existing["avg_hb_offset"] = (existing["avg_hb_offset"] * n1 + row["avg_hb_offset"] * n2) / total
                        existing["sample_size"] = total
                else:
                    per_level_rows.append(row)

            if args.dry_run:
                conn.rollback()
                print("[refresh] Dry run: no rows written.")
                _print_summary(per_level_rows, all_level_cells)
                return 0

            cur.execute(_DELETE_ALL_SQL)
            print(f"[refresh] Cleared {cur.rowcount} existing rows.")

            fallback_counts: dict[str, int] = {}
            level_counts: dict[str, int] = {}

            # Write ALL-level rows first (they are both real output rows and
            # the fallback source for sparse per-level cells).
            all_upsert_rows = []
            for (base_pitch_type, fb_ivb_bucket, fb_hb_bucket, offspeed_pitch_type), agg in all_level_cells.items():
                is_sparse = agg["sample_size"] < _MIN_SAMPLE_SIZE
                all_upsert_rows.append(
                    {
                        "level": "ALL",
                        "base_pitch_type": base_pitch_type,
                        "fb_ivb_bucket": fb_ivb_bucket,
                        "fb_hb_bucket": fb_hb_bucket,
                        "offspeed_pitch_type": offspeed_pitch_type,
                        "avg_ivb_offset": agg["avg_ivb_offset"],
                        "avg_hb_offset": agg["avg_hb_offset"],
                        "sample_size": agg["sample_size"],
                        # The 'ALL' level has no further fallback tier, but a
                        # sparse ALL cell is still the "best available data"
                        # -- mark it so consumers know to treat it cautiously.
                        "used_fallback": is_sparse,
                    }
                )
            cur.executemany(_UPSERT_SQL, all_upsert_rows)
            level_counts["ALL"] = len(all_upsert_rows)
            fallback_counts["ALL"] = sum(1 for r in all_upsert_rows if r["used_fallback"])

            per_level_upsert_rows = []
            for row in per_level_rows:
                level = row["grouping_level"]
                key = (row["base_pitch_type"], row["fb_ivb_bucket"], row["fb_hb_bucket"], row["offspeed_pitch_type"])
                sparse = row["sample_size"] < _MIN_SAMPLE_SIZE
                if not sparse:
                    avg_ivb_offset = row["avg_ivb_offset"]
                    avg_hb_offset = row["avg_hb_offset"]
                    used_fallback = False
                else:
                    fallback = all_level_cells.get(key)
                    if fallback is None:
                        # No ALL-level data either (shouldn't normally happen
                        # since ALL pools every level) -- keep the sparse
                        # per-level value as the best available data.
                        avg_ivb_offset = row["avg_ivb_offset"]
                        avg_hb_offset = row["avg_hb_offset"]
                    else:
                        avg_ivb_offset = fallback["avg_ivb_offset"]
                        avg_hb_offset = fallback["avg_hb_offset"]
                    used_fallback = True

                per_level_upsert_rows.append(
                    {
                        "level": level,
                        "base_pitch_type": row["base_pitch_type"],
                        "fb_ivb_bucket": row["fb_ivb_bucket"],
                        "fb_hb_bucket": row["fb_hb_bucket"],
                        "offspeed_pitch_type": row["offspeed_pitch_type"],
                        "avg_ivb_offset": avg_ivb_offset,
                        "avg_hb_offset": avg_hb_offset,
                        # sample_size reflects this cell's own (pre-fallback)
                        # contributing pitch count, per spec -- the fallback
                        # only replaces the averaged value, not the n.
                        "sample_size": row["sample_size"],
                        "used_fallback": used_fallback,
                    }
                )
                level_counts[level] = level_counts.get(level, 0) + 1
                if used_fallback:
                    fallback_counts[level] = fallback_counts.get(level, 0) + 1

            cur.executemany(_UPSERT_SQL, per_level_upsert_rows)

        conn.commit()

    elapsed = time.monotonic() - start_time
    print("[refresh] Summary:")
    for level in ["ALL", *_ALL_LEVELS]:
        total = level_counts.get(level, 0)
        fb = fallback_counts.get(level, 0)
        if total:
            print(f"  {level}: {total} cells, {fb} used_fallback ({fb / total:.0%})")
        else:
            print(f"  {level}: 0 cells")
    print(f"[refresh] Done in {elapsed:.1f}s.")
    return 0


def _print_summary(per_level_rows, all_level_cells) -> None:
    by_level: dict[str, int] = {}
    for row in per_level_rows:
        by_level[row["grouping_level"]] = by_level.get(row["grouping_level"], 0) + 1
    print("[refresh] Per-level cell counts (dry run, pre-fallback):")
    for level, n in sorted(by_level.items()):
        print(f"  {level}: {n} cells")
    print(f"[refresh] ALL-level cell count (dry run): {len(all_level_cells)}")


if __name__ == "__main__":
    raise SystemExit(main())
