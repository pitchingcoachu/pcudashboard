#!/usr/bin/env python3
"""Build the small PCU dashboard payload from a FreeMoCap recording.

This exports derived time-series data plus a compact delivery-window skeleton.
Raw videos and the full landmark arrays stay outside the web bundle.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
from pathlib import Path

import numpy as np


LANDMARK = {
    "nose": 0,
    "left_ear": 7,
    "right_ear": 8,
    "left_shoulder": 11,
    "right_shoulder": 12,
    "left_elbow": 13,
    "right_elbow": 14,
    "left_wrist": 15,
    "right_wrist": 16,
    "left_hip": 23,
    "right_hip": 24,
    "left_knee": 25,
    "right_knee": 26,
    "left_ankle": 27,
    "right_ankle": 28,
    "left_heel": 29,
    "right_heel": 30,
    "left_foot_index": 31,
    "right_foot_index": 32,
}

SKELETON_LANDMARKS = [
    "nose", "left_ear", "right_ear",
    "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
    "left_wrist", "right_wrist", "left_hip", "right_hip",
    "left_knee", "right_knee", "left_ankle", "right_ankle",
    "left_heel", "right_heel", "left_foot_index", "right_foot_index",
]

SKELETON_CONNECTIONS = [
    ("left_ear", "nose"), ("nose", "right_ear"),
    ("left_shoulder", "right_shoulder"),
    ("left_shoulder", "left_elbow"), ("left_elbow", "left_wrist"),
    ("right_shoulder", "right_elbow"), ("right_elbow", "right_wrist"),
    ("left_shoulder", "left_hip"), ("right_shoulder", "right_hip"),
    ("left_hip", "right_hip"),
    ("left_hip", "left_knee"), ("left_knee", "left_ankle"),
    ("right_hip", "right_knee"), ("right_knee", "right_ankle"),
    ("left_ankle", "left_heel"), ("left_heel", "left_foot_index"),
    ("left_ankle", "left_foot_index"),
    ("right_ankle", "right_heel"), ("right_heel", "right_foot_index"),
    ("right_ankle", "right_foot_index"),
]


def normalize(vector: np.ndarray) -> np.ndarray:
    length = np.linalg.norm(vector, axis=-1, keepdims=True)
    return vector / np.where(length > 1e-9, length, 1.0)


def angle_at(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> np.ndarray:
    ba = normalize(a - b)
    bc = normalize(c - b)
    cosine = np.clip(np.sum(ba * bc, axis=1), -1.0, 1.0)
    return np.degrees(np.arccos(cosine))


def signed_angle(reference: np.ndarray, vector: np.ndarray, axis: np.ndarray) -> np.ndarray:
    reference = normalize(reference)
    vector = normalize(vector)
    axis = normalize(axis)
    sine = np.sum(np.cross(reference, vector) * axis, axis=1)
    cosine = np.sum(reference * vector, axis=1)
    return np.degrees(np.arctan2(sine, cosine))


def unwrap_degrees(values: np.ndarray) -> np.ndarray:
    return np.degrees(np.unwrap(np.radians(values)))


def local_polynomial_derivative(
    values: np.ndarray,
    timestamps: np.ndarray,
    window: int = 5,
    degree: int = 2,
) -> np.ndarray:
    """Differentiate a noisy trajectory with a centered local polynomial fit."""
    result = np.full(len(values), np.nan, dtype=float)
    half_window = window // 2
    for index in range(len(values)):
        start = max(0, index - half_window)
        end = min(len(values), index + half_window + 1)
        if end - start < degree + 1:
            continue
        local_time = timestamps[start:end] - timestamps[index]
        local_values = values[start:end]
        finite = np.isfinite(local_time) & np.isfinite(local_values)
        if np.count_nonzero(finite) < degree + 1:
            continue
        coefficients = np.polyfit(local_time[finite], local_values[finite], degree)
        result[index] = coefficients[-2]
    return result


def orient_peak_positive(values: np.ndarray, start: int, end: int) -> np.ndarray:
    """Normalize the delivery's primary rotation/extension peak as positive."""
    result = values.copy()
    delivery = result[start : end + 1]
    if np.nanmax(delivery) < abs(np.nanmin(delivery)):
        result *= -1.0
    return result


def read_timestamps(path: Path, frame_count: int) -> np.ndarray:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        values = [float(row["timestamp.from_recording_start.sec"]) for row in reader]
    if len(values) < frame_count:
        raise ValueError(f"Only {len(values)} timestamps for {frame_count} frames")
    return np.asarray(values[:frame_count], dtype=float)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("recording", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--foot-plant", type=int, default=None)
    parser.add_argument("--ball-release", type=int, default=None)
    parser.add_argument("--analysis-start", type=int, default=None)
    parser.add_argument("--analysis-end", type=int, default=None)
    parser.add_argument("--athlete", default="Test")
    parser.add_argument("--handedness", choices=("R", "L"), default="R")
    parser.add_argument("--dataset-key", default=None)
    parser.add_argument("--pitch-label", default=None)
    parser.add_argument("--camera-count", type=int, default=None)
    args = parser.parse_args()

    recording = args.recording.resolve()
    body_path = recording / "output_data" / "mediapipe_body_rigid_3d_xyz.npy"
    if not body_path.exists():
        body_path = recording / "output_data" / "mediapipe_body_3d_xyz.npy"
    body = np.load(body_path).astype(float)
    if body.ndim != 3 or body.shape[1] < 29 or body.shape[2] != 3:
        raise ValueError(f"Unexpected body trajectory shape: {body.shape}")
    # The rigid FreeMoCap trajectory already enforces segment lengths. Do not
    # average XYZ positions before deriving joint angles: during fast motion,
    # averaging points from neighboring poses creates a non-physical skeleton
    # and can materially change every downstream metric.

    timestamp_files = sorted((recording / "synchronized_videos" / "timestamps").glob("*_timestamps.csv"))
    if not timestamp_files:
        raise FileNotFoundError("No synchronized timestamp CSV found")
    timestamps = read_timestamps(timestamp_files[0], len(body))
    elapsed = timestamps - timestamps[0]
    capture_fps = float(1.0 / np.median(np.diff(timestamps)))
    recorded_at = "2026-09-24T14:15:10-07:00"
    info_files = sorted(recording.glob("*_info.json"))
    if info_files:
        info = json.loads(info_files[0].read_text(encoding="utf-8"))
        recorded_at = info.get("recording_start_timestamp", {}).get(
            "unix_timestamp_local_isoformat",
            recorded_at,
        )

    left_shoulder = body[:, LANDMARK["left_shoulder"]]
    right_shoulder = body[:, LANDMARK["right_shoulder"]]
    right_elbow = body[:, LANDMARK["right_elbow"]]
    right_wrist = body[:, LANDMARK["right_wrist"]]
    left_hip = body[:, LANDMARK["left_hip"]]
    right_hip = body[:, LANDMARK["right_hip"]]
    left_knee = body[:, LANDMARK["left_knee"]]
    right_knee = body[:, LANDMARK["right_knee"]]
    left_ankle = body[:, LANDMARK["left_ankle"]]
    right_ankle = body[:, LANDMARK["right_ankle"]]

    mid_shoulder = (left_shoulder + right_shoulder) / 2.0
    mid_hip = (left_hip + right_hip) / 2.0
    mid_ankle = (left_ankle + right_ankle) / 2.0
    trunk = normalize(mid_shoulder - mid_hip)
    shoulder_line = normalize(right_shoulder - left_shoulder)
    hip_line = normalize(right_hip - left_hip)

    handedness = args.handedness
    if handedness == "R":
        throwing_shoulder = right_shoulder
        throwing_elbow = right_elbow
        throwing_wrist = right_wrist
        throwing_hand_path = recording / "output_data" / "mediapipe_right_hand_3d_xyz.npy"
        lead_ankle = left_ankle
        back_ankle = right_ankle
        back_heel = body[:, LANDMARK["right_heel"]]
        back_foot_index = body[:, LANDMARK["right_foot_index"]]
        throwing_side_axis = shoulder_line
    else:
        throwing_shoulder = left_shoulder
        throwing_elbow = body[:, LANDMARK["left_elbow"]]
        throwing_wrist = body[:, LANDMARK["left_wrist"]]
        throwing_hand_path = recording / "output_data" / "mediapipe_left_hand_3d_xyz.npy"
        lead_ankle = right_ankle
        back_ankle = left_ankle
        back_heel = body[:, LANDMARK["left_heel"]]
        back_foot_index = body[:, LANDMARK["left_foot_index"]]
        throwing_side_axis = -shoulder_line

    if not throwing_hand_path.exists():
        raise FileNotFoundError(f"No throwing-hand trajectory found: {throwing_hand_path}")
    throwing_hand = np.load(throwing_hand_path).astype(float)
    if throwing_hand.shape != (len(body), 21, 3):
        raise ValueError(f"Unexpected throwing-hand trajectory shape: {throwing_hand.shape}")
    hand_trajectories = {}
    for side in ("left", "right"):
        hand_path = recording / "output_data" / f"mediapipe_{side}_hand_3d_xyz.npy"
        if not hand_path.exists():
            continue
        hand_trajectory = np.load(hand_path).astype(float)
        if hand_trajectory.shape == (len(body), 21, 3):
            hand_trajectories[side] = hand_trajectory

    wrist_speed = np.linalg.norm(np.gradient(throwing_wrist, elapsed, axis=0), axis=1)
    search_start = max(0, int(len(body) * 0.42))
    search_end = min(len(body), int(len(body) * 0.76))
    ball_release = (
        int(args.ball_release)
        if args.ball_release is not None
        else int(search_start + np.argmax(wrist_speed[search_start:search_end]))
    )

    # Lead-foot plant is the first settled frame after the stride-foot speed
    # peak and before arm acceleration. Restrict the search to the visually
    # relevant delivery window to avoid the still setup frames.
    lead_speed = np.linalg.norm(np.gradient(lead_ankle, elapsed, axis=0), axis=1)
    fp_search_start = max(search_start, ball_release - 28)
    fp_search_end = max(fp_search_start + 1, ball_release - 7)
    foot_plant = (
        int(args.foot_plant)
        if args.foot_plant is not None
        else int(fp_search_start + np.argmin(lead_speed[fp_search_start:fp_search_end]))
    )
    if not (0 <= foot_plant < ball_release < len(body)):
        raise ValueError(
            f"Expected 0 <= foot plant < ball release < {len(body)}, got "
            f"{foot_plant} and {ball_release}"
        )

    # FreeMoCap's world axes depend on the calibration board orientation. Build
    # a recording-local coordinate system so vertical/forward/lateral remain
    # correct even when a new calibration rotates the raw XYZ axes.
    quiet_end = max(14, min(search_start, foot_plant - 10))
    vertical = normalize(
        np.asarray([np.nanmedian(mid_shoulder[8:quiet_end] - mid_ankle[8:quiet_end], axis=0)])
    )[0]
    stride = lead_ankle[foot_plant] - back_ankle[foot_plant]
    stride_horizontal = stride - np.dot(stride, vertical) * vertical
    forward = normalize(np.asarray([stride_horizontal]))[0]
    lateral = normalize(np.asarray([np.cross(vertical, forward)]))[0]
    vertical_frames = np.repeat(vertical[None, :], len(body), axis=0)
    forward_frames = np.repeat(forward[None, :], len(body), axis=0)
    lateral_frames = np.repeat(lateral[None, :], len(body), axis=0)

    # Establish an independent home-plate direction from the drive-foot/rubber
    # orientation before motion. Pitchers may set the drive foot either along
    # or perpendicular to the rubber, so choose the matching cardinal axis and
    # use the stride only to resolve which way points toward home plate.
    quiet_slice = slice(8, quiet_end)
    drive_foot_axis = np.nanmedian(back_foot_index[quiet_slice] - back_heel[quiet_slice], axis=0)
    drive_foot_axis -= np.dot(drive_foot_axis, vertical) * vertical
    drive_foot_axis = normalize(np.asarray([drive_foot_axis]))[0]
    drive_foot_perpendicular = normalize(np.asarray([np.cross(vertical, drive_foot_axis)]))[0]
    home_candidates = (
        drive_foot_axis,
        -drive_foot_axis,
        drive_foot_perpendicular,
        -drive_foot_perpendicular,
    )
    target_forward = max(home_candidates, key=lambda candidate: float(np.dot(candidate, forward)))
    target_lateral = normalize(np.asarray([np.cross(vertical, target_forward)]))[0]
    open_side = target_lateral if handedness == "R" else -target_lateral
    target_forward_frames = np.repeat(target_forward[None, :], len(body), axis=0)
    open_side_frames = np.repeat(open_side[None, :], len(body), axis=0)

    upper_arm = normalize(throwing_elbow - throwing_shoulder)
    forearm = normalize(throwing_wrist - throwing_elbow)
    trunk_down = -trunk

    elbow_flexion = 180.0 - angle_at(throwing_shoulder, throwing_elbow, throwing_wrist)
    shoulder_abduction = angle_at(throwing_elbow, throwing_shoulder, mid_hip)

    # Humeral axial rotation: compare the forearm plane with the trunk plane
    # after projecting both references perpendicular to the upper arm.
    forearm_plane = forearm - np.sum(forearm * upper_arm, axis=1, keepdims=True) * upper_arm
    trunk_reference = trunk - np.sum(trunk * upper_arm, axis=1, keepdims=True) * upper_arm
    shoulder_er_raw = signed_angle(trunk_reference, forearm_plane, upper_arm)
    shoulder_er_unwrapped = unwrap_degrees(shoulder_er_raw)
    shoulder_er = shoulder_er_unwrapped - np.nanpercentile(shoulder_er_unwrapped[: max(12, search_start)], 10)
    if np.nanmax(shoulder_er[foot_plant : ball_release + 1]) < abs(np.nanmin(shoulder_er[foot_plant : ball_release + 1])):
        shoulder_er *= -1.0
    shoulder_er = np.clip(shoulder_er, -40.0, 190.0)

    upper_transverse = upper_arm - np.sum(upper_arm * trunk, axis=1, keepdims=True) * trunk
    horizontal_abduction = signed_angle(throwing_side_axis, upper_transverse, trunk)
    horizontal_abduction = np.clip(unwrap_degrees(horizontal_abduction), -180.0, 180.0)

    # Baseball Savant defines arm angle at release from a line parallel to the
    # ground and a line connecting the throwing shoulder to the baseball. The
    # ball is not tracked in this markerless capture, so use the midpoint of the
    # index- and middle-finger tips as the closest available ball-hand proxy.
    # Zero degrees is parallel to the ground; 90 degrees is vertical.
    ball_proxy = (throwing_hand[:, 8] + throwing_hand[:, 12]) / 2.0
    shoulder_to_ball = ball_proxy - throwing_shoulder
    arm_angle_vertical_signed = np.sum(shoulder_to_ball * vertical_frames, axis=1)
    arm_angle_horizontal = np.linalg.norm(
        shoulder_to_ball - arm_angle_vertical_signed[:, None] * vertical_frames,
        axis=1,
    )
    arm_angle = np.degrees(np.arctan2(np.abs(arm_angle_vertical_signed), arm_angle_horizontal))

    # Fast release motion can briefly separate MediaPipe's hand model from its
    # body-wrist landmark. Keep the saved BR timing unchanged, but substitute
    # the nearest high-confidence hand pose for those isolated tracking drops.
    hand_wrist_error = np.linalg.norm(throwing_hand[:, 0] - throwing_wrist, axis=1)
    forearm_length = np.linalg.norm(throwing_wrist - throwing_elbow, axis=1)
    hand_alignment_limit = 0.4 * float(np.nanmedian(forearm_length))
    reliable_ball_proxy = np.all(np.isfinite(ball_proxy), axis=1) & (hand_wrist_error <= hand_alignment_limit)
    reliable_frames = np.flatnonzero(reliable_ball_proxy)
    if len(reliable_frames) == 0:
        raise ValueError("No reliable throwing-hand frames available for arm angle")
    for frame in np.flatnonzero(~reliable_ball_proxy):
        nearest = reliable_frames[np.argmin(np.abs(reliable_frames - frame))]
        ball_proxy[frame] = ball_proxy[nearest]
        arm_angle[frame] = arm_angle[nearest]

    stride_vector = lead_ankle - back_ankle
    stride_vertical = np.sum(stride_vector * vertical_frames, axis=1, keepdims=True)
    stride_horizontal_vector = stride_vector - stride_vertical * vertical_frames
    stride_direction = np.degrees(
        np.arctan2(
            np.sum(stride_horizontal_vector * open_side_frames, axis=1),
            np.sum(stride_horizontal_vector * target_forward_frames, axis=1),
        )
    )
    stride_length = np.linalg.norm(stride_horizontal_vector, axis=1) / 304.8
    rubber_front = np.nanmedian(back_heel[quiet_slice], axis=0)
    extension = np.sum((ball_proxy - rubber_front) * target_forward_frames, axis=1) / 304.8

    trunk_vertical = np.clip(np.sum(trunk * vertical_frames, axis=1), -1.0, 1.0)
    forward_trunk_tilt = np.degrees(np.arctan2(np.sum(trunk * forward_frames, axis=1), trunk_vertical))
    lateral_trunk_tilt = np.degrees(np.arctan2(np.sum(trunk * lateral_frames, axis=1), trunk_vertical))

    torso_rotation = unwrap_degrees(
        np.degrees(
            np.arctan2(
                np.sum(shoulder_line * forward_frames, axis=1),
                np.sum(shoulder_line * lateral_frames, axis=1),
            )
        )
    )
    pelvis_rotation = unwrap_degrees(
        np.degrees(
            np.arctan2(
                np.sum(hip_line * forward_frames, axis=1),
                np.sum(hip_line * lateral_frames, axis=1),
            )
        )
    )
    # Center both rotation traces on their quiet pre-delivery posture.
    rotation_baseline_slice = slice(max(0, search_start - 18), search_start)
    torso_rotation -= float(np.nanmedian(torso_rotation[rotation_baseline_slice]))
    pelvis_rotation -= float(np.nanmedian(pelvis_rotation[rotation_baseline_slice]))
    rotation_difference = (torso_rotation - pelvis_rotation + 180.0) % 360.0 - 180.0
    hip_shoulder_separation = np.abs(rotation_difference)

    if handedness == "R":
        front_knee_flexion = 180.0 - angle_at(left_hip, left_knee, left_ankle)
        back_knee_flexion = 180.0 - angle_at(right_hip, right_knee, right_ankle)
    else:
        front_knee_flexion = 180.0 - angle_at(right_hip, right_knee, right_ankle)
        back_knee_flexion = 180.0 - angle_at(left_hip, left_knee, left_ankle)

    # Max ER is a measured event, not a manually positioned marker: it is the
    # frame with the greatest throwing-shoulder external rotation after foot
    # plant and no later than ball release.
    max_er = int(foot_plant + np.nanargmax(shoulder_er[foot_plant : ball_release + 1]))
    if not (foot_plant <= max_er <= ball_release):
        raise ValueError(f"Expected foot plant <= max ER <= ball release, got {foot_plant}, {max_er}, {ball_release}")

    # Velocity traces use a centered quadratic derivative. Derivatives amplify
    # markerless tracking noise, so fitting a local polynomial is more stable
    # than differencing adjacent 30 FPS samples while preserving event timing.
    pelvis_rotational_velocity = orient_peak_positive(
        local_polynomial_derivative(pelvis_rotation, elapsed), foot_plant, ball_release
    )
    torso_rotational_velocity = orient_peak_positive(
        local_polynomial_derivative(torso_rotation, elapsed), foot_plant, ball_release
    )
    shoulder_internal_rotation_velocity = orient_peak_positive(
        -local_polynomial_derivative(shoulder_er, elapsed), max_er, min(len(body) - 1, ball_release + 3)
    )
    knee_extension_velocity = orient_peak_positive(
        -local_polynomial_derivative(front_knee_flexion, elapsed), foot_plant, min(len(body) - 1, ball_release + 4)
    )
    elbow_extension_velocity = orient_peak_positive(
        -local_polynomial_derivative(elbow_flexion, elapsed), foot_plant, min(len(body) - 1, ball_release + 3)
    )

    # Mid-hip velocity is a practical pelvis/center-of-mass proxy. A true whole-
    # body COM requires a segment-mass model that this FreeMoCap payload does
    # not contain, so name and document the approximation explicitly.
    mid_hip_velocity = np.column_stack(
        [local_polynomial_derivative(mid_hip[:, axis], elapsed) for axis in range(3)]
    )
    com_forward_velocity = np.sum(mid_hip_velocity * target_forward_frames, axis=1) / 304.8
    com_vertical_velocity = np.sum(mid_hip_velocity * vertical_frames, axis=1) / 304.8
    hand_velocity_vector = np.column_stack(
        [local_polynomial_derivative(ball_proxy[:, axis], elapsed) for axis in range(3)]
    )
    hand_velocity = np.linalg.norm(hand_velocity_vector, axis=1) / 304.8

    metric_arrays = {
        "shoulderEr": shoulder_er,
        "elbowFlexion": elbow_flexion,
        "shoulderAbduction": shoulder_abduction,
        "horizontalShoulderAbduction": horizontal_abduction,
        "armAngle": arm_angle,
        "strideDirection": stride_direction,
        "strideLength": stride_length,
        "extension": extension,
        "forwardTrunkTilt": forward_trunk_tilt,
        "lateralTrunkTilt": lateral_trunk_tilt,
        "torsoRotation": torso_rotation,
        "pelvisRotation": pelvis_rotation,
        "hipShoulderSeparation": hip_shoulder_separation,
        "frontKneeFlexion": front_knee_flexion,
        "backKneeFlexion": back_knee_flexion,
        "pelvisRotationalVelocity": pelvis_rotational_velocity,
        "torsoRotationalVelocity": torso_rotational_velocity,
        "shoulderInternalRotationVelocity": shoulder_internal_rotation_velocity,
        "kneeExtensionVelocity": knee_extension_velocity,
        "elbowExtensionVelocity": elbow_extension_velocity,
        "centerOfMassForwardVelocity": com_forward_velocity,
        "centerOfMassVerticalVelocity": com_vertical_velocity,
        "throwingHandVelocity": hand_velocity,
    }
    labels = {
        "shoulderEr": "Shoulder ER",
        "elbowFlexion": "Elbow Flexion",
        "shoulderAbduction": "Shoulder Abduction",
        "horizontalShoulderAbduction": "Horizontal Shoulder Abduction",
        "armAngle": "Arm Angle",
        "strideDirection": "Stride Direction",
        "strideLength": "Stride Length",
        "extension": "Extension",
        "forwardTrunkTilt": "Forward Trunk Tilt",
        "lateralTrunkTilt": "Lateral Trunk Tilt",
        "torsoRotation": "Torso Rotation",
        "pelvisRotation": "Pelvis Rotation",
        "hipShoulderSeparation": "Hip-Shoulder Separation",
        "frontKneeFlexion": "Front Knee Flexion",
        "backKneeFlexion": "Back Knee Flexion",
        "pelvisRotationalVelocity": "Pelvis Rotational Velocity",
        "torsoRotationalVelocity": "Torso Rotational Velocity",
        "shoulderInternalRotationVelocity": "Shoulder IR Velocity",
        "kneeExtensionVelocity": "Front Knee Extension Velocity",
        "elbowExtensionVelocity": "Elbow Extension Velocity",
        "centerOfMassForwardVelocity": "Center Of Mass Forward Velocity",
        "centerOfMassVerticalVelocity": "Center Of Mass Vertical Velocity",
        "throwingHandVelocity": "Throwing Hand Velocity",
    }

    # Present the delivery rather than several seconds of still setup/recovery.
    delivery_start = int(args.analysis_start) if args.analysis_start is not None else max(0, foot_plant - 38)
    delivery_end = int(args.analysis_end) if args.analysis_end is not None else min(len(body) - 1, ball_release + 30)
    if not (0 <= delivery_start <= foot_plant <= ball_release <= delivery_end < len(body)):
        raise ValueError(
            "Analysis window must contain FP through BR and remain inside the recording: "
            f"{delivery_start}, {foot_plant}, {ball_release}, {delivery_end}"
        )
    events = {"footPlant": foot_plant, "maxEr": max_er, "ballRelease": ball_release}
    event_labels = {"footPlant": "FC", "maxEr": "MER", "ballRelease": "BR"}
    dataset_key = args.dataset_key or re.sub(r"[^a-z0-9]+", "-", args.athlete.lower()).strip("-") or "test"
    video_files = sorted(
        (recording / "annotated_videos").glob("*.mp4"),
        key=lambda path: int((re.search(r"idx-(\d+)", path.name) or [None, 999])[1]),
    )
    videos = []
    for position, video_file in enumerate(video_files, start=1):
        match = re.search(r"idx-(\d+)", video_file.name)
        camera_number = int(match.group(1)) if match else position
        videos.append(
            {
                "id": f"camera-{camera_number}",
                "label": f"Camera {camera_number}",
                "url": f"/api/dashboard/motion-capture/video?dataset={dataset_key}&camera={camera_number}",
            }
        )

    metric_units = {
        "strideLength": "ft",
        "extension": "ft",
        "pelvisRotationalVelocity": "deg/s",
        "torsoRotationalVelocity": "deg/s",
        "shoulderInternalRotationVelocity": "deg/s",
        "kneeExtensionVelocity": "deg/s",
        "elbowExtensionVelocity": "deg/s",
        "centerOfMassForwardVelocity": "ft/s",
        "centerOfMassVerticalVelocity": "ft/s",
        "throwingHandVelocity": "ft/s",
    }
    velocity_metrics = {
        "pelvisRotationalVelocity",
        "torsoRotationalVelocity",
        "shoulderInternalRotationVelocity",
        "kneeExtensionVelocity",
        "elbowExtensionVelocity",
        "centerOfMassForwardVelocity",
        "centerOfMassVerticalVelocity",
        "throwingHandVelocity",
    }
    event_only_metrics = {
        "armAngle": "ballRelease",
        "strideDirection": "footPlant",
        "strideLength": "footPlant",
        "extension": "ballRelease",
    }
    metrics = []
    for key, values in metric_arrays.items():
        series = [
            {
                "frame": frame,
                # Target the center of the encoded frame. Seeking to the exact
                # leading edge can resolve to the preceding frame in browsers.
                "time": round(float((frame - delivery_start + 0.5) / capture_fps), 4),
                "value": round(float(values[frame]), 2),
            }
            for frame in range(delivery_start, delivery_end + 1)
            if math.isfinite(float(values[frame]))
        ]
        event_values = {
            event_key: (
                None
                if (
                    (key in event_only_metrics and event_key != event_only_metrics[key])
                    or (key == "extension" and float(values[event_frame]) <= 0)
                )
                else round(float(values[event_frame]), 2 if metric_units.get(key) == "ft" else 1)
            )
            for event_key, event_frame in events.items()
        }
        metrics.append(
            {
                "key": key,
                "label": labels[key],
                "unit": metric_units.get(key, "deg"),
                "group": "velocity" if key in velocity_metrics else "angle",
                "eventValues": event_values,
                "series": series,
            }
        )

    skeleton_indices = [LANDMARK[key] for key in SKELETON_LANDMARKS]
    def skeleton_coordinates(point: np.ndarray) -> list[float]:
        return [
            round(float(np.dot(point, lateral)), 1),
            round(float(np.dot(point, vertical)), 1),
            round(float(np.dot(point, target_forward)), 1),
        ]

    skeleton_frames = [
        {
            "frame": frame,
            "time": round(float((frame - delivery_start + 0.5) / capture_fps), 4),
            "points": [
                skeleton_coordinates(body[frame, landmark_index])
                for landmark_index in skeleton_indices
            ],
        }
        for frame in range(delivery_start, delivery_end + 1)
    ]
    skeleton_hands = {
        side: [
            {
                "frame": frame,
                "time": round(float((frame - delivery_start + 0.5) / capture_fps), 4),
                "points": [
                    skeleton_coordinates(hand_trajectory[frame, landmark_index])
                    for landmark_index in range(21)
                ],
            }
            for frame in range(delivery_start, delivery_end + 1)
        ]
        for side, hand_trajectory in hand_trajectories.items()
    }

    payload = {
        "version": 1,
        "recordingId": recording.name,
        "datasetKey": dataset_key,
        "athlete": args.athlete,
        "title": args.pitch_label or f"{args.athlete} pitch capture",
        "recordedAt": recorded_at,
        "source": "FreeMoCap",
        "handedness": handedness,
        "cameraCount": args.camera_count or len(video_files),
        "frameCount": int(len(body)),
        "captureFps": round(capture_fps, 4),
        "analysisWindow": {
            "startFrame": delivery_start,
            "endFrame": delivery_end,
            "durationSec": round(float((delivery_end - delivery_start + 1) / capture_fps), 4),
        },
        "events": [
            {
                "key": key,
                "label": event_labels[key],
                "frame": frame,
                "time": round(float((frame - delivery_start + 0.5) / capture_fps), 4),
            }
            for key, frame in events.items()
        ],
        "videos": videos,
        "skeleton": {
            "landmarks": SKELETON_LANDMARKS,
            "connections": SKELETON_CONNECTIONS,
            "frames": skeleton_frames,
            "hands": skeleton_hands,
        },
        "metrics": metrics,
        "notes": [
            "FC, MER, and BR were identified from the synchronized camera views.",
            "Metrics are calculated per frame from FreeMoCap's rigid three-dimensional landmarks without pre-smoothing the joint coordinates.",
            "Arm Angle uses the Baseball Savant convention at the saved BR marker, with the throwing hand's index/middle fingertip midpoint as a proxy for the untracked baseball.",
            "Stride Direction is positive when open and negative when closed; Stride Length is ankle-to-ankle distance at FP.",
            "Extension is the home-plate component from the estimated front-rubber reference to the throwing-hand ball proxy at BR.",
            "Velocity traces use centered local-polynomial derivatives; center-of-mass velocity uses the mid-hip point as a pelvis/COM proxy.",
            "Peak rotational velocities from this 31 FPS prototype should not be treated as laboratory-grade values without higher-rate capture validation.",
        ],
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"events": events, "eventTimes": {e["key"]: e["time"] for e in payload["events"]}}, indent=2))
    for metric in metrics:
        print(metric["label"], metric["eventValues"])


if __name__ == "__main__":
    main()
