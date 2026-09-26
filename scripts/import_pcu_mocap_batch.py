#!/usr/bin/env python3
"""Build dashboard payloads for a batch of locally staged FreeMoCap pitches."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path


ATHLETES = {
    "bryce-conley": {"name": "Bryce Conley", "handedness": "R"},
    "ryan-mixey": {"name": "Ryan Mixey", "handedness": "R"},
    "patrick-morris": {"name": "Patrick Morris", "handedness": "L"},
    "branden-piercey": {"name": "Branden Piercey", "handedness": "R"},
    "jared-gaynor": {"name": "Jared Gaynor", "handedness": "L"},
}

# Clips where the automatic event search misses the delivery (e.g. recording
# started late so release falls before the default search window).
EVENT_OVERRIDES = {
    "patrick-morris/2026-09-25_10-28-25_GMT-7": {"--ball-release": 39, "--foot-plant": 16},
    "branden-piercey/2026-09-25_14-12-19_GMT-7": {"--ball-release": 33, "--foot-plant": 6},
    "branden-piercey/2026-09-25_14-15-16_GMT-7": {"--ball-release": 168, "--foot-plant": 141},
}


def recording_datetime(recording_name: str) -> datetime:
    return datetime.strptime(recording_name.split("_GMT", 1)[0], "%Y-%m-%d_%H-%M-%S")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("staging_root", type=Path)
    parser.add_argument("output_root", type=Path)
    args = parser.parse_args()

    project_root = Path(__file__).resolve().parents[1]
    builder = project_root / "scripts" / "build_pcu_freemocap_dataset.py"
    manifest: list[dict[str, object]] = []
    payloads: list[dict] = []

    for athlete_slug, athlete in ATHLETES.items():
        athlete_root = args.staging_root / athlete_slug
        recordings = sorted(path for path in athlete_root.iterdir() if path.is_dir())
        for pitch_number, recording in enumerate(recordings, start=1):
            captured_at = recording_datetime(recording.name)
            stamp = captured_at.strftime("%Y%m%d-%H%M%S")
            dataset_key = f"{athlete_slug}-{stamp}"
            output_name = f"pcu-{dataset_key}.json"
            output_path = args.output_root / output_name
            pitch_label = f"Pitch {pitch_number} · {captured_at.strftime('%b %-d, %Y · %-I:%M %p')}"
            command = [
                sys.executable,
                str(builder),
                str(recording),
                str(output_path),
                "--athlete", athlete["name"],
                "--handedness", athlete["handedness"],
                "--dataset-key", dataset_key,
                "--pitch-label", pitch_label,
                "--camera-count", "5",
            ]
            for flag, frame in EVENT_OVERRIDES.get(f"{athlete_slug}/{recording.name}", {}).items():
                command.extend([flag, str(frame)])
            completed = subprocess.run(command, check=True, capture_output=True, text=True)
            payload = json.loads(output_path.read_text(encoding="utf-8"))
            payloads.append(payload)
            manifest.append({
                "athlete": athlete["name"],
                "datasetKey": dataset_key,
                "recordedAt": payload["recordedAt"],
                "title": payload["title"],
                "handedness": payload["handedness"],
                "cameraCount": payload["cameraCount"],
                "availableCameras": [int(video["id"].split("-")[-1]) for video in payload["videos"]],
                "startFrame": payload["analysisWindow"]["startFrame"],
                "endFrame": payload["analysisWindow"]["endFrame"],
                "file": output_name,
            })
            events = {event["key"]: event["frame"] for event in payload["events"]}
            print(f"Built {dataset_key}: {events}")
            if completed.stderr:
                print(completed.stderr, file=sys.stderr)

    manifest.sort(key=lambda item: (item["athlete"], item["recordedAt"]))
    (args.output_root / "pcu-mocap-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    (args.output_root / "pcu-mocap-generated.json").write_text(
        json.dumps(payloads, separators=(",", ":")),
        encoding="utf-8",
    )
    print(f"Built {len(manifest)} motion-capture payloads.")


if __name__ == "__main__":
    main()
