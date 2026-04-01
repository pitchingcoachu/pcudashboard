#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import datetime as dt
import os
import pathlib
import time
import urllib.parse
import urllib.request
from typing import Iterable, Tuple


MLB_URL = "https://baseballsavant.mlb.com/statcast_search/csv"
MILB_URL = "https://baseballsavant.mlb.com/statcast-search-minors/csv"


def _daterange(start: dt.date, end: dt.date) -> Iterable[dt.date]:
    cur = start
    while cur <= end:
        yield cur
        cur += dt.timedelta(days=1)


def _build_url(base: str, day: dt.date) -> str:
    params = {
        "all": "true",
        "type": "details",
        "game_date_gt": day.isoformat(),
        "game_date_lt": day.isoformat(),
    }
    return f"{base}?{urllib.parse.urlencode(params)}"


def _fetch_bytes(url: str, timeout: float, retries: int, sleep_s: float) -> bytes:
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        "Accept": "text/csv,application/download;q=0.9,*/*;q=0.8",
        "Referer": "https://baseballsavant.mlb.com/",
    }
    req = urllib.request.Request(url, headers=headers)
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            if attempt >= retries:
                break
            time.sleep(sleep_s)
    assert last_exc is not None
    raise last_exc


def _row_count(csv_bytes: bytes) -> int:
    text = csv_bytes.decode("utf-8-sig", errors="replace")
    rows = list(csv.reader(text.splitlines()))
    if not rows:
        return 0
    return max(0, len(rows) - 1)


def _write(path: pathlib.Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(payload)


def _download_day(
    label: str,
    base_url: str,
    out_dir: pathlib.Path,
    file_prefix: str,
    day: dt.date,
    timeout: float,
    retries: int,
    sleep_s: float,
) -> Tuple[pathlib.Path, int]:
    url = _build_url(base_url, day)
    payload = _fetch_bytes(url, timeout=timeout, retries=retries, sleep_s=sleep_s)
    out_path = out_dir / f"{file_prefix}_{day.isoformat()}.csv"
    _write(out_path, payload)
    rows = _row_count(payload)
    print(f"{label} {day.isoformat()}: rows={rows} file={out_path}")
    return out_path, rows


def main() -> int:
    parser = argparse.ArgumentParser(description="Download Savant MLB + MiLB CSVs by date")
    parser.add_argument("--start-date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--end-date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--timeout-seconds", type=float, default=float(os.getenv("PRO_SAVANT_TIMEOUT_SECONDS", "45")))
    parser.add_argument("--retries", type=int, default=int(os.getenv("PRO_SAVANT_RETRIES", "2")))
    parser.add_argument("--retry-sleep-seconds", type=float, default=float(os.getenv("PRO_SAVANT_RETRY_SLEEP_SECONDS", "2.0")))
    parser.add_argument("--out-mlb", default="data/pro_savant_raw/mlb")
    parser.add_argument("--out-milb", default="data/pro_savant_raw/milb")
    args = parser.parse_args()

    start = dt.date.fromisoformat(args.start_date)
    end = dt.date.fromisoformat(args.end_date)
    if end < start:
        raise ValueError("end-date must be >= start-date")

    out_mlb = pathlib.Path(args.out_mlb)
    out_milb = pathlib.Path(args.out_milb)

    total_mlb_rows = 0
    total_milb_rows = 0
    for day in _daterange(start, end):
        _, mlb_rows = _download_day(
            label="MLB",
            base_url=MLB_URL,
            out_dir=out_mlb,
            file_prefix="savant_mlb",
            day=day,
            timeout=args.timeout_seconds,
            retries=args.retries,
            sleep_s=args.retry_sleep_seconds,
        )
        _, milb_rows = _download_day(
            label="MiLB",
            base_url=MILB_URL,
            out_dir=out_milb,
            file_prefix="savant_milb",
            day=day,
            timeout=args.timeout_seconds,
            retries=args.retries,
            sleep_s=args.retry_sleep_seconds,
        )
        total_mlb_rows += mlb_rows
        total_milb_rows += milb_rows

    print(
        "done:",
        f"range={start.isoformat()}..{end.isoformat()}",
        f"mlb_rows={total_mlb_rows}",
        f"milb_rows={total_milb_rows}",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
