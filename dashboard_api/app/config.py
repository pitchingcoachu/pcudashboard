from __future__ import annotations

import os
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


@dataclass(frozen=True)
class Settings:
    database_url: str
    allowed_origins: list[str]


def _split_csv(value: str) -> list[str]:
    return [part.strip() for part in value.split(",") if part.strip()]


def get_settings() -> Settings:
    database_url = (
        os.getenv("DASHBOARD_DATABASE_URL", "").strip()
        or os.getenv("DATABASE_URL", "").strip()
        or os.getenv("NEON_DATABASE_URL", "").strip()
    )
    if not database_url:
        raise RuntimeError("DASHBOARD_DATABASE_URL (or DATABASE_URL) must be set for dashboard_api.")
    database_url = _normalize_postgres_ssl_url(database_url)

    allowed_origins = _split_csv(os.getenv("DASHBOARD_API_ALLOWED_ORIGINS", "http://localhost:3000"))
    return Settings(database_url=database_url, allowed_origins=allowed_origins)


def _normalize_postgres_ssl_url(value: str) -> str:
    """
    For local dev on macOS with psycopg/libpq, strict verify modes can fail due to
    missing CA trust wiring. We normalize to sslmode=require to match existing Node
    local behavior and avoid local certificate-chain issues.
    """
    try:
        parts = urlsplit(value)
        query = dict(parse_qsl(parts.query, keep_blank_values=True))
        sslmode = (query.get("sslmode") or "").strip().lower()
        if sslmode in {"verify-full", "verify-ca"}:
            query["sslmode"] = "require"
            query.pop("sslrootcert", None)
            return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))
    except Exception:
        return value
    return value
