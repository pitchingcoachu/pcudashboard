#!/usr/bin/env python3
"""Remove duplicate TrackMan V3 pitches while retaining a recoverable backup."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import os
import re

import psycopg
from psycopg import sql


def database_url() -> str:
    value = os.getenv("DASHBOARD_DATABASE_URL", "").strip() or os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise RuntimeError("DASHBOARD_DATABASE_URL or DATABASE_URL is required")
    return value.replace("-pooler.", ".", 1)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--school", action="append", required=True, help="School code to repair; repeat as needed")
    parser.add_argument("--apply", action="store_true", help="Apply the repair; otherwise only report counts")
    parser.add_argument("--backup-table", default="", help="Optional public-schema backup table name")
    args = parser.parse_args()

    schools = sorted({value.strip().upper() for value in args.school if value.strip()})
    if not schools:
        raise RuntimeError("At least one non-empty --school is required")

    with psycopg.connect(database_url()) as conn:
        duplicate_count = conn.execute(
            """
            SELECT COALESCE(SUM(duplicate_rows), 0)::bigint
            FROM (
              SELECT COUNT(*) - 1 AS duplicate_rows
              FROM public.pitch_events
              WHERE school_code = ANY(%s)
                AND source_file LIKE 'trackman://v3/%%'
                AND NULLIF(BTRIM(pitch_key), '') IS NOT NULL
              GROUP BY school_code, pitch_key
              HAVING COUNT(*) > 1
            ) AS groups
            """,
            (schools,),
        ).fetchone()[0]
        print(f"Duplicate V3 rows in {', '.join(schools)}: {duplicate_count:,}")
        if not args.apply or duplicate_count == 0:
            return 0

        backup_table = args.backup_table.strip() or (
            "pitch_events_v3_dedupe_backup_" + datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        )
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", backup_table):
            raise RuntimeError("Backup table must be a lowercase PostgreSQL identifier of at most 63 characters")

        with conn.transaction():
            conn.execute("SET LOCAL lock_timeout = '30s'")
            conn.execute("SET LOCAL statement_timeout = '1200s'")
            conn.execute("SET LOCAL work_mem = '256MB'")
            conn.execute("LOCK TABLE public.pitch_events IN SHARE ROW EXCLUSIVE MODE")
            if conn.execute("SELECT to_regclass(%s)", (f"public.{backup_table}",)).fetchone()[0]:
                raise RuntimeError(f"Backup table public.{backup_table} already exists")

            conn.execute(
                """
                CREATE TEMP TABLE v3_duplicate_ids ON COMMIT DROP AS
                WITH ranked AS (
                SELECT id, school_code, session_date,
                       ROW_NUMBER() OVER (
                         PARTITION BY school_code, pitch_key
                         ORDER BY
                           CASE WHEN source_file ~* '_unverified\\.csv$' THEN 1 ELSE 0 END,
                           created_at DESC NULLS LAST,
                           id DESC
                       ) AS duplicate_rank
                FROM public.pitch_events
                WHERE school_code = ANY(%s)
                  AND source_file LIKE 'trackman://v3/%%'
                  AND NULLIF(BTRIM(pitch_key), '') IS NOT NULL
                )
                SELECT id, school_code, session_date
                FROM ranked
                WHERE duplicate_rank > 1
                """,
                (schools,),
            )
            conn.execute(
                "CREATE UNIQUE INDEX ON v3_duplicate_ids (school_code, session_date, id)"
            )
            selected_count = conn.execute("SELECT COUNT(*) FROM v3_duplicate_ids").fetchone()[0]
            if selected_count != duplicate_count:
                raise RuntimeError(
                    f"Duplicate selection changed during repair: expected {duplicate_count:,}, found {selected_count:,}"
                )

            conn.execute(
                sql.SQL("CREATE TABLE public.{} (LIKE public.pitch_events INCLUDING COMMENTS)").format(
                    sql.Identifier(backup_table)
                )
            )
            batches = conn.execute(
                """
                SELECT school_code, date_trunc('month', session_date)::date AS month_start
                FROM v3_duplicate_ids
                GROUP BY school_code, date_trunc('month', session_date)::date
                ORDER BY 1, 2 NULLS FIRST
                """
            ).fetchall()
            for school_code, month_start in batches:
                if month_start is None:
                    date_predicate = sql.SQL("pe.session_date IS NULL AND duplicate_ids.session_date IS NULL")
                    params = (school_code,)
                else:
                    date_predicate = sql.SQL(
                        "pe.session_date >= %s::date AND pe.session_date < (%s::date + INTERVAL '1 month')"
                    )
                    params = (school_code, month_start, month_start)
                conn.execute(
                    sql.SQL(
                        """
                        INSERT INTO public.{}
                        SELECT pe.*
                        FROM public.pitch_events AS pe
                        JOIN v3_duplicate_ids AS duplicate_ids
                          ON duplicate_ids.school_code = pe.school_code
                         AND duplicate_ids.session_date IS NOT DISTINCT FROM pe.session_date
                         AND duplicate_ids.id = pe.id
                        WHERE pe.school_code = %s
                          AND {}
                        """
                    ).format(sql.Identifier(backup_table), date_predicate),
                    params,
                )
            backup_count = conn.execute(
                sql.SQL("SELECT COUNT(*) FROM public.{}").format(sql.Identifier(backup_table))
            ).fetchone()[0]
            if backup_count != duplicate_count:
                raise RuntimeError(
                    f"Backup count changed during repair: expected {duplicate_count:,}, found {backup_count:,}"
                )

            deleted_count = 0
            for school_code, month_start in batches:
                if month_start is None:
                    date_predicate = sql.SQL("pe.session_date IS NULL AND duplicate_ids.session_date IS NULL")
                    params = (school_code,)
                else:
                    date_predicate = sql.SQL(
                        "pe.session_date >= %s::date AND pe.session_date < (%s::date + INTERVAL '1 month')"
                    )
                    params = (school_code, month_start, month_start)
                deleted_count += conn.execute(
                    sql.SQL(
                        """
                        DELETE FROM public.pitch_events AS pe
                        USING v3_duplicate_ids AS duplicate_ids
                        WHERE pe.school_code = %s
                          AND pe.school_code = duplicate_ids.school_code
                          AND pe.session_date IS NOT DISTINCT FROM duplicate_ids.session_date
                          AND pe.id = duplicate_ids.id
                          AND {}
                        """
                    ).format(date_predicate),
                    params,
                ).rowcount
            if deleted_count != backup_count:
                raise RuntimeError(f"Deleted {deleted_count:,} rows but backed up {backup_count:,}")

            conn.execute(
                """
                WITH counts AS (
                  SELECT pdf.file_id, COUNT(pe.id)::integer AS row_count
                  FROM public.pitch_data_files AS pdf
                  LEFT JOIN public.pitch_events AS pe
                    ON pe.school_code = pdf.school_code
                   AND pe.file_id = pdf.file_id
                  WHERE pdf.school_code = ANY(%s)
                  GROUP BY pdf.file_id
                )
                UPDATE public.pitch_data_files AS pdf
                SET row_count = counts.row_count,
                    loaded_at = NOW()
                FROM counts
                WHERE pdf.file_id = counts.file_id
                """,
                (schools,),
            )
            remaining = conn.execute(
                """
                SELECT COALESCE(SUM(row_count - 1), 0)::bigint
                FROM (
                  SELECT COUNT(*) AS row_count
                  FROM public.pitch_events
                  WHERE school_code = ANY(%s)
                    AND source_file LIKE 'trackman://v3/%%'
                    AND NULLIF(BTRIM(pitch_key), '') IS NOT NULL
                  GROUP BY school_code, pitch_key
                  HAVING COUNT(*) > 1
                ) AS duplicate_groups
                """,
                (schools,),
            ).fetchone()[0]
            if remaining:
                raise RuntimeError(f"Repair left {remaining:,} duplicate V3 rows")

        print(f"Deleted {deleted_count:,} duplicate rows.")
        print(f"Backup: public.{backup_table} ({backup_count:,} rows)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
