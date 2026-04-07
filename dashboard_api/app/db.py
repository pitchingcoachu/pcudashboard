from __future__ import annotations

from contextlib import contextmanager
import os
from typing import Iterator

import psycopg
from psycopg.rows import dict_row

from .config import get_settings

_DB_CONNECT_TIMEOUT_SECONDS = max(2, int(os.getenv("DASHBOARD_DB_CONNECT_TIMEOUT_SECONDS", "6")))


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    settings = get_settings()
    with psycopg.connect(
        settings.database_url,
        row_factory=dict_row,
        connect_timeout=_DB_CONNECT_TIMEOUT_SECONDS,
    ) as conn:
        yield conn
