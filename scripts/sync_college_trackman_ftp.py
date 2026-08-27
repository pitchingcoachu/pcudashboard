#!/usr/bin/env python3
"""Incrementally sync one school's TrackMan FTP CSVs into shared Postgres.

This replaces the per-school R/Shiny download and ingestion jobs. It reads a
small date window directly from TrackMan, keeps only rows belonging to the
requested school, and writes them into the shared pitch_events tables.
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import ftplib
import hashlib
import io
import os
import posixpath
import re
from typing import Iterable

import psycopg
from psycopg import sql


DEFAULT_COLUMN_ALIASES = {
    "ivb": "inducedvertbreak",
    "hb": "horzbreak",
    "velo": "relspeed",
    "releaseangle": "releasetilt",
    "spinaxis3dtransverseangle": "releasetilt",
    "breakangle": "breaktilt",
    "spinaxis": "breaktilt",
    "spineff": "spinefficiency",
    "spinaxis3dspinefficiency": "spinefficiency",
    "spin": "spinrate",
    "relz": "relheight",
    "relx": "relside",
    "vaa": "vertapprangle",
    "haa": "horzapprangle",
    "platex": "platelocside",
    "platez": "platelocheight",
    "pitcherteam": "pitcherteam",
    "batterteam": "batterteam",
    "hometeam": "hometeam",
    "awayteam": "awayteam",
}


@dataclass(frozen=True)
class RemoteCsv:
    source: str
    path: str
    payload: bytes
    modified_at: datetime


def normalize_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


def normalize_team(value: str) -> str:
    return re.sub(r"[^A-Z0-9_]", "", str(value or "").strip().upper())


def person_name_keys(value: str) -> set[str]:
    value = re.sub(r"\s+", " ", str(value or "").strip())
    if not value:
        return set()
    keys = {normalize_key(value)}
    if "," in value:
        last, first = value.split(",", 1)
        keys.add(normalize_key(f"{first} {last}"))
    else:
        parts = value.split()
        if len(parts) >= 2:
            keys.add(normalize_key(f"{parts[-1]} {' '.join(parts[:-1])}"))
    return {key for key in keys if key}


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable {name} is missing.")
    return value


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def iter_dates(start: date, end: date) -> Iterable[date]:
    current = start
    while current <= end:
        yield current
        current += timedelta(days=1)


def ftp_names(ftp: ftplib.FTP, directory: str) -> list[str]:
    try:
        names = ftp.nlst(directory)
    except ftplib.error_perm as exc:
        if str(exc).startswith("550"):
            return []
        raise
    return sorted({posixpath.basename(name.rstrip("/")) for name in names if name.rstrip("/")})


def ftp_modified_at(ftp: ftplib.FTP, path: str) -> datetime:
    try:
        response = ftp.sendcmd(f"MDTM {path}")
        return datetime.strptime(response.split()[-1], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def ftp_download(ftp: ftplib.FTP, path: str) -> bytes:
    chunks: list[bytes] = []
    ftp.retrbinary(f"RETR {path}", chunks.append)
    return b"".join(chunks)


def discover_paths(ftp: ftplib.FTP, source: str, start: date, end: date) -> list[str]:
    paths: list[str] = []
    for day in iter_dates(start, end):
        base = f"/{source}/{day:%Y/%m/%d}"
        candidates = [base]
        if source == "v3":
            names = ftp_names(ftp, base)
            if "CSV" in names:
                candidates = [f"{base}/CSV"]
        for directory in candidates:
            for name in ftp_names(ftp, directory):
                lower = name.lower()
                if not lower.endswith(".csv") or "_fhc" in lower or "json" in lower:
                    continue
                paths.append(f"{directory}/{name}")
    return sorted(set(paths))


def fetch_remote_csvs(source: str, start: date, end: date) -> Iterable[RemoteCsv]:
    prefix = "TRACKMAN_PRACTICE" if source == "practice" else "TRACKMAN_V3"
    host = os.getenv("TRACKMAN_FTP_HOST", "ftp.trackmanbaseball.com").strip()
    user = required_env(f"{prefix}_FTP_USER")
    password = required_env(f"{prefix}_FTP_PASSWORD")
    with ftplib.FTP(host, timeout=45) as ftp:
        ftp.login(user=user, passwd=password)
        ftp.set_pasv(True)
        paths = discover_paths(ftp, source, start, end)
        print(f"[{source}] discovered {len(paths)} CSV files")
        for index, path in enumerate(paths, start=1):
            try:
                yield RemoteCsv(
                    source=source,
                    path=path,
                    payload=ftp_download(ftp, path),
                    modified_at=ftp_modified_at(ftp, path),
                )
            except Exception as exc:
                print(f"[{source}] skipped {path}: {exc}")
            if index % 50 == 0:
                print(f"[{source}] downloaded {index}/{len(paths)}")


def decode_csv(payload: bytes) -> list[dict[str, str]]:
    text = payload.decode("utf-8-sig", errors="replace")
    return [{str(k or "").strip(): str(v or "").strip() for k, v in row.items()} for row in csv.DictReader(io.StringIO(text))]


def find_value(row: dict[str, str], *candidates: str) -> str:
    by_key = {normalize_key(key): value for key, value in row.items()}
    for candidate in candidates:
        value = by_key.get(normalize_key(candidate), "")
        if value:
            return value
    return ""


def filter_school_rows(rows: list[dict[str, str]], markers: set[str], roster_keys: set[str]) -> list[dict[str, str]]:
    kept = []
    for row in rows:
        pitcher_team = normalize_team(find_value(row, "PitcherTeam", "pitcher_team", "Pitcher Team"))
        batter_team = normalize_team(find_value(row, "BatterTeam", "batter_team", "Batter Team"))
        row_name_keys = {
            normalize_key(find_value(row, "Pitcher")),
            normalize_key(find_value(row, "Batter")),
            normalize_key(find_value(row, "Catcher")),
        }
        row_name_keys.discard("")
        if pitcher_team in markers or batter_team in markers or bool(row_name_keys & roster_keys):
            kept.append(row)
    return kept


def load_roster_keys(database_url: str, school_code: str) -> set[str]:
    with psycopg.connect(database_url) as conn:
        rows = conn.execute(
            """SELECT p.full_name
               FROM public.players p
               JOIN public.organizations o ON o.id = p.organization_id
               WHERE UPPER(TRIM(o.name)) = %s
                 AND LOWER(COALESCE(NULLIF(TRIM(p.status), ''), 'active')) <> 'inactive'""",
            (school_code,),
        ).fetchall()
    keys: set[str] = set()
    for row in rows:
        keys.update(person_name_keys(row[0]))
    return keys


def session_date(row: dict[str, str], path: str) -> date | None:
    raw = find_value(row, "Date")
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%y-%m-%d", "%m/%d/%y"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            pass
    match = re.search(r"(20\d{2})[/_-](0[1-9]|1[0-2])[/_-](0[1-9]|[12]\d|3[01])", path)
    return parse_date("-".join(match.groups())) if match else None


def pitch_key(row: dict[str, str]) -> str:
    for candidate in ("PitchKey", "PitchUID", "PitchID", "PitchGuid", "PlayID"):
        value = find_value(row, candidate)
        if value:
            return value
    parts = [
        find_value(row, name)
        for name in (
            "Date", "Pitcher", "Batter", "PlayID", "PitchCall", "PlayResult",
            "TaggedPitchType", "Balls", "Strikes", "RelSpeed", "InducedVertBreak",
            "HorzBreak", "Extension", "PlateLocSide", "PlateLocHeight",
        )
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:16]


def database_columns(conn: psycopg.Connection) -> dict[str, str]:
    rows = conn.execute(
        """SELECT column_name FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'pitch_events'"""
    ).fetchall()
    return {normalize_key(row[0]): row[0] for row in rows}


def source_column_map(row: dict[str, str], db_columns: dict[str, str]) -> dict[str, str]:
    mapped: dict[str, str] = {}
    for source_name, value in row.items():
        normalized = normalize_key(source_name)
        target_normalized = DEFAULT_COLUMN_ALIASES.get(normalized, normalized)
        target = db_columns.get(target_normalized)
        if target and target not in {"id", "school_code", "file_id", "session_date", "session_type", "source_file", "pitch_key", "created_at"}:
            mapped[target] = value or None
    return mapped


def ensure_school(conn: psycopg.Connection, school_code: str) -> None:
    conn.execute("INSERT INTO public.schools (school_code) VALUES (%s) ON CONFLICT DO NOTHING", (school_code,))


def sync_file(
    conn: psycopg.Connection,
    remote: RemoteCsv,
    school_code: str,
    markers: set[str],
    roster_keys: set[str],
) -> tuple[int, bool]:
    stable_source = f"trackman://{remote.source}{remote.path}"
    checksum = hashlib.sha256(remote.payload).hexdigest()
    rows = filter_school_rows(decode_csv(remote.payload), markers, roster_keys)
    existing = conn.execute(
        """SELECT file_id, file_checksum, row_count FROM public.pitch_data_files
           WHERE school_code = %s AND source_file = %s""",
        (school_code, stable_source),
    ).fetchone()
    if existing and existing[1] == checksum:
        actual = conn.execute(
            "SELECT COUNT(*) FROM public.pitch_events WHERE school_code = %s AND file_id = %s",
            (school_code, existing[0]),
        ).fetchone()[0]
        if actual == (existing[2] or 0) and (actual > 0 or not rows):
            return 0, True

    ensure_school(conn, school_code)
    file_id = conn.execute(
        """INSERT INTO public.pitch_data_files
             (school_code, source_file, file_checksum, file_mtime, row_count, loaded_at)
           VALUES (%s, %s, %s, %s, 0, NOW())
           ON CONFLICT (school_code, source_file) DO UPDATE SET
             file_checksum = EXCLUDED.file_checksum,
             file_mtime = EXCLUDED.file_mtime,
             row_count = 0,
             loaded_at = NOW()
           RETURNING file_id""",
        (school_code, stable_source, checksum, remote.modified_at),
    ).fetchone()[0]
    conn.execute("DELETE FROM public.pitch_events WHERE school_code = %s AND file_id = %s", (school_code, file_id))

    if rows:
        db_columns = database_columns(conn)
        payloads: list[dict[str, object]] = []
        for row in rows:
            payload = source_column_map(row, db_columns)
            payload.update(
                school_code=school_code,
                file_id=file_id,
                session_date=session_date(row, remote.path),
                session_type=find_value(row, "SessionType") or ("Bullpen" if remote.source == "practice" else "Live"),
                source_file=stable_source,
                pitch_key=pitch_key(row),
            )
            payloads.append(payload)
        columns = sorted(set.intersection(*(set(payload) for payload in payloads)))
        statement = sql.SQL("INSERT INTO public.pitch_events ({}) VALUES ({}) ON CONFLICT DO NOTHING").format(
            sql.SQL(", ").join(map(sql.Identifier, columns)),
            sql.SQL(", ").join(sql.Placeholder() for _ in columns),
        )
        with conn.cursor() as cur:
            cur.executemany(statement, [[payload[column] for column in columns] for payload in payloads])

    inserted = conn.execute(
        "SELECT COUNT(*) FROM public.pitch_events WHERE school_code = %s AND file_id = %s",
        (school_code, file_id),
    ).fetchone()[0]
    conn.execute(
        "UPDATE public.pitch_data_files SET row_count = %s, loaded_at = NOW() WHERE file_id = %s",
        (inserted, file_id),
    )
    return inserted, False


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--school", required=True)
    parser.add_argument("--team-marker", action="append", default=[])
    parser.add_argument("--start-date", default="")
    parser.add_argument("--end-date", default="")
    parser.add_argument("--lookback-days", type=int, default=7)
    parser.add_argument("--source", action="append", choices=("practice", "v3"), default=[])
    parser.add_argument("--dry-run", action="store_true", help="Download and filter files without writing to Postgres")
    args = parser.parse_args()

    school_code = args.school.strip().upper()
    end = parse_date(args.end_date) if args.end_date else datetime.now(timezone.utc).date()
    start = parse_date(args.start_date) if args.start_date else end - timedelta(days=max(0, args.lookback_days - 1))
    if start > end:
        raise RuntimeError("start-date must be on or before end-date")
    sources = args.source or ["practice", "v3"]
    markers = {normalize_team(school_code), *(normalize_team(value) for value in args.team_marker)}
    markers.discard("")
    database_url = os.getenv("DASHBOARD_DATABASE_URL", "").strip() or os.getenv("DATABASE_URL", "").strip()
    roster_keys = load_roster_keys(database_url, school_code) if database_url else set()
    print(
        f"Syncing {school_code} from {start} through {end}; "
        f"markers={sorted(markers)}, roster_name_keys={len(roster_keys)}"
    )
    files_seen = files_skipped = rows_inserted = 0
    if args.dry_run:
        matched_files = matched_rows = failed_sources = 0
        for source in sources:
            try:
                for remote in fetch_remote_csvs(source, start, end):
                    files_seen += 1
                    rows = filter_school_rows(decode_csv(remote.payload), markers, roster_keys)
                    if rows:
                        matched_files += 1
                        matched_rows += len(rows)
                        matched_names = sorted({
                            name
                            for row in rows
                            for name in (find_value(row, "Pitcher"), find_value(row, "Batter"), find_value(row, "Catcher"))
                            if normalize_key(name) in roster_keys
                        })
                        print(
                            f"[{source}] {remote.path}: {len(rows)} matching rows; "
                            f"roster_players={matched_names}"
                        )
            except Exception as exc:
                failed_sources += 1
                print(f"[{source}] source unavailable: {exc}")
        print(f"Dry run complete: files_seen={files_seen}, matched_files={matched_files}, matched_rows={matched_rows}")
        return 1 if failed_sources == len(sources) else 0

    database_url = database_url or required_env("DATABASE_URL")
    failed_sources = 0
    with psycopg.connect(database_url) as conn:
        for source in sources:
            try:
                for remote in fetch_remote_csvs(source, start, end):
                    files_seen += 1
                    try:
                        inserted, skipped = sync_file(conn, remote, school_code, markers, roster_keys)
                        conn.commit()
                        rows_inserted += inserted
                        files_skipped += int(skipped)
                        if inserted:
                            print(f"[{source}] {remote.path}: {inserted} rows")
                    except Exception:
                        conn.rollback()
                        raise
            except Exception as exc:
                failed_sources += 1
                print(f"[{source}] source unavailable: {exc}")
    print(f"Complete: files_seen={files_seen}, unchanged={files_skipped}, rows_inserted={rows_inserted}")
    return 1 if failed_sources == len(sources) else 0


if __name__ == "__main__":
    raise SystemExit(main())
