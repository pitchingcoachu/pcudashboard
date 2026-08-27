#!/usr/bin/env python3
"""Calibrate a fixed Edger camera from 2D tracks and TrackMan trajectories."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from scipy.optimize import least_squares
from scipy.spatial.transform import Rotation


BALL_RADIUS_FT = 1.45 / 12


def look_at(camera: np.ndarray, target: np.ndarray) -> np.ndarray:
    forward = target - camera
    forward /= np.linalg.norm(forward)
    world_up = np.array([0.0, 0.0, 1.0])
    right = np.cross(forward, world_up)
    right /= np.linalg.norm(right)
    up = np.cross(right, forward)
    # Camera y increases up; image conversion below negates it.
    return np.vstack((right, up, forward))


def load_manifest(path: Path) -> tuple[dict, list[dict]]:
    manifest = json.loads(path.read_text())
    pitches: list[dict] = []
    for item in manifest["pitches"]:
        report = json.loads(Path(item["report"]).read_text())
        track = report.get("ball_track")
        if not track:
            raise ValueError(f"Report has no ball_track: {item['report']}")
        pitches.append({**item, "track": track, "stream": report["video_stream"]})
    return manifest, pitches


def world_point(pitch: dict, time_seconds: np.ndarray) -> np.ndarray:
    position = np.array([pitch["x0"], pitch["y0"], pitch["z0"]], dtype=float)
    velocity = np.array([pitch["vx0"], pitch["vy0"], pitch["vz0"]], dtype=float)
    acceleration = np.array([pitch["ax0"], pitch["ay0"], pitch["az0"]], dtype=float)
    return position + (time_seconds[:, None] * velocity) + (0.5 * time_seconds[:, None] ** 2 * acceleration)


def build_observations(pitches: list[dict], stride: int = 2) -> list[dict]:
    observations = []
    for pitch_index, pitch in enumerate(pitches):
        track = pitch["track"][::stride]
        first_frame = pitch["track"][0]["frame"]
        observations.append({
            "pitch_index": pitch_index,
            "frame_offsets": np.array([point["frame"] - first_frame for point in track], dtype=float),
            "pixels": np.array([[point["x_px"], point["y_px"]] for point in track], dtype=float),
            "radii": np.array([point["radius_px"] for point in track], dtype=float),
        })
    return observations


def unpack(parameters: np.ndarray, pitch_count: int):
    rotation = Rotation.from_rotvec(parameters[:3]).as_matrix()
    camera = parameters[3:6]
    fx = math.exp(parameters[6])
    cx, cy = parameters[7:9]
    radius_scale = math.exp(parameters[9])
    offsets = parameters[10:10 + pitch_count]
    return rotation, camera, fx, cx, cy, radius_scale, offsets


def calibrate(manifest: dict, pitches: list[dict]) -> dict:
    capture_fps = float(manifest.get("capture_fps", 1000))
    observations = build_observations(pitches)
    width = float(pitches[0]["stream"]["width"])
    height = float(pitches[0]["stream"]["height"])

    def residuals(parameters: np.ndarray) -> np.ndarray:
        rotation, camera, focal, cx, cy, radius_scale, offsets = unpack(parameters, len(pitches))
        values: list[np.ndarray] = []
        for pitch, observed in zip(pitches, observations):
            time = (observed["frame_offsets"] / capture_fps) + offsets[observed["pitch_index"]]
            world = world_point(pitch, time)
            camera_points = (world - camera) @ rotation.T
            depth = camera_points[:, 2]
            safe_depth = np.maximum(depth, 0.2)
            u = focal * camera_points[:, 0] / safe_depth + cx
            v = cy - (focal * camera_points[:, 1] / safe_depth)
            radius = focal * BALL_RADIUS_FT / safe_depth * radius_scale
            values.extend([
                (u - observed["pixels"][:, 0]) / 2.0,
                (v - observed["pixels"][:, 1]) / 2.0,
                (radius - observed["radii"]) / 2.5,
                np.minimum(depth - 0.2, 0) * 100,
            ])
        # The Edger optical center should remain reasonably close to frame center.
        values.extend([
            np.array([(cx - width / 2) / 80]),
            np.array([(cy - height / 2) / 80]),
        ])
        return np.concatenate(values)

    starts: list[np.ndarray] = []
    target = np.array([-1.0, 46.0, 5.3])
    for side in (-1, 1):
        for distance in (6.0, 10.0, 16.0):
            camera = np.array([target[0] + side * distance, 49.0, 5.8])
            rotation = look_at(camera, target)
            focal = 850.0 * (distance / 8.0)
            starts.append(np.concatenate((
                Rotation.from_matrix(rotation).as_rotvec(),
                camera,
                [math.log(focal), width / 2, height / 2, 0.0],
                np.zeros(len(pitches)),
            )))

    lower = np.concatenate((
        np.full(3, -math.pi * 2),
        [-35, 20, 0.5],
        [math.log(100), width * 0.25, height * 0.25, math.log(0.7)],
        np.full(len(pitches), -0.15),
    ))
    upper = np.concatenate((
        np.full(3, math.pi * 2),
        [35, 70, 15],
        [math.log(5000), width * 0.75, height * 0.75, math.log(1.5)],
        np.full(len(pitches), 0.15),
    ))
    solutions = [
        least_squares(
            residuals,
            start,
            bounds=(lower, upper),
            loss="soft_l1",
            f_scale=2.0,
            max_nfev=3500,
        )
        for start in starts
    ]
    solution = min(solutions, key=lambda item: np.mean(np.square(residuals(item.x))))
    rotation, camera, focal, cx, cy, radius_scale, offsets = unpack(solution.x, len(pitches))

    errors: list[float] = []
    per_pitch = []
    for pitch, observed, offset in zip(pitches, observations, offsets):
        time = (observed["frame_offsets"] / capture_fps) + offset
        world = world_point(pitch, time)
        camera_points = (world - camera) @ rotation.T
        u = focal * camera_points[:, 0] / camera_points[:, 2] + cx
        v = cy - (focal * camera_points[:, 1] / camera_points[:, 2])
        pixel_error = np.hypot(u - observed["pixels"][:, 0], v - observed["pixels"][:, 1])
        errors.extend(pixel_error.tolist())
        per_pitch.append({
            "id": str(pitch["id"]),
            "time_offset_ms": round(float(offset * 1000), 3),
            "median_reprojection_error_px": round(float(np.median(pixel_error)), 3),
            "p90_reprojection_error_px": round(float(np.percentile(pixel_error, 90)), 3),
        })

    median_error = float(np.median(errors))
    p90_error = float(np.percentile(errors, 90))
    return {
        "schema_version": 1,
        "status": "calibrated" if median_error <= 2.5 and p90_error <= 5 else "review_required",
        "capture_fps": capture_fps,
        "pitch_count": len(pitches),
        "observation_count": len(errors),
        "camera_position_pitch_coordinates_ft": [round(float(value), 6) for value in camera],
        "world_to_camera_rotation_matrix": [[round(float(value), 8) for value in row] for row in rotation],
        "intrinsics": {
            "fx": round(focal, 4), "fy": round(focal, 4),
            "cx": round(cx, 4), "cy": round(cy, 4),
            "radius_scale": round(radius_scale, 5),
        },
        "median_reprojection_error_px": round(median_error, 4),
        "p90_reprojection_error_px": round(p90_error, 4),
        "per_pitch": per_pitch,
        "optimizer": {"success": bool(solution.success), "message": str(solution.message)},
        "warning": "A four-pitch calibration is diagnostic only; production promotion requires more pitchers and held-out validation.",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    manifest, pitches = load_manifest(args.manifest)
    result = calibrate(manifest, pitches)
    text = json.dumps(result, indent=2) + "\n"
    if args.output:
        args.output.write_text(text)
    print(text, end="")


if __name__ == "__main__":
    main()
