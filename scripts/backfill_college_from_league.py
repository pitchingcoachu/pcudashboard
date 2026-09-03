#!/usr/bin/env python3
"""Copy one team's already-ingested LEAGUE rows into a college school scope."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
import posixpath
import re

import psycopg
from psycopg import sql


def normalize_team(value: str) -> str:
    return re.sub(r"[^A-Z0-9_]", "", str(value or "").strip().upper())


def required_database_url() -> str:
    value = os.getenv("DASHBOARD_DATABASE_URL", "").strip() or os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise RuntimeError("DASHBOARD_DATABASE_URL or DATABASE_URL is required")
    return value


def trackman_source_path(league_source_file: str, source_file_id: int) -> str:
    basename = posixpath.basename(str(league_source_file or ""))
    match = re.fullmatch(r"v3_(20\d{2})_(\d{2})_(\d{2})_(.+\.csv)", basename, flags=re.IGNORECASE)
    if not match:
        return f"league-copy://LEAGUE/{source_file_id}/{basename or 'unknown.csv'}"
    year, month, day, filename = match.groups()
    return f"trackman://v3/v3/{year}/{month}/{day}/CSV/{filename}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--school", required=True)
    parser.add_argument("--team-marker", action="append", required=True)
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    school_code = args.school.strip().upper()
    markers = sorted({normalize_team(value) for value in args.team_marker if normalize_team(value)})
    if not markers:
        raise RuntimeError("At least one non-empty team marker is required")

    with psycopg.connect(required_database_url()) as conn:
        source_files = conn.execute(
            """
            SELECT pdf.file_id, pdf.source_file, pdf.file_checksum, pdf.file_mtime,
                   COUNT(*)::bigint AS matching_rows
            FROM public.pitch_events pe
            JOIN public.pitch_data_files pdf ON pdf.file_id = pe.file_id
            WHERE pe.school_code = 'LEAGUE'
              AND pe.session_date BETWEEN %s::date AND %s::date
              AND (UPPER(COALESCE(pe.pitcherteam, '')) = ANY(%s::text[])
                   OR UPPER(COALESCE(pe.batterteam, '')) = ANY(%s::text[]))
            GROUP BY pdf.file_id, pdf.source_file, pdf.file_checksum, pdf.file_mtime
            ORDER BY pdf.file_id
            """,
            (args.start_date, args.end_date, markers, markers),
        ).fetchall()

        total_rows = sum(int(row[4]) for row in source_files)
        compatible = sum(trackman_source_path(str(row[1]), int(row[0])).startswith("trackman://") for row in source_files)
        print(
            f"LEAGUE -> {school_code}: files={len(source_files)}, rows={total_rows}, "
            f"trackman_compatible_paths={compatible}, markers={markers}"
        )
        if args.dry_run:
            return 0

        conn.execute("INSERT INTO public.schools (school_code) VALUES (%s) ON CONFLICT DO NOTHING", (school_code,))
        insertable_columns = [
            row[0]
            for row in conn.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'pitch_events'
                  AND is_generated = 'NEVER'
                  AND is_identity = 'NO'
                ORDER BY ordinal_position
                """
            ).fetchall()
            if row[0] not in {"id", "school_code", "file_id", "source_file", "created_at"}
        ]

        copied_files = copied_rows = 0
        for source_file_id, league_source, checksum, modified_at, _matching_rows in source_files:
            target_source = trackman_source_path(str(league_source), int(source_file_id))
            target_file_id = conn.execute(
                """
                INSERT INTO public.pitch_data_files
                  (school_code, source_file, file_checksum, file_mtime, row_count, loaded_at)
                VALUES (%s, %s, %s, %s, 0, NOW())
                ON CONFLICT (school_code, source_file) DO UPDATE SET
                  file_checksum = EXCLUDED.file_checksum,
                  file_mtime = EXCLUDED.file_mtime,
                  row_count = 0,
                  loaded_at = NOW()
                RETURNING file_id
                """,
                (
                    school_code,
                    target_source,
                    checksum or f"league-file-{source_file_id}",
                    modified_at or datetime.now(timezone.utc),
                ),
            ).fetchone()[0]
            conn.execute(
                "DELETE FROM public.pitch_events WHERE school_code = %s AND file_id = %s",
                (school_code, target_file_id),
            )

            target_columns = ["school_code", "file_id", "source_file", *insertable_columns]
            select_values = [sql.Placeholder(), sql.Placeholder(), sql.Placeholder()]
            select_values.extend(sql.Identifier(column) for column in insertable_columns)
            statement = sql.SQL(
                "INSERT INTO public.pitch_events ({target_columns}) "
                "SELECT {select_values} FROM public.pitch_events "
                "WHERE school_code = 'LEAGUE' AND file_id = %s "
                "AND (UPPER(COALESCE(pitcherteam, '')) = ANY(%s::text[]) "
                "OR UPPER(COALESCE(batterteam, '')) = ANY(%s::text[])) "
                "ON CONFLICT DO NOTHING"
            ).format(
                target_columns=sql.SQL(", ").join(sql.Identifier(column) for column in target_columns),
                select_values=sql.SQL(", ").join(select_values),
            )
            conn.execute(
                statement,
                (school_code, target_file_id, target_source, source_file_id, markers, markers),
            )
            inserted = conn.execute(
                "SELECT COUNT(*) FROM public.pitch_events WHERE school_code = %s AND file_id = %s",
                (school_code, target_file_id),
            ).fetchone()[0]
            conn.execute(
                "UPDATE public.pitch_data_files SET row_count = %s, loaded_at = NOW() WHERE file_id = %s",
                (inserted, target_file_id),
            )
            conn.commit()
            copied_files += 1
            copied_rows += int(inserted)

        print(f"Copied: files={copied_files}, rows={copied_rows}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
