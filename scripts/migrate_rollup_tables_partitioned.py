#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import sys
import time
import zlib
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Sequence

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dashboard_api.app.main import get_conn


@dataclass(frozen=True)
class RollupTablePlan:
    source_table: str
    tmp_table: str
    advisory_key: str
    index_ddls: Sequence[str]


PLANS: tuple[RollupTablePlan, ...] = (
    RollupTablePlan(
        source_table="pitch_events_daily_rollup_league",
        tmp_table="pitch_events_daily_rollup_league_part",
        advisory_key="rollup_partition_migration_league",
        index_ddls=(
            "CREATE INDEX IF NOT EXISTS idx_rollup_league_part_school_date ON public.pitch_events_daily_rollup_league_part (school_code, session_date)",
            "CREATE INDEX IF NOT EXISTS idx_rollup_league_part_school_date_pitcher ON public.pitch_events_daily_rollup_league_part (school_code, session_date, pitcher_norm)",
            "CREATE INDEX IF NOT EXISTS idx_rollup_league_part_school_date_team ON public.pitch_events_daily_rollup_league_part (school_code, session_date, pitcher_team_norm)",
            "CREATE INDEX IF NOT EXISTS idx_rollup_league_part_school_date_pitch_type ON public.pitch_events_daily_rollup_league_part (school_code, session_date, pitch_type)",
        ),
    ),
    RollupTablePlan(
        source_table="pitch_events_daily_rollup_league_split",
        tmp_table="pitch_events_daily_rollup_league_split_part",
        advisory_key="rollup_partition_migration_league_split",
        index_ddls=(
            "CREATE INDEX IF NOT EXISTS idx_rollup_league_split_part_school_date_group ON public.pitch_events_daily_rollup_league_split_part (school_code, session_date, split_group)",
            "CREATE INDEX IF NOT EXISTS idx_rollup_league_split_part_school_date_pitcher ON public.pitch_events_daily_rollup_league_split_part (school_code, session_date, split_group, pitcher_norm)",
            "CREATE INDEX IF NOT EXISTS idx_rollup_league_split_part_school_date_team ON public.pitch_events_daily_rollup_league_split_part (school_code, session_date, split_group, pitcher_team_norm)",
        ),
    ),
    RollupTablePlan(
        source_table="pro_pitch_events_daily_rollup",
        tmp_table="pro_pitch_events_daily_rollup_part",
        advisory_key="rollup_partition_migration_pro",
        index_ddls=(
            "CREATE INDEX IF NOT EXISTS idx_pro_rollup_part_date_level ON public.pro_pitch_events_daily_rollup_part (school_code, session_date, level_bucket)",
            "CREATE INDEX IF NOT EXISTS idx_pro_rollup_part_date_pitcher ON public.pro_pitch_events_daily_rollup_part (school_code, session_date, pitcher_norm)",
            "CREATE INDEX IF NOT EXISTS idx_pro_rollup_part_date_batter ON public.pro_pitch_events_daily_rollup_part (school_code, session_date, batter_norm)",
            "CREATE INDEX IF NOT EXISTS idx_pro_rollup_part_date_team_pitch_type ON public.pro_pitch_events_daily_rollup_part (school_code, session_date, pitcher_team_code, pitch_type)",
        ),
    ),
    RollupTablePlan(
        source_table="pro_pitch_events_daily_rollup_split",
        tmp_table="pro_pitch_events_daily_rollup_split_part",
        advisory_key="rollup_partition_migration_pro_split",
        index_ddls=(
            "CREATE INDEX IF NOT EXISTS idx_pro_rollup_split_part_school_date_group ON public.pro_pitch_events_daily_rollup_split_part (school_code, session_date, split_group)",
            "CREATE INDEX IF NOT EXISTS idx_pro_rollup_split_part_school_date_pitcher ON public.pro_pitch_events_daily_rollup_split_part (school_code, session_date, split_group, pitcher_norm)",
            "CREATE INDEX IF NOT EXISTS idx_pro_rollup_split_part_school_date_team ON public.pro_pitch_events_daily_rollup_split_part (school_code, session_date, split_group, pitcher_team_code)",
        ),
    ),
)


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} must be set")
    return value


def _relation_partition_strategy(cur, rel_name: str) -> str | None:
    cur.execute(
        """
        SELECT pt.partstrat
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_partitioned_table pt ON pt.partrelid = c.oid
        WHERE n.nspname = 'public' AND c.relname = %(rel)s
        """,
        {"rel": rel_name},
    )
    row = cur.fetchone()
    if not row:
        raise RuntimeError(f"public.{rel_name} not found")
    return row.get("partstrat")


def _first_of_month(d: date) -> date:
    return date(d.year, d.month, 1)


def _add_months(d: date, n: int = 1) -> date:
    month = d.month - 1 + n
    year = d.year + (month // 12)
    month = (month % 12) + 1
    return date(year, month, 1)


def _is_monthly_partitioned(cur, rel_name: str) -> bool:
    cur.execute(
        """
        SELECT
          c.relname AS child_name,
          pg_get_expr(c.relpartbound, c.oid) AS bound_expr
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        JOIN pg_class p ON p.oid = i.inhparent
        JOIN pg_namespace n ON n.oid = p.relnamespace
        WHERE n.nspname = 'public'
          AND p.relname = %(rel)s
        ORDER BY c.relname
        """,
        {"rel": rel_name},
    )
    rows = cur.fetchall() or []
    non_default = [r for r in rows if str(r.get("bound_expr") or "").strip().upper() != "DEFAULT"]
    if not non_default:
        return False
    pattern = re.compile(
        r"FOR VALUES FROM \('(\d{4})-(\d{2})-(\d{2})'\) TO \('(\d{4})-(\d{2})-(\d{2})'\)",
        re.IGNORECASE,
    )
    for row in non_default:
        bound = str(row.get("bound_expr") or "").strip()
        match = pattern.fullmatch(bound)
        if not match:
            return False
        y1, m1, d1, y2, m2, d2 = [int(v) for v in match.groups()]
        start = date(y1, m1, d1)
        end = date(y2, m2, d2)
        if start.day != 1:
            return False
        if end != _add_months(start, 1):
            return False
    return True


def _safe_partition_child_name(source: str, backup_suffix: str, period_token: str) -> str:
    prefix = re.sub(r"[^a-z0-9]+", "_", source.lower()).strip("_")[:20] or "rollup"
    source_hash = f"{zlib.crc32(source.encode('utf-8')) & 0xFFFF:04x}"
    short = backup_suffix[-6:]
    return f"{prefix}_{source_hash}_{short}_{period_token}"


def _acquire_lock(cur, key: str) -> None:
    for _ in range(180):
        cur.execute("SELECT pg_try_advisory_xact_lock(hashtext(%(k)s)) AS locked", {"k": key})
        row = cur.fetchone() or {}
        if bool(row.get("locked")):
            return
        time.sleep(1.0)
    raise RuntimeError(f"Could not acquire advisory lock for {key}")


def _migrate_one(cur, plan: RollupTablePlan, backup_suffix: str) -> bool:
    source = plan.source_table
    tmp = f"{plan.tmp_table}_{backup_suffix}"
    backup_base = f"{source}_bak_{backup_suffix}"
    backup = backup_base

    partstrat = _relation_partition_strategy(cur, source)
    if partstrat is not None and _is_monthly_partitioned(cur, source):
        print(f"public.{source} already monthly-partitioned; skipping.")
        return False

    _acquire_lock(cur, plan.advisory_key)
    cur.execute("SELECT to_regclass(%(tmp)s)::text AS tmp_ref", {"tmp": f"public.{tmp}"})
    refs = cur.fetchone() or {}
    if refs.get("tmp_ref"):
        raise RuntimeError(f"public.{tmp} already exists; clean up and retry")
    suffix_counter = 1
    while True:
        cur.execute("SELECT to_regclass(%(backup)s)::text AS backup_ref", {"backup": f"public.{backup}"})
        backup_ref = (cur.fetchone() or {}).get("backup_ref")
        if not backup_ref:
            break
        backup = f"{backup_base}_{suffix_counter}"
        suffix_counter += 1

    print(f"Locking public.{source}...")
    cur.execute(f"LOCK TABLE public.{source} IN ACCESS EXCLUSIVE MODE")

    cur.execute(
        f"""
        SELECT
          MIN(session_date)::date AS min_date,
          MAX(session_date)::date AS max_date,
          COUNT(*)::bigint AS row_count
        FROM public.{source}
        """
    )
    bounds = cur.fetchone() or {}
    min_date_val = bounds.get("min_date")
    max_date_val = bounds.get("max_date")
    min_date = _first_of_month(min_date_val) if isinstance(min_date_val, date) else _first_of_month(date.today())
    max_date = _first_of_month(max_date_val) if isinstance(max_date_val, date) else min_date
    # Build one month ahead so current/future sync does not immediately hit default.
    partition_end = _add_months(max_date, 2)
    source_rows = int(bounds.get("row_count") or 0)

    print(
        f"Creating monthly partitioned copy public.{tmp} "
        f"from {min_date.isoformat()} to {partition_end.isoformat()}"
    )
    cur.execute(
        f"""
        CREATE TABLE public.{tmp}
        (LIKE public.{source} INCLUDING DEFAULTS INCLUDING GENERATED INCLUDING IDENTITY INCLUDING STORAGE INCLUDING COMMENTS INCLUDING CONSTRAINTS)
        PARTITION BY RANGE (session_date)
        """
    )

    current = min_date
    while current < partition_end:
        next_month = _add_months(current, 1)
        suffix = f"{current.year}{current.month:02d}"
        child_name = _safe_partition_child_name(source, backup_suffix, suffix)
        cur.execute(
            f"""
            CREATE TABLE public.{child_name}
            PARTITION OF public.{tmp}
            FOR VALUES FROM ('{current.isoformat()}') TO ('{next_month.isoformat()}')
            """
        )
        current = next_month

    default_child = _safe_partition_child_name(source, backup_suffix, "default")
    cur.execute(
        f"""
        CREATE TABLE public.{default_child}
        PARTITION OF public.{tmp} DEFAULT
        """
    )

    for stmt in plan.index_ddls:
        cur.execute(stmt.replace(plan.tmp_table, tmp))

    print(f"Copying rows into public.{tmp}...")
    cur.execute(
        f"""
        INSERT INTO public.{tmp}
        SELECT *
        FROM public.{source}
        """
    )

    cur.execute(f"SELECT COUNT(*)::bigint AS c FROM public.{tmp}")
    copied_rows = int((cur.fetchone() or {}).get("c") or 0)
    if copied_rows != source_rows:
        raise RuntimeError(
            f"Row-count mismatch for {source}: source={source_rows}, copied={copied_rows}"
        )

    print(f"Swapping public.{source} -> public.{backup}; public.{tmp} -> public.{source}")
    cur.execute(f"ALTER TABLE public.{source} RENAME TO {backup}")
    cur.execute(f"ALTER TABLE public.{tmp} RENAME TO {source}")

    print(f"Done migrating {source}. Backup kept as public.{backup}")
    return True


def main() -> int:
    _require_env("DASHBOARD_DATABASE_URL")
    backup_suffix = datetime.utcnow().strftime("%Y%m%d%H%M%S")
    migrated_count = 0

    for plan in PLANS:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SET lock_timeout = '0'")
                cur.execute("SET statement_timeout = '0'")
                if _migrate_one(cur, plan, backup_suffix=backup_suffix):
                    migrated_count += 1
            conn.commit()

    print(f"Rollup partition migration completed. Tables migrated: {migrated_count}/{len(PLANS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
