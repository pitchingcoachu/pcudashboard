#!/usr/bin/env python3
"""Download the analysis inputs for public FreeMoCap recording folders."""

from __future__ import annotations

import argparse
import html
import re
import time
import urllib.request
from pathlib import Path


ITEM_PATTERN = re.compile(
    r'data-id="([^"]+)".{0,1200}?<strong class="DNoYtb">([^<]+)</strong>',
    re.DOTALL,
)
DOWNLOAD_DIRECTORIES = {"annotated_videos", "output_data", "synchronized_videos", "timestamps"}
ALLOWED_FILES = {
    "mediapipe_body_rigid_3d_xyz.npy",
    "mediapipe_body_3d_xyz.npy",
    "mediapipe_left_hand_3d_xyz.npy",
    "mediapipe_right_hand_3d_xyz.npy",
}


def fetch(url: str, attempts: int = 4) -> bytes:
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except Exception:
            if attempt + 1 == attempts:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


def folder_items(folder_id: str) -> list[tuple[str, str]]:
    page = fetch(f"https://drive.google.com/drive/folders/{folder_id}?usp=sharing").decode("utf-8")
    return [(item_id, html.unescape(name)) for item_id, name in ITEM_PATTERN.findall(page)]


def should_download(name: str, path_parts: tuple[str, ...]) -> bool:
    if name.endswith("_info.json"):
        return True
    if name in ALLOWED_FILES:
        return True
    if path_parts and path_parts[-1] == "timestamps" and name.endswith("_timestamps.csv"):
        return True
    if path_parts and path_parts[-1] == "annotated_videos":
        return name.lower().endswith(".mp4") and re.search(r"\.idx-[1-5](?:_|\.)", name) is not None
    if path_parts and path_parts[-1] == "synchronized_videos":
        return name.lower().endswith(".mp4") and ".idx-1." in name
    return False


def download_folder(folder_id: str, destination: Path, path_parts: tuple[str, ...] = ()) -> None:
    destination.mkdir(parents=True, exist_ok=True)
    for item_id, name in folder_items(folder_id):
        if name in DOWNLOAD_DIRECTORIES:
            download_folder(item_id, destination / name, (*path_parts, name))
        elif should_download(name, path_parts):
            target = destination / name
            if target.exists() and target.stat().st_size:
                continue
            target.write_bytes(fetch(f"https://drive.google.com/uc?export=download&id={item_id}"))
            print(f"Downloaded {target}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("folder_id")
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    recording_pattern = re.compile(r"\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_GMT[+-]\d+")
    root_items = folder_items(args.folder_id)
    recordings = [(item_id, name) for item_id, name in root_items if recording_pattern.fullmatch(name)]
    if not recordings:
        for group_id, _group_name in root_items:
            recordings.extend(
                (item_id, name)
                for item_id, name in folder_items(group_id)
                if recording_pattern.fullmatch(name)
            )
    for recording_id, recording_name in recordings:
        download_folder(recording_id, args.destination / recording_name)


if __name__ == "__main__":
    main()
