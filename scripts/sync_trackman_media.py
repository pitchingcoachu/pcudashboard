#!/usr/bin/env python3
"""Sync TrackMan session videos to Cloudinary for one dashboard school."""

from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import hashlib
import os
import re
import tempfile
from typing import Any, Iterable
from urllib.parse import quote
import xml.etree.ElementTree as ET

import psycopg
from psycopg import sql
import requests


TRACKMAN_LOGIN_URL = "https://login.trackmanbaseball.com/connect/token"
TRACKMAN_API_URL = "https://dataapi.trackmanbaseball.com/api/v1"
UUID_RE = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.I)
PLAY_PATH_RE = re.compile(r"(?:^|/)plays?/([0-9a-f-]{32,36})(?:/|$)", re.I)


def required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"Required environment variable {name} is missing.")
    return value


def parse_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def json_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("items", "data", "sessions", "results", "value"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
        if payload:
            return [payload]
    return []


def request_json(
    session: requests.Session,
    method: str,
    url: str,
    *,
    payload: dict[str, Any] | None = None,
    allow_not_found: bool = False,
) -> Any:
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            headers = {"Content-Type": "application/json-patch+json"} if payload is not None else None
            response = session.request(method, url, json=payload, headers=headers, timeout=30)
            if allow_not_found and response.status_code == 404:
                return []
            response.raise_for_status()
            return response.json()
        except (requests.Timeout, requests.ConnectionError) as exc:
            last_error = exc
            if attempt < 2:
                continue
            raise
        except requests.HTTPError as exc:
            detail = response.text[:500]
            raise RuntimeError(f"TrackMan request failed ({response.status_code}): {detail}") from exc
    raise RuntimeError(f"TrackMan request failed: {last_error}")


def trackman_session(client_id: str, client_secret: str) -> requests.Session:
    response = requests.post(
        TRACKMAN_LOGIN_URL,
        data={"client_id": client_id, "client_secret": client_secret, "grant_type": "client_credentials"},
        timeout=30,
    )
    response.raise_for_status()
    token = str(response.json().get("access_token") or "").strip()
    if not token:
        raise RuntimeError("TrackMan token response did not contain access_token.")
    session = requests.Session()
    session.headers.update({"Authorization": f"Bearer {token}", "Accept": "text/plain"})
    return session


def discover_sessions(session: requests.Session, start: date, end: date, environment: str) -> list[dict[str, Any]]:
    # TrackMan rejects discovery windows that reach 30 full days once the
    # inclusive end-of-day timestamp is taken into account. Split long
    # backfills into safe 29-calendar-day requests and de-duplicate their
    # results so callers can request any practical date range.
    discovered: dict[str, dict[str, Any]] = {}
    cursor = start
    while cursor <= end:
        chunk_end = min(end, cursor + timedelta(days=28))
        payload = {
            "sessionType": "All",
            "utcDateFrom": f"{cursor.isoformat()}T00:00:00Z",
            "utcDateTo": f"{chunk_end.isoformat()}T23:59:59Z",
        }
        chunk_rows = json_rows(
            request_json(
                session,
                "POST",
                f"{TRACKMAN_API_URL}/discovery/{environment}/sessions",
                payload=payload,
            )
        )
        for item in chunk_rows:
            session_id = str(item.get("sessionId") or item.get("sessionID") or item.get("id") or "").strip()
            if session_id:
                discovered[session_id] = item
        print(
            f"[media] discovered {len(chunk_rows)} TrackMan {environment} sessions "
            f"from {cursor.isoformat()} through {chunk_end.isoformat()}"
        )
        cursor = chunk_end + timedelta(days=1)
    rows = list(discovered.values())
    print(f"[media] discovered {len(rows)} unique TrackMan {environment} sessions")
    return rows


def media_rows(session: requests.Session, session_id: str, kind: str, environment: str) -> list[dict[str, Any]]:
    environments = (environment, "game" if environment == "practice" else "practice")
    for candidate in environments:
        payload = request_json(
            session,
            "GET",
            f"{TRACKMAN_API_URL}/media/{candidate}/{kind}/{session_id}",
            allow_not_found=True,
        )
        rows = json_rows(payload)
        if rows:
            return rows
    return []


def azure_blobs(entity_path: str, endpoint: str, sas_token: str) -> Iterable[dict[str, str]]:
    base_url = f"https://{entity_path}.blob.core.windows.net/{endpoint}"
    marker = ""
    while True:
        query = sas_token.lstrip("?")
        params = f"restype=container&comp=list&{query}"
        if marker:
            params += f"&marker={quote(marker, safe='')}"
        response = requests.get(f"{base_url}?{params}", timeout=60)
        response.raise_for_status()
        root = ET.fromstring(response.text)
        for blob in root.findall(".//Blob"):
            yield {
                "name": blob.findtext("Name", default=""),
                "md5": blob.findtext("Properties/Content-MD5", default=""),
            }
        marker = root.findtext("NextMarker", default="").strip()
        if not marker:
            break


def extract_play_id(blob_name: str) -> str:
    match = PLAY_PATH_RE.search(blob_name or "") or UUID_RE.search(blob_name or "")
    return match.group(1 if match.re is PLAY_PATH_RE else 0).lower() if match else ""


def extract_clip_id(blob_name: str) -> str:
    filename = (blob_name or "").rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return filename.lower() if UUID_RE.fullmatch(filename) else ""


def infer_camera_slot(metadata: dict[str, Any], video_type: str, blob_name: str) -> str:
    camera_type = str(metadata.get("cameraType") or "").lower()
    type_norm = str(video_type or "").lower()
    explicitly_edger = "edger" in (camera_type or type_norm)
    explicitly_other = bool(camera_type or type_norm) and not explicitly_edger
    target = str(metadata.get("cameraTarget") or "").lower()
    fields = " ".join(
        str(value or "").lower()
        for value in (metadata.get("cameraName"), target, video_type, camera_type, blob_name)
    )
    if explicitly_edger:
        return "VideoClip"
    if any(token in target for token in ("1b", "first", "home", "center", "back")):
        return "VideoClip2"
    if any(token in target for token in ("3b", "third", "side")):
        return "VideoClip3"
    if explicitly_other:
        if any(token in fields for token in ("3b", "third", "side")):
            return "VideoClip3"
        return "VideoClip2"
    if "edger" in fields:
        return "VideoClip"
    return "VideoClip3" if any(token in fields for token in ("3b", "third", "side")) else "VideoClip2"


def safe_table_name(school_code: str) -> str:
    code = re.sub(r"[^a-z0-9_]", "", school_code.lower())
    if not code:
        raise RuntimeError("Invalid school code.")
    return f"video_map_{code}"


def ensure_video_table(conn: psycopg.Connection, table: str) -> None:
    statement = sql.SQL(
        """CREATE TABLE IF NOT EXISTS {} (
             session_id TEXT NOT NULL,
             play_id TEXT NOT NULL,
             camera_slot TEXT,
             camera_name TEXT,
             camera_target TEXT,
             video_type TEXT,
             azure_blob TEXT,
             azure_md5 TEXT,
             cloudinary_url TEXT,
             cloudinary_public_id TEXT,
             uploaded_at TIMESTAMPTZ,
             school_code TEXT,
             PRIMARY KEY (session_id, camera_slot, play_id)
           )"""
    ).format(sql.Identifier(table))
    conn.execute(statement)
    conn.execute(sql.SQL("ALTER TABLE {} ADD COLUMN IF NOT EXISTS school_code TEXT").format(sql.Identifier(table)))


def valid_play_ids(conn: psycopg.Connection, school_code: str, start: date, end: date) -> set[str]:
    rows = conn.execute(
        """SELECT DISTINCT LOWER(TRIM(playid))
           FROM public.pitch_events
           WHERE school_code = %s
             AND session_date BETWEEN %s AND %s
             AND NULLIF(TRIM(playid), '') IS NOT NULL""",
        (school_code, start, end),
    ).fetchall()
    return {str(row[0]) for row in rows if row[0]}


def existing_mapping(conn: psycopg.Connection, table: str, session_id: str, play_id: str, slot: str, blob: dict[str, str]) -> bool:
    statement = sql.SQL(
        """SELECT 1 FROM {} WHERE LOWER(session_id) = LOWER(%s)
           AND LOWER(play_id) = LOWER(%s) AND camera_slot = %s
           AND (azure_blob = %s OR (NULLIF(%s, '') IS NOT NULL AND azure_md5 = %s)) LIMIT 1"""
    ).format(sql.Identifier(table))
    return conn.execute(statement, (session_id, play_id, slot, blob["name"], blob["md5"], blob["md5"])).fetchone() is not None


def cloudinary_upload(
    azure_url: str,
    cloud_name: str,
    preset: str,
    public_id: str,
    api_key: str = "",
    api_secret: str = "",
) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile(suffix=".mov") as target:
        with requests.get(azure_url, stream=True, timeout=120) as source:
            source.raise_for_status()
            for chunk in source.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    target.write(chunk)
        target.flush()
        with open(target.name, "rb") as media:
            if api_key and api_secret:
                timestamp = str(int(datetime.now(timezone.utc).timestamp()))
                signature_text = f"public_id={public_id}&timestamp={timestamp}{api_secret}"
                upload_data = {
                    "api_key": api_key,
                    "public_id": public_id,
                    "timestamp": timestamp,
                    "signature": hashlib.sha1(signature_text.encode()).hexdigest(),
                }
            else:
                upload_data = {"upload_preset": preset, "public_id": public_id}
            response = requests.post(
                f"https://api.cloudinary.com/v1_1/{cloud_name}/video/upload",
                data=upload_data,
                files={"file": ("clip.mov", media, "video/quicktime")},
                timeout=300,
            )
        if not response.ok:
            raise RuntimeError(f"Cloudinary upload failed ({response.status_code}): {response.text[:500]}")
        return response.json()


def save_mapping(conn: psycopg.Connection, table: str, row: dict[str, Any]) -> None:
    statement = sql.SQL(
        """INSERT INTO {} (
             session_id, play_id, camera_slot, camera_name, camera_target, video_type,
             azure_blob, azure_md5, cloudinary_url, cloudinary_public_id, uploaded_at, school_code
           ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
           ON CONFLICT (session_id, camera_slot, play_id) DO UPDATE SET
             camera_name = EXCLUDED.camera_name, camera_target = EXCLUDED.camera_target,
             video_type = EXCLUDED.video_type, azure_blob = EXCLUDED.azure_blob,
             azure_md5 = EXCLUDED.azure_md5, cloudinary_url = EXCLUDED.cloudinary_url,
             cloudinary_public_id = EXCLUDED.cloudinary_public_id,
             uploaded_at = EXCLUDED.uploaded_at, school_code = EXCLUDED.school_code"""
    ).format(sql.Identifier(table))
    conn.execute(
        statement,
        (
            row["session_id"], row["play_id"], row["camera_slot"], row["camera_name"],
            row["camera_target"], row["video_type"], row["azure_blob"], row["azure_md5"],
            row["cloudinary_url"], row["cloudinary_public_id"], row["school_code"],
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--school", required=True)
    parser.add_argument("--start-date", default="")
    parser.add_argument("--end-date", default="")
    parser.add_argument("--lookback-days", type=int, default=int(os.getenv("TM_LOOKBACK_DAYS", "1")))
    parser.add_argument("--environment", choices=("practice", "game"), default=os.getenv("TM_ENV", "practice"))
    parser.add_argument("--cloudinary-folder", default=os.getenv("CLOUDINARY_FOLDER", "trackman"))
    args = parser.parse_args()

    school_code = args.school.strip().upper()
    end = parse_date(args.end_date) if args.end_date else datetime.now(timezone.utc).date()
    start = parse_date(args.start_date) if args.start_date else end - timedelta(days=max(0, args.lookback_days))
    if start > end:
        raise RuntimeError("start-date must be on or before end-date")
    database_url = os.getenv("DASHBOARD_DATABASE_URL", "").strip() or required_env("DATABASE_URL")
    cloud_name = required_env("CLOUDINARY_CLOUD_NAME")
    preset = os.getenv("CLOUDINARY_UPLOAD_PRESET", "").strip()
    cloudinary_api_key = os.getenv("CLOUDINARY_API_KEY", "").strip()
    cloudinary_api_secret = os.getenv("CLOUDINARY_API_SECRET", "").strip()
    if not preset and not (cloudinary_api_key and cloudinary_api_secret):
        raise RuntimeError(
            "Configure CLOUDINARY_API_KEY/CLOUDINARY_API_SECRET for signed uploads "
            "or CLOUDINARY_UPLOAD_PRESET for unsigned uploads."
        )
    table = safe_table_name(school_code)
    trackman = trackman_session(required_env("TM_CLIENT_ID"), required_env("TM_CLIENT_SECRET"))

    with psycopg.connect(database_url) as conn:
        ensure_video_table(conn, table)
        allowed_ids = valid_play_ids(conn, school_code, start, end)
        print(f"[media] loaded {len(allowed_ids)} valid {school_code} PlayIDs")
        if not allowed_ids:
            print("[media] no imported PlayIDs in requested window; nothing to upload")
            return 0

        sessions = discover_sessions(trackman, start, end, args.environment)
        uploaded = skipped = 0
        claimed: dict[tuple[str, str], str] = {}
        for index, item in enumerate(sessions, start=1):
            session_id = str(item.get("sessionId") or item.get("sessionID") or item.get("id") or "").strip()
            if not session_id:
                continue
            print(f"[media] session {index}/{len(sessions)}: {session_id}")
            metadata = media_rows(trackman, session_id, "videometadata", args.environment)
            tokens = media_rows(trackman, session_id, "videotokens", args.environment)
            by_clip = {str(row.get("videoClipId") or "").lower(): row for row in metadata if row.get("videoClipId")}
            by_play: dict[str, list[dict[str, Any]]] = {}
            for row in metadata:
                by_play.setdefault(str(row.get("playId") or "").lower(), []).append(row)
            for token in tokens:
                entity_path = str(token.get("entityPath") or "").strip()
                endpoint = str(token.get("endpoint") or "").strip()
                sas_token = str(token.get("token") or "").strip()
                video_type = str(token.get("type") or "").strip()
                if not entity_path or not endpoint or not sas_token:
                    continue
                for blob in azure_blobs(entity_path, endpoint, sas_token):
                    play_id = extract_play_id(blob["name"])
                    if not play_id or play_id not in allowed_ids:
                        skipped += 1
                        continue
                    clip_id = extract_clip_id(blob["name"])
                    md = by_clip.get(clip_id) or next(iter(by_play.get(play_id, [])), {})
                    slot = infer_camera_slot(md, video_type, blob["name"])
                    claim_key = (play_id, slot)
                    if claim_key in claimed and claimed[claim_key] != blob["name"] and slot != "VideoClip":
                        alternate = "VideoClip3" if slot == "VideoClip2" else "VideoClip2"
                        if (play_id, alternate) not in claimed:
                            slot = alternate
                            claim_key = (play_id, slot)
                    claimed[claim_key] = blob["name"]
                    if existing_mapping(conn, table, session_id, play_id, slot, blob):
                        continue
                    suffix = hashlib.sha256((blob["md5"] or blob["name"]).encode()).hexdigest()[:8]
                    public_id = "/".join(
                        re.sub(r"[^A-Za-z0-9_-]", "_", part)
                        for part in (args.cloudinary_folder, session_id, slot, play_id[:12], suffix)
                    )[:255]
                    azure_url = f"https://{entity_path}.blob.core.windows.net/{endpoint}/{quote(blob['name'], safe='/')}?{sas_token.lstrip('?')}"
                    print(f"[media] uploading {play_id} [{slot}]")
                    upload = cloudinary_upload(
                        azure_url,
                        cloud_name,
                        preset,
                        public_id,
                        cloudinary_api_key,
                        cloudinary_api_secret,
                    )
                    save_mapping(
                        conn,
                        table,
                        {
                            "session_id": session_id,
                            "play_id": play_id,
                            "camera_slot": slot,
                            "camera_name": str(md.get("cameraName") or video_type),
                            "camera_target": str(md.get("cameraTarget") or ""),
                            "video_type": video_type,
                            "azure_blob": blob["name"],
                            "azure_md5": blob["md5"],
                            "cloudinary_url": str(upload.get("secure_url") or upload.get("url") or ""),
                            "cloudinary_public_id": str(upload.get("public_id") or public_id),
                            "school_code": school_code,
                        },
                    )
                    conn.commit()
                    uploaded += 1
        print(f"[media] complete: uploaded={uploaded}, skipped_unmapped={skipped}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
