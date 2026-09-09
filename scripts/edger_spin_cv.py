#!/usr/bin/env python3
"""Audit and normalize an Edgertronic baseball clip for seam-orientation fitting.

This is intentionally an offline processor. It never promotes an estimate to the
dashboard by itself; the JSON quality report is the gate used before a later
orientation fit is accepted.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.optimize import minimize
from scipy.spatial import cKDTree
from scipy.spatial.transform import Rotation


@dataclass(frozen=True)
class Candidate:
    frame: int
    x: float
    y: float
    width: int
    height: int
    area: int
    score: float


def extract_frames(video: Path, folder: Path) -> list[Path]:
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", str(video),
            "-vsync", "0", str(folder / "frame-%04d.png"),
        ],
        check=True,
    )
    return sorted(folder.glob("frame-*.png"))


def frame_candidates(
    gray: np.ndarray,
    frame_index: int,
    background: np.ndarray | None = None,
) -> list[Candidate]:
    height, width = gray.shape
    # Edger clips are monochrome. The leather is a compact bright component;
    # seams may split it, so close only tiny gaps before connected components.
    bright = gray >= max(118, float(np.percentile(gray, 87)))
    bright = ndimage.binary_closing(bright, structure=np.ones((3, 3)), iterations=1)
    candidates: list[Candidate] = []
    masks = [bright]
    if background is not None:
        foreground = np.abs(gray.astype(np.int16) - background.astype(np.int16)) >= 16
        foreground = ndimage.binary_closing(foreground, structure=np.ones((3, 3)), iterations=2)
        foreground = ndimage.binary_fill_holes(foreground)
        masks.append(foreground)
    for mask_index, mask in enumerate(masks):
        labels, _ = ndimage.label(mask)
        objects = ndimage.find_objects(labels)
        for label_index, bounds in enumerate(objects, start=1):
            if bounds is None:
                continue
            ys, xs = bounds
            box_width = xs.stop - xs.start
            box_height = ys.stop - ys.start
            if not (14 <= box_width <= 100 and 14 <= box_height <= 100):
                continue
            if xs.start <= 2 or ys.start <= 2 or xs.stop >= width - 2 or ys.stop >= height - 2:
                continue
            aspect = box_width / max(box_height, 1)
            if not 0.55 <= aspect <= 1.75:
                continue
            component = labels[bounds] == label_index
            area = int(component.sum())
            if area < 95:
                continue
            fill = area / (box_width * box_height)
            if fill < 0.32:
                continue
            center_x = (xs.start + xs.stop - 1) / 2
            center_y = (ys.start + ys.stop - 1) / 2
            if any(math.hypot(center_x - item.x, center_y - item.y) < 7 for item in candidates):
                continue
            # Circular, filled, lower-field components are preferred. Static false
            # positives are removed by the temporal track score below.
            circular = 1 - min(abs(math.log(aspect)), 1)
            lower_field = min(max((center_y - height * 0.25) / (height * 0.5), 0), 1)
            motion_bonus = 0.45 if mask_index == 1 else 0
            score = (2.2 * circular) + fill + (0.35 * lower_field) + motion_bonus
            candidates.append(Candidate(
                frame=frame_index,
                x=center_x,
                y=center_y,
                width=box_width,
                height=box_height,
                area=area,
                score=score,
            ))
    return candidates


def best_track(candidates_by_frame: list[list[Candidate]]) -> list[Candidate]:
    # Dynamic programming over candidate detections. A baseball track is smooth,
    # changes size gradually, and must actually move; this rejects lights/signs.
    states: list[list[tuple[float, int | None]]] = []
    for frame_index, candidates in enumerate(candidates_by_frame):
        frame_states: list[tuple[float, int | None]] = []
        for candidate in candidates:
            best = (candidate.score, None)
            if frame_index > 0:
                for prior_index, prior in enumerate(candidates_by_frame[frame_index - 1]):
                    prior_score = states[frame_index - 1][prior_index][0]
                    distance = math.hypot(candidate.x - prior.x, candidate.y - prior.y)
                    size_ratio = max(candidate.width, candidate.height) / max(prior.width, prior.height)
                    if distance > 24 or not 0.68 <= size_ratio <= 1.47:
                        continue
                    motion_bonus = min(distance, 8) * 0.12
                    continuity = 3.2 + motion_bonus - (distance * 0.08) - (abs(math.log(size_ratio)) * 1.5)
                    value = prior_score + candidate.score + continuity
                    if value > best[0]:
                        best = (value, prior_index)
            frame_states.append(best)
        states.append(frame_states)

    endpoints: list[tuple[float, int, int]] = []
    for frame_index, frame_states in enumerate(states):
        for candidate_index, state in enumerate(frame_states):
            endpoints.append((state[0], frame_index, candidate_index))
    endpoints.sort(reverse=True)

    for _, frame_index, candidate_index in endpoints:
        track: list[Candidate] = []
        current_frame = frame_index
        current_index: int | None = candidate_index
        while current_index is not None and current_frame >= 0:
            track.append(candidates_by_frame[current_frame][current_index])
            current_index = states[current_frame][current_index][1]
            current_frame -= 1
        track.reverse()
        if len(track) < 12:
            continue
        displacement = math.hypot(track[-1].x - track[0].x, track[-1].y - track[0].y)
        if displacement >= 18:
            return track
    raise RuntimeError("No moving baseball track was found.")


NORMALIZED_BALL_RADIUS = 46.0


def refine_ball_circle(gray: np.ndarray, detection: Candidate) -> tuple[float, float, float]:
    """Fit the leather/background edge instead of trusting the bright blob box."""
    initial_radius = max(detection.width, detection.height) / 2
    angles = np.linspace(0, math.pi * 2, 96, endpoint=False)
    cosine = np.cos(angles)
    sine = np.sin(angles)
    best = (-float("inf"), detection.x, detection.y, initial_radius)
    offsets = np.linspace(-initial_radius * 0.10, initial_radius * 0.10, 7)
    radii = np.linspace(initial_radius * 0.86, initial_radius * 1.10, 13)
    for offset_y in offsets:
        center_y = detection.y + offset_y
        for offset_x in offsets:
            center_x = detection.x + offset_x
            for radius in radii:
                inside = ndimage.map_coordinates(
                    gray,
                    [center_y + sine * (radius - 1.8), center_x + cosine * (radius - 1.8)],
                    order=1,
                    mode="nearest",
                )
                outside = ndimage.map_coordinates(
                    gray,
                    [center_y + sine * (radius + 1.8), center_x + cosine * (radius + 1.8)],
                    order=1,
                    mode="nearest",
                )
                contrast = inside - outside
                # The hand can cover a minority of the circumference near release.
                # Favor a boundary supported across most angles, not one bright arc.
                score = float(np.percentile(contrast, 38) + (np.median(contrast) * 0.55))
                score -= abs(radius - initial_radius) * 0.18
                if score > best[0]:
                    best = (score, center_x, center_y, radius)
    return best[1], best[2], best[3]


def normalized_crop_from_circle(
    gray: np.ndarray,
    circle: tuple[float, float, float],
    output_size: int = 128,
) -> np.ndarray:
    center_x, center_y, radius = circle
    yy, xx = np.mgrid[:output_size, :output_size]
    scale = radius / NORMALIZED_BALL_RADIUS
    source_x = center_x + ((xx - output_size / 2) * scale)
    source_y = center_y + ((yy - output_size / 2) * scale)
    return ndimage.map_coordinates(gray, [source_y, source_x], order=3, mode="nearest").astype(np.float32)


def normalized_crop(gray: np.ndarray, detection: Candidate, output_size: int = 128) -> np.ndarray:
    return normalized_crop_from_circle(gray, refine_ball_circle(gray, detection), output_size)


def seam_evidence(crop: np.ndarray) -> tuple[np.ndarray, float, float]:
    size = crop.shape[0]
    yy, xx = np.mgrid[:size, :size]
    # The normalized crop leaves padding around the detected disk. Stay inside
    # the leather boundary so the ball/background edge is never mistaken for a seam.
    # Stay well clear of the silhouette. The TrackMan/Cloudinary crop can be a
    # few pixels off-center, and the prior 0.305 radius admitted the leather's
    # dark boundary as false seam evidence.
    radius = size * 0.265
    disk = ((xx - size / 2) ** 2 + (yy - size / 2) ** 2) <= radius ** 2
    # Remove broad lighting/shadow gradients and retain thin dark structures.
    smooth = ndimage.gaussian_filter(crop, sigma=max(size / 24, 2.5))
    dark_detail = smooth - crop
    interior_values = dark_detail[disk]
    threshold = max(float(np.percentile(interior_values, 84)), 4.0)
    seam = (dark_detail >= threshold) & disk
    seam = ndimage.binary_opening(seam, structure=np.ones((2, 2)))
    seam_fraction = float(seam.sum() / max(disk.sum(), 1))
    sharpness = float(np.var(ndimage.laplace(crop)[disk]))
    return seam, seam_fraction, sharpness


def baseball_seam_points(count: int = 720) -> np.ndarray:
    parameter = np.linspace(0, math.pi * 4, count, endpoint=False)
    seam_shape = 0.4
    polar = (math.pi / 2) - (((math.pi / 2) - seam_shape) * np.cos(parameter))
    azimuth = (parameter / 2) + (seam_shape * np.sin(parameter * 2))
    return np.column_stack((
        np.sin(polar) * np.cos(azimuth),
        np.sin(polar) * np.sin(azimuth),
        np.cos(polar),
    ))


def spherical_temporal_seam_pose(
    observations: list[tuple[int, np.ndarray, np.ndarray]],
    axis: np.ndarray,
    phase_step: float,
    seam_points: np.ndarray,
) -> tuple[np.ndarray, float, float, int]:
    """Fuse seam evidence from many frames onto one spherical surface.

    The angular-velocity solve supplies the relative rigid rotation between
    frames. Back-projecting each interior seam pixel to the near hemisphere and
    undoing that rotation produces a single reference-space point cloud. This
    makes the ball-cover orientation compete against the complete temporal seam
    pattern instead of a collection of unrelated 2-D dark-pixel masks.
    """
    if len(observations) < 10:
        raise RuntimeError("Not enough observations for spherical seam fusion.")
    size = observations[0][2].shape[0]
    center = size / 2
    first_frame = observations[0][0]
    fused: list[np.ndarray] = []
    for frame_index, seam, _ in observations:
        pixel_y, pixel_x = np.nonzero(seam)
        x = (pixel_x - center) / NORMALIZED_BALL_RADIUS
        y = (center - pixel_y) / NORMALIZED_BALL_RADIUS
        radial_squared = (x * x) + (y * y)
        usable = radial_squared <= 0.74 ** 2
        if int(usable.sum()) < 12:
            continue
        x = x[usable]
        y = y[usable]
        z = np.sqrt(np.maximum(0, 1 - radial_squared[usable]))
        camera_points = np.column_stack((x, y, z))
        motion = Rotation.from_rotvec(axis * phase_step * (frame_index - first_frame)).as_matrix()
        # Row vectors: camera = reference @ motion.T, hence reference = camera @ motion.
        fused.append(camera_points @ motion)
    if not fused:
        raise RuntimeError("No seam pixels survived spherical back-projection.")
    evidence = np.concatenate(fused)
    # Quantization prevents a handful of long, over-segmented frames from
    # dominating simply because they contributed duplicate neighboring pixels.
    quantized = np.round(evidence / 0.025).astype(np.int16)
    _, unique_indices = np.unique(quantized, axis=0, return_index=True)
    evidence = evidence[np.sort(unique_indices)]
    if len(evidence) > 18000:
        sample_indices = np.linspace(0, len(evidence) - 1, 18000).round().astype(int)
        evidence = evidence[sample_indices]
    evidence_tree = cKDTree(evidence)
    reverse_evidence = evidence
    if len(reverse_evidence) > 3500:
        sample_indices = np.linspace(0, len(reverse_evidence) - 1, 3500).round().astype(int)
        reverse_evidence = reverse_evidence[sample_indices]

    def spherical_cost(euler: np.ndarray) -> float:
        orientation = Rotation.from_euler("xyz", euler).as_matrix()
        predicted = seam_points @ orientation.T
        forward_distance, _ = evidence_tree.query(predicted, k=1)
        forward_cost = float(np.mean(np.minimum(forward_distance, 0.18)))
        forward_support = float(np.mean(forward_distance <= 0.075))
        predicted_tree = cKDTree(predicted)
        reverse_distance, _ = predicted_tree.query(reverse_evidence, k=1)
        reverse_distance.sort()
        reverse_supported = reverse_distance[:max(80, int(len(reverse_distance) * 0.58))]
        reverse_cost = float(np.mean(np.minimum(reverse_supported, 0.18)))
        return forward_cost + (0.45 * reverse_cost) + (0.08 * (1 - forward_support))

    grid = np.linspace(-math.pi, math.pi, 9, endpoint=False)
    seeds = np.array(np.meshgrid(grid, grid, grid)).T.reshape(-1, 3)
    scored = sorted((spherical_cost(seed), seed) for seed in seeds)
    best: tuple[float, np.ndarray] | None = None
    for _, seed in scored[:10]:
        refined = minimize(
            spherical_cost,
            seed,
            method="Nelder-Mead",
            options={"xatol": 5e-4, "fatol": 2e-5, "maxiter": 450, "adaptive": True},
        )
        cost = spherical_cost(refined.x)
        if best is None or cost < best[0]:
            best = (cost, refined.x)
    assert best is not None
    best_cost, best_euler = best
    orientation = Rotation.from_euler("xyz", best_euler).as_matrix()
    predicted = seam_points @ orientation.T
    distance, _ = evidence_tree.query(predicted, k=1)
    support = float(np.mean(distance <= 0.075))
    return orientation, float(best_cost), support, int(len(evidence))


def brightness_flow_axis(observations: list[tuple[int, np.ndarray, np.ndarray]]) -> tuple[np.ndarray, float, float, float] | None:
    """Estimate the 3D angular-velocity direction directly from Edger pixels.

    For an orthographic sphere, image velocity is the projection of omega x r.
    Substituting that field into the brightness-constancy equation gives a
    linear solve for all three angular components. This is independent of
    TrackMan release tilt and spin efficiency; the seam model fit can then
    refine the pixel-derived axis instead of blindly searching the sphere.
    """
    if len(observations) < 8:
        return None
    size = observations[0][2].shape[0]
    yy, xx = np.mgrid[:size, :size]
    x = (xx - size / 2) / NORMALIZED_BALL_RADIUS
    y = (size / 2 - yy) / NORMALIZED_BALL_RADIUS
    radial_squared = (x * x) + (y * y)
    disk = radial_squared <= 0.68 ** 2
    z = np.sqrt(np.maximum(0, 1 - radial_squared))
    pair_solutions: list[np.ndarray] = []
    for (frame_a, _, crop_a), (frame_b, _, crop_b) in zip(observations, observations[1:]):
        frame_gap = frame_b - frame_a
        if frame_gap < 1 or frame_gap > 2:
            continue
        detail_a = crop_a - ndimage.gaussian_filter(crop_a, sigma=3.2)
        detail_b = crop_b - ndimage.gaussian_filter(crop_b, sigma=3.2)
        average = (detail_a + detail_b) * 0.5
        gradient_down, gradient_x = np.gradient(average)
        gradient_y = -gradient_down
        temporal = (detail_b - detail_a) / frame_gap
        strength = np.hypot(gradient_x, gradient_y)
        cutoff = float(np.percentile(strength[disk], 72))
        usable = disk & (strength >= max(cutoff, 0.8))
        # Pixel displacement = normalized spherical velocity * crop radius.
        design = np.column_stack((
            (-gradient_y[usable] * z[usable]) * NORMALIZED_BALL_RADIUS,
            (gradient_x[usable] * z[usable]) * NORMALIZED_BALL_RADIUS,
            ((-gradient_x[usable] * y[usable]) + (gradient_y[usable] * x[usable])) * NORMALIZED_BALL_RADIUS,
        ))
        target = -temporal[usable]
        finite = np.all(np.isfinite(design), axis=1) & np.isfinite(target)
        design = design[finite]
        target = target[finite]
        if len(target) < 80:
            continue
        solution, *_ = np.linalg.lstsq(design, target, rcond=None)
        magnitude = float(np.linalg.norm(solution))
        if math.radians(1) <= magnitude <= math.radians(35):
            pair_solutions.append(solution)
    if len(pair_solutions) < 5:
        return None
    solutions = np.asarray(pair_solutions)
    magnitudes = np.linalg.norm(solutions, axis=1)
    axes = solutions / magnitudes[:, None]
    cosine_gate = math.cos(math.radians(42))
    support = np.asarray([(axes @ candidate >= cosine_gate).sum() for candidate in axes])
    seed = axes[int(np.argmax(support))]
    inliers = (axes @ seed) >= cosine_gate
    if int(inliers.sum()) < 4:
        return None
    axis = np.average(axes[inliers], axis=0, weights=magnitudes[inliers])
    axis /= np.linalg.norm(axis)
    phase = float(np.median(solutions[inliers] @ axis))
    angular_residuals = np.degrees(np.arccos(np.clip(axes[inliers] @ axis, -1, 1)))
    return axis, abs(phase), float(inliers.mean()), float(np.median(angular_residuals))


@dataclass
class _FitResult:
    x: np.ndarray
    fun: float
    success: bool
    message: str


def _grid_search_and_refine(
    objective,
    bounds: list[tuple[float, float]],
    lock_axis_prior: bool,
    coarse_objective=None,
    grid_size: int = 7,
    top_k: int = 6,
) -> _FitResult:
    """Coarse grid search over the free rotation parameters, then refine the
    best candidates with a local optimizer.

    A single differential_evolution run over this cost surface can report
    "success" while sitting in a shallow local minimum that never actually
    tracks the visible seam: the baseball's near-bilateral seam symmetry and a
    generous distance-clip tolerance produce many similarly-scoring but wrong
    orientations. A dense grid search can't get stuck oscillating the way
    random mutation can, and Nelder-Mead refinement from several of the best
    grid points cheaply cleans up whichever basin is actually correct.
    """
    # bounds order: [euler_x, euler_y, euler_z, axis_theta, axis_phi, phase]
    euler_grid = np.linspace(-math.pi, math.pi, grid_size, endpoint=False)
    grid_points = np.array(np.meshgrid(euler_grid, euler_grid, euler_grid)).T.reshape(-1, 3)
    phase_low, phase_high = bounds[5]
    # The measured-RPM phase bound is one-sided (a positive magnitude), but the
    # video's apparent spin direction relative to that magnitude is unknown
    # ahead of time, so search both signs explicitly instead of only the
    # bounded (implicitly positive) direction.
    phase_candidates = [phase_low, phase_high, -phase_low, -phase_high] if phase_low > 0 else [phase_low, phase_high]

    if lock_axis_prior:
        axis_theta = sum(bounds[3]) / 2
        axis_phi = sum(bounds[4]) / 2
        axis_candidates = [(axis_theta, axis_phi)]
    else:
        locally_seeded = (bounds[3][1] - bounds[3][0]) < math.radians(30)
        axis_theta_grid = np.linspace(bounds[3][0], bounds[3][1], 3 if locally_seeded else 5)
        axis_phi_grid = np.linspace(bounds[4][0], bounds[4][1], 3 if locally_seeded else 8, endpoint=locally_seeded)
        axis_candidates = [(theta, phi) for theta in axis_theta_grid for phi in axis_phi_grid]

    scored: list[tuple[float, np.ndarray]] = []
    for axis_theta, axis_phi in axis_candidates:
        for phase_step in phase_candidates:
            for euler in grid_points:
                parameters = np.array([*euler, axis_theta, axis_phi, phase_step])
                scorer = coarse_objective or objective
                scored.append((scorer(parameters), parameters))
    scored.sort(key=lambda item: item[0])

    best: _FitResult | None = None
    for _, seed_parameters in scored[:top_k]:
        refined = minimize(
            objective,
            seed_parameters,
            method="Nelder-Mead",
            options={"xatol": 1e-3, "fatol": 1e-3, "maxiter": 300, "adaptive": True},
        )
        # Clamp back into the caller's bounds (Nelder-Mead is unconstrained;
        # the locked-axis window in particular must not drift). Phase bounds
        # describe a magnitude; preserve the fitted sign because it is the
        # observed rotation direction. The previous generic clamp silently
        # turned every negative phase candidate into a positive one.
        clamped_values = [
            min(max(value, low), high)
            for value, (low, high) in zip(refined.x[:5], bounds[:5])
        ]
        phase_low, phase_high = bounds[5]
        phase_sign = -1 if refined.x[5] < 0 else 1
        clamped_values.append(phase_sign * min(max(abs(refined.x[5]), phase_low), phase_high))
        clamped = np.asarray(clamped_values)
        clamped_cost = objective(clamped)
        if best is None or clamped_cost < best.fun:
            best = _FitResult(x=clamped, fun=clamped_cost, success=bool(refined.success), message=str(refined.message))
    assert best is not None
    return best


def fit_seam_motion(
    frames: list[np.ndarray],
    track: list[Candidate],
    overlay_destination: Path,
    spin_rate_rpm: float | None = None,
    capture_fps: float | None = None,
    axis_tilt_degrees: float | None = None,
    spin_efficiency: float | None = None,
    fit_start_frame: int | None = None,
    fit_end_frame: int | None = None,
    lock_axis_prior: bool = False,
    gyro_sign: int = 1,
    sample_count: int = 18,
) -> dict[str, float | list[float] | str]:
    detection_by_frame = {candidate.frame: candidate for candidate in track}
    tracked_circles: list[tuple[int, np.ndarray, tuple[float, float, float]]] = []
    for frame_index, frame in enumerate(frames):
        frame_number = frame_index + 1
        if fit_start_frame is not None and frame_number < fit_start_frame:
            continue
        if fit_end_frame is not None and frame_number > fit_end_frame:
            continue
        detection = detection_by_frame.get(frame_index)
        if detection is not None:
            tracked_circles.append((frame_index, frame, refine_ball_circle(frame, detection)))

    # The ball is only 15-26 native pixels across in these clips. Independent
    # circle fits can therefore jitter by one or two source pixels, which turns
    # into a 3-6 pixel false seam displacement after normalization. Center and
    # radius must follow a smooth flight path before any seam motion is judged.
    raw_circles = np.asarray([item[2] for item in tracked_circles], dtype=float)
    if len(raw_circles) >= 5:
        smooth_circles = np.column_stack([
            ndimage.gaussian_filter1d(
                ndimage.median_filter(raw_circles[:, column], size=5, mode="nearest"),
                sigma=1.0,
                mode="nearest",
            )
            for column in range(3)
        ])
    else:
        smooth_circles = raw_circles

    preliminary: list[tuple[int, np.ndarray, np.ndarray, tuple[float, float, float]]] = []
    for (frame_index, frame, raw_circle), smooth_circle_array in zip(tracked_circles, smooth_circles):
        circle = tuple(float(value) for value in smooth_circle_array)
        # A severe raw-radius excursion signals a hand/foreground merge. Do not
        # let smoothing make that bad detection look trustworthy.
        if circle[2] <= 0 or abs(math.log(raw_circle[2] / circle[2])) > math.log(1.16):
            continue
        crop = normalized_crop_from_circle(frame, circle)
        seam, fraction, sharpness = seam_evidence(crop)
        if 0.025 <= fraction <= 0.21 and sharpness >= 7:
            preliminary.append((frame_index, seam, crop, circle))
    # A foreground component can briefly merge with a sleeve or background
    # edge and make the fitted ball radius jump by 30-50% for a few frames.
    # Those crops look superficially sharp but corrupt the 3D seam solution.
    # Compare against a robust local radius trend and reject impossible jumps.
    observations: list[tuple[int, np.ndarray, np.ndarray]] = []
    if preliminary:
        radii = np.asarray([item[3][2] for item in preliminary], dtype=float)
        window = min(11, len(radii) if len(radii) % 2 else len(radii) - 1)
        radius_trend = ndimage.median_filter(radii, size=max(window, 1), mode="nearest")
        for item, expected_radius in zip(preliminary, radius_trend):
            radius = item[3][2]
            if expected_radius > 0 and abs(math.log(radius / expected_radius)) <= math.log(1.16):
                observations.append((item[0], item[1], item[2]))
    if len(observations) < 10:
        raise RuntimeError("Not enough clean seam frames to fit rotational motion.")

    flow_estimate = brightness_flow_axis(observations)
    flow_axis = flow_estimate[0] if flow_estimate is not None else None
    flow_phase = math.degrees(flow_estimate[1]) if flow_estimate is not None else None
    flow_support = flow_estimate[2] if flow_estimate is not None else None
    flow_spread = flow_estimate[3] if flow_estimate is not None else None

    chosen = np.linspace(0, len(observations) - 1, min(sample_count, len(observations))).round().astype(int)
    sampled = [observations[int(index)] for index in chosen]
    first_frame = sampled[0][0]
    seam_points = baseball_seam_points()
    distance_maps = [ndimage.distance_transform_edt(~mask) for _, mask, _ in sampled]
    radius = NORMALIZED_BALL_RADIUS
    center = 64.0

    def projected_pixels(rotation: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        rotated = seam_points @ rotation.T
        visible = rotated[:, 2] >= -0.015
        # Only fit the interior seam. Near-limb pixels are where blur, shadow,
        # and small crop-center errors most often mimic a seam.
        visible &= np.hypot(rotated[:, 0], rotated[:, 1]) <= 0.82
        x = np.rint(center + (rotated[visible, 0] * radius)).astype(np.int16)
        y = np.rint(center - (rotated[visible, 1] * radius)).astype(np.int16)
        valid = (x >= 0) & (x < 128) & (y >= 0) & (y < 128)
        return x[valid], y[valid]

    DISTANCE_CLIP = 9.0

    def alignment_cost(rotation: np.ndarray, observed: np.ndarray, distance_map: np.ndarray) -> float:
        x, y = projected_pixels(rotation)
        if x.size == 0:
            return 100.0
        distances = np.minimum(distance_map[y, x], DISTANCE_CLIP)
        distances.sort()
        supported = distances[: max(24, int(distances.size * 0.86))]
        forward_cost = float(np.mean(supported)) + (float(np.median(distances)) * 0.18)

        projected_mask = np.zeros((128, 128), dtype=bool)
        projected_mask[y, x] = True
        projected_mask = ndimage.binary_dilation(projected_mask, iterations=1)
        projected_distance = ndimage.distance_transform_edt(~projected_mask)
        observed_y, observed_x = np.nonzero(observed)
        reverse_distances = np.minimum(projected_distance[observed_y, observed_x], DISTANCE_CLIP)
        reverse_distances.sort()
        reverse_supported = reverse_distances[: max(12, int(reverse_distances.size * 0.82))]
        reverse_cost = float(np.mean(reverse_supported)) if reverse_supported.size else DISTANCE_CLIP
        return forward_cost + (reverse_cost * 0.42)

    # The reverse-distance mask construction dominates the exhaustive grid.
    # Use a forward-only score on six temporal checkpoints to find promising
    # basins, then evaluate and refine those candidates with the full symmetric
    # objective. This keeps video-only axis solving practical without changing
    # the final objective.
    coarse_indices = np.linspace(0, len(sampled) - 1, min(6, len(sampled))).round().astype(int)
    coarse_samples = [sampled[int(index)] for index in coarse_indices]
    coarse_maps = [distance_maps[int(index)] for index in coarse_indices]

    def coarse_objective(parameters: np.ndarray) -> float:
        initial = Rotation.from_euler("xyz", parameters[:3]).as_matrix()
        axis = np.array([
            math.sin(parameters[3]) * math.cos(parameters[4]),
            math.sin(parameters[3]) * math.sin(parameters[4]),
            math.cos(parameters[3]),
        ])
        costs: list[float] = []
        for (frame_index, _, _), distance_map in zip(coarse_samples, coarse_maps):
            phase = parameters[5] * (frame_index - first_frame)
            rotated = Rotation.from_rotvec(axis * phase).as_matrix() @ initial
            x, y = projected_pixels(rotated)
            distances = np.minimum(distance_map[y, x], DISTANCE_CLIP)
            distances.sort()
            supported = distances[: max(24, int(distances.size * 0.86))]
            costs.append(float(np.mean(supported)))
        return float(np.mean(costs))

    def objective(parameters: np.ndarray) -> float:
        initial = Rotation.from_euler("xyz", parameters[:3]).as_matrix()
        axis = np.array([
            math.sin(parameters[3]) * math.cos(parameters[4]),
            math.sin(parameters[3]) * math.sin(parameters[4]),
            math.cos(parameters[3]),
        ])
        phase_step = parameters[5]
        costs: list[float] = []
        for (frame_index, observed, _), distance_map in zip(sampled, distance_maps):
            phase = phase_step * (frame_index - first_frame)
            motion = Rotation.from_rotvec(axis * phase).as_matrix()
            costs.append(alignment_cost(motion @ initial, observed, distance_map))
        cost = float(np.mean(costs))
        # A single monochrome view of a symmetric baseball can admit multiple
        # nearly identical seam fits. When TrackMan supplies movement tilt or
        # efficiency, use them only as weak priors to select between those
        # video-equivalent solutions; pixels remain the dominant fit signal.
        if axis_tilt_degrees is not None and math.hypot(axis[0], axis[1]) > 0.04:
            fitted_tilt = (math.degrees(math.atan2(-axis[1], axis[0])) + 180) % 360
            tilt_delta = abs((fitted_tilt - axis_tilt_degrees + 180) % 360 - 180)
            cost += 0.7 * (tilt_delta / 45) ** 2
        if spin_efficiency is not None:
            normalized_efficiency = min(max(spin_efficiency, 0), 1)
            cost += 2.5 * (math.hypot(axis[0], axis[1]) - normalized_efficiency) ** 2
        return cost

    if spin_rate_rpm is not None and spin_rate_rpm > 0:
        effective_capture_fps = capture_fps if capture_fps is not None and capture_fps > 0 else 1000
        expected_step = math.radians((spin_rate_rpm * 6) / effective_capture_fps)
        tolerance = 0.025 if capture_fps is not None else 0.22
        phase_bounds = (
            max(math.radians(2), expected_step * (1 - tolerance)),
            min(math.radians(28), expected_step * (1 + tolerance)),
        )
    else:
        phase_bounds = (math.radians(2), math.radians(28))
    axis_bounds = [(0, math.pi), (-math.pi, math.pi)]
    if lock_axis_prior:
        if axis_tilt_degrees is None or spin_efficiency is None:
            raise RuntimeError("--lock-axis-prior requires tilt and spin efficiency.")
        efficiency = min(max(spin_efficiency, 0), 1)
        active_angle = math.radians(axis_tilt_degrees - 180)
        # Release tilt is the transverse Magnus/movement direction, not the
        # physical rotation axis. The two are perpendicular. This matches
        # spinAxisFromInputs() in lib/pitch-spin-simulator.ts.
        scene_x = -math.cos(active_angle) * efficiency
        scene_z = -math.sin(active_angle) * efficiency
        scene_y = (1 if gyro_sign >= 0 else -1) * math.sqrt(max(0.0, 1 - efficiency * efficiency))
        raw_axis = np.array([-scene_x, scene_z, scene_y])
        raw_axis /= np.linalg.norm(raw_axis)
        locked_theta = math.acos(float(np.clip(raw_axis[2], -1, 1)))
        locked_phi = math.atan2(float(raw_axis[1]), float(raw_axis[0]))
        axis_bounds = [
            (max(0, locked_theta - 0.004), min(math.pi, locked_theta + 0.004)),
            (max(-math.pi, locked_phi - 0.004), min(math.pi, locked_phi + 0.004)),
        ]
    elif flow_axis is not None and flow_support is not None and flow_spread is not None \
            and flow_support >= 0.30 and flow_spread <= 30:
        # The direction comes entirely from Edger pixel motion. Let the seam
        # reprojection refine it locally, but do not allow a distant symmetric
        # seam minimum to replace the observed motion axis.
        flow_theta = math.acos(float(np.clip(flow_axis[2], -1, 1)))
        flow_phi = math.atan2(float(flow_axis[1]), float(flow_axis[0]))
        axis_window = math.radians(12)
        axis_bounds = [
            (max(0, flow_theta - axis_window), min(math.pi, flow_theta + axis_window)),
            (flow_phi - axis_window, flow_phi + axis_window),
        ]
    bounds = [
        (-math.pi, math.pi), (-math.pi, math.pi), (-math.pi, math.pi),
        *axis_bounds, phase_bounds,
    ]
    spherical_fit: tuple[np.ndarray, float, float, int] | None = None
    if not lock_axis_prior and flow_axis is not None and flow_support is not None and flow_spread is not None \
            and flow_support >= 0.30 and flow_spread <= 30:
        fusion_axis = flow_axis.copy()
        fusion_phase = sum(phase_bounds) / 2
        result: _FitResult | None = None
        # Alternate spherical fusion with image-space refinement. Re-unwrapping
        # with the refined motion prevents a small brightness-flow axis error
        # from smearing the fused seam and selecting the wrong cover pose.
        for pass_index in range(2):
            spherical_fit = spherical_temporal_seam_pose(
                observations,
                fusion_axis,
                fusion_phase,
                seam_points,
            )
            spherical_orientation, _, _, _ = spherical_fit
            spherical_euler = Rotation.from_matrix(spherical_orientation).as_euler("xyz")
            fusion_theta = math.acos(float(np.clip(fusion_axis[2], -1, 1)))
            fusion_phi = math.atan2(float(fusion_axis[1]), float(fusion_axis[0]))
            seed = np.asarray([*spherical_euler, fusion_theta, fusion_phi, fusion_phase])
            pose_window = math.radians(14 if pass_index == 0 else 10)
            local_bounds = [
                (value - pose_window, value + pose_window) for value in spherical_euler
            ] + [*axis_bounds, phase_bounds]
            refined = minimize(
                objective,
                seed,
                method="Powell",
                bounds=local_bounds,
                options={"xtol": 5e-4, "ftol": 2e-4, "maxiter": 180},
            )
            result = _FitResult(
                x=np.asarray(refined.x),
                fun=float(objective(refined.x)),
                success=bool(refined.success),
                message=f"spherical-temporal pass {pass_index + 1}; {refined.message}",
            )
            fusion_axis = np.array([
                math.sin(result.x[3]) * math.cos(result.x[4]),
                math.sin(result.x[3]) * math.sin(result.x[4]),
                math.cos(result.x[3]),
            ])
            fusion_phase = abs(float(result.x[5]))
        assert result is not None
        if result.fun > 5.25:
            global_result = _grid_search_and_refine(
                objective,
                bounds,
                lock_axis_prior,
                coarse_objective,
                grid_size=7,
                top_k=8,
            )
            if global_result.fun < result.fun:
                global_result.message = (
                    f"full temporal search beat {result.message}; {global_result.message}"
                )
                result = global_result
    else:
        result = _grid_search_and_refine(objective, bounds, lock_axis_prior, coarse_objective)
    parameters = result.x
    axis = np.array([
        math.sin(parameters[3]) * math.cos(parameters[4]),
        math.sin(parameters[3]) * math.sin(parameters[4]),
        math.cos(parameters[3]),
    ])
    euler = np.degrees(parameters[:3])
    phase_degrees = math.degrees(parameters[5])
    # Canonicalize the physical angular-velocity vector: the stored axis owns
    # the observed direction and the stored phase is a positive magnitude.
    # This removes the need for a global UI sign guess.
    if phase_degrees < 0:
        axis *= -1
        phase_degrees *= -1
        parameters[5] *= -1
    initial = Rotation.from_euler("xyz", parameters[:3]).as_matrix()
    sampled_frame_ids = {item[0] for item in sampled}
    held_out = [item for item in observations if item[0] not in sampled_frame_ids]
    if len(held_out) > 16:
        held_indices = np.linspace(0, len(held_out) - 1, 16).round().astype(int)
        held_out = [held_out[int(index)] for index in held_indices]
    held_out_costs: list[float] = []
    for frame_index, observed, _ in held_out:
        phase = parameters[5] * (frame_index - first_frame)
        motion = Rotation.from_rotvec(axis * phase).as_matrix()
        distance_map = ndimage.distance_transform_edt(~observed)
        held_out_costs.append(alignment_cost(motion @ initial, observed, distance_map))

    def overlap_metrics(frame_index: int, observed: np.ndarray) -> tuple[float, float]:
        phase = parameters[5] * (frame_index - first_frame)
        motion = Rotation.from_rotvec(axis * phase).as_matrix()
        x, y = projected_pixels(motion @ initial)
        observed_distance = ndimage.distance_transform_edt(~observed)
        predicted_support = float(np.mean(observed_distance[y, x] <= 3.0)) if x.size else 0.0
        predicted_mask = np.zeros((128, 128), dtype=bool)
        predicted_mask[y, x] = True
        predicted_distance = ndimage.distance_transform_edt(~predicted_mask)
        observed_y, observed_x = np.nonzero(observed)
        observed_support = float(np.mean(predicted_distance[observed_y, observed_x] <= 3.0)) \
            if observed_x.size else 0.0
        return predicted_support, observed_support

    validation_observations = held_out if held_out else sampled
    overlap = np.asarray([
        overlap_metrics(frame_index, observed)
        for frame_index, observed, _ in validation_observations
    ])
    overlap_pass = (overlap[:, 0] >= 0.35) & (overlap[:, 1] >= 0.45)
    overlay_tiles: list[Image.Image] = []
    for frame_index, observed, crop in sampled:
        phase = parameters[5] * (frame_index - first_frame)
        motion = Rotation.from_rotvec(axis * phase).as_matrix()
        x, y = projected_pixels(motion @ initial)
        rgb = np.repeat(crop[:, :, None], 3, axis=2).clip(0, 255).astype(np.uint8)
        rgb[observed, 0] = 255
        rgb[observed, 1] = 50
        rgb[observed, 2] = 50
        predicted = np.zeros((128, 128), dtype=bool)
        predicted[y, x] = True
        predicted = ndimage.binary_dilation(predicted, iterations=1)
        rgb[predicted, 0] = 40
        rgb[predicted, 1] = 235
        rgb[predicted, 2] = 120
        tile = Image.fromarray(rgb).resize((192, 192), Image.Resampling.NEAREST)
        draw = ImageDraw.Draw(tile)
        draw.rectangle((0, 0, 89, 22), fill=(0, 0, 0))
        draw.text((6, 4), f"frame {frame_index + 1}", fill=(255, 255, 255))
        overlay_tiles.append(tile)
    overlay = Image.new("RGB", (192 * 4, 192 * math.ceil(len(overlay_tiles) / 4)), (12, 12, 12))
    for index, tile in enumerate(overlay_tiles):
        overlay.paste(tile, ((index % 4) * 192, (index // 4) * 192))
    overlay.save(overlay_destination, quality=92)

    report: dict[str, float | list[float] | str | bool] = {
        "coordinate_frame": "edger_camera",
        "initial_seam_euler_xyz_deg": [round(float(value), 3) for value in euler],
        "spin_axis_camera_xyz": [round(float(value), 5) for value in axis],
        "phase_degrees_per_export_frame": round(phase_degrees, 4),
        "sampled_frames": len(sampled),
        "fit_first_frame": sampled[0][0] + 1,
        "fit_last_frame": sampled[-1][0] + 1,
        "fit_cost_px": round(float(result.fun), 4),
        "held_out_frames": len(held_out_costs),
        "held_out_cost_px": round(float(np.mean(held_out_costs)), 4) if held_out_costs else None,
        "held_out_predicted_seam_support_median": round(float(np.median(overlap[:, 0])), 4),
        "held_out_observed_seam_support_median": round(float(np.median(overlap[:, 1])), 4),
        "held_out_aligned_frame_fraction": round(float(np.mean(overlap_pass)), 4),
        "optimizer_success": bool(result.success),
        "optimizer_message": str(result.message),
        "overlay_image": str(overlay_destination),
        "ambiguity": "Baseball seam symmetry and uncalibrated single-camera depth remain unresolved.",
        # Invert the same physical-axis construction above. Camera XYZ maps
        # to scene (-X, Z, Y), so active movement angle is atan2(-scene Z,
        # -scene X) = atan2(-camera Y, camera X).
        "video_release_tilt_degrees": round(
            (math.degrees(math.atan2(-axis[1], axis[0])) + 180) % 360,
            3,
        ),
        "video_active_spin_fraction": round(float(math.hypot(axis[0], axis[1])), 5),
        "axis_prior_locked": lock_axis_prior,
        "gyro_sign": 1 if gyro_sign >= 0 else -1,
    }
    if flow_axis is not None and flow_phase is not None:
        report["brightness_flow_axis_camera_xyz"] = [round(float(value), 5) for value in flow_axis]
        report["brightness_flow_phase_degrees_per_frame"] = round(float(flow_phase), 4)
        report["brightness_flow_support_fraction"] = round(float(flow_support or 0), 4)
        report["brightness_flow_axis_spread_degrees"] = round(float(flow_spread or 0), 3)
        report["axis_video_flow_constrained"] = bool(
            flow_support is not None and flow_spread is not None
            and flow_support >= 0.30 and flow_spread <= 30
        )
    if spherical_fit is not None:
        _, spherical_cost, spherical_support, spherical_points = spherical_fit
        report["spherical_temporal_pose"] = True
        report["spherical_temporal_cost"] = round(float(spherical_cost), 5)
        report["spherical_temporal_seam_support"] = round(float(spherical_support), 4)
        report["spherical_temporal_evidence_points"] = spherical_points
    if axis_tilt_degrees is not None:
        report["axis_tilt_prior_degrees"] = round(axis_tilt_degrees, 3)
    if spin_efficiency is not None:
        report["spin_efficiency_prior"] = round(spin_efficiency, 5)
    if spin_rate_rpm is not None and spin_rate_rpm > 0:
        inferred_capture_fps = (spin_rate_rpm * 6) / phase_degrees
        rpm_at_1000_fps = (phase_degrees * 1000) / 6
        report["measured_spin_rate_rpm"] = round(spin_rate_rpm, 3)
        report["inferred_capture_fps"] = round(inferred_capture_fps, 2)
        report["spin_rate_if_1000_fps"] = round(rpm_at_1000_fps, 2)
        report["spin_rate_error_at_1000_fps_pct"] = round(
            abs(rpm_at_1000_fps - spin_rate_rpm) / spin_rate_rpm * 100,
            2,
        )
        if capture_fps is not None:
            report["capture_fps_constraint"] = round(capture_fps, 3)
    return report


def make_diagnostics(
    frames: list[np.ndarray], track: list[Candidate], destination: Path,
) -> dict[str, float | int | str]:
    destination.mkdir(parents=True, exist_ok=True)
    usable: list[tuple[Candidate, np.ndarray, np.ndarray, float, float]] = []
    frame_lookup = {candidate.frame: candidate for candidate in track}
    for frame_index, gray in enumerate(frames):
        candidate = frame_lookup.get(frame_index)
        if candidate is None:
            continue
        crop = normalized_crop(gray, candidate)
        seam, fraction, sharpness = seam_evidence(crop)
        if 0.015 <= fraction <= 0.22:
            usable.append((candidate, crop, seam, fraction, sharpness))

    if not usable:
        raise RuntimeError("The ball was tracked, but no frames passed the seam-visibility gate.")

    sample_count = min(16, len(usable))
    sample_indices = np.linspace(0, len(usable) - 1, sample_count).round().astype(int)
    tiles: list[Image.Image] = []
    for sample_index in sample_indices:
        candidate, crop, seam, _, _ = usable[int(sample_index)]
        rgb = np.repeat(crop[:, :, None], 3, axis=2).clip(0, 255).astype(np.uint8)
        rgb[seam, 0] = 255
        rgb[seam, 1] = 45
        rgb[seam, 2] = 45
        tile = Image.fromarray(rgb).resize((192, 192), Image.Resampling.NEAREST)
        draw = ImageDraw.Draw(tile)
        draw.rectangle((0, 0, 84, 22), fill=(0, 0, 0))
        draw.text((6, 4), f"frame {candidate.frame + 1}", fill=(255, 255, 255))
        tiles.append(tile)

    sheet = Image.new("RGB", (192 * 4, 192 * math.ceil(len(tiles) / 4)), (12, 12, 12))
    for index, tile in enumerate(tiles):
        sheet.paste(tile, ((index % 4) * 192, (index // 4) * 192))
    sheet.save(destination / "seam-diagnostics.jpg", quality=92)

    seam_fractions = [item[3] for item in usable]
    sharpnesses = [item[4] for item in usable]
    radii = [max(item[0].width, item[0].height) / 2 for item in usable]
    displacement = math.hypot(track[-1].x - track[0].x, track[-1].y - track[0].y)
    visibility_score = min(1.0, len(usable) / 24) * min(1.0, np.median(radii) / 18)
    return {
        "tracked_frames": len(track),
        "usable_seam_frames": len(usable),
        "first_tracked_frame": track[0].frame + 1,
        "last_tracked_frame": track[-1].frame + 1,
        "median_ball_radius_px": round(float(np.median(radii)), 2),
        "median_seam_fraction": round(float(np.median(seam_fractions)), 4),
        "median_sharpness": round(float(np.median(sharpnesses)), 2),
        "track_displacement_px": round(displacement, 2),
        "visibility_score": round(float(visibility_score), 3),
        "diagnostic_image": str(destination / "seam-diagnostics.jpg"),
    }


def probe(video: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration",
            "-of", "json", str(video),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)["streams"][0]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("video", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--keep-frames", action="store_true")
    parser.add_argument("--fit", action="store_true", help="Fit seam phase and spin axis in Edger camera coordinates.")
    parser.add_argument("--spin-rate-rpm", type=float, help="Measured RPM used only as an independent temporal check.")
    parser.add_argument("--capture-fps", type=float, help="Known Edger capture rate; constrains measured-RPM phase progression.")
    parser.add_argument("--observed-ivb", type=float, help="Optional measured IVB used only to reject an impossible spin-axis hemisphere.")
    parser.add_argument("--observed-hb", type=float, help="Optional measured HB used only to reject an impossible spin-axis hemisphere.")
    parser.add_argument("--axis-tilt-degrees", type=float, help="Optional weak TrackMan tilt prior used to resolve video seam symmetry.")
    parser.add_argument("--spin-efficiency", type=float, help="Optional weak TrackMan spin-efficiency prior, expressed from 0 to 1.")
    parser.add_argument("--fit-start-frame", type=int, help="First 1-based post-release frame eligible for the seam fit.")
    parser.add_argument("--fit-end-frame", type=int, help="Last 1-based post-release frame eligible for the seam fit.")
    parser.add_argument("--lock-axis-prior", action="store_true", help="Lock axis to supplied TrackMan tilt/efficiency and fit seam pose only.")
    parser.add_argument("--gyro-sign", type=int, choices=(-1, 1), default=1, help="Gyro-axis hypothesis when a locked axis is not fully active spin.")
    parser.add_argument("--include-track", action="store_true", help="Include 2D ball centers for camera calibration.")
    args = parser.parse_args()

    if not args.video.exists():
        raise SystemExit(f"Video does not exist: {args.video}")
    args.output.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="edger-spin-"))
    try:
        frame_paths = extract_frames(args.video, temporary)
        frames = [np.asarray(Image.open(path).convert("L")) for path in frame_paths]
        background = np.median(np.stack(frames[::10]), axis=0).astype(np.uint8)
        candidates = [frame_candidates(frame, index, background) for index, frame in enumerate(frames)]
        track = best_track(candidates)
        report = {
            "schema_version": 1,
            "source": "edger_cv_audit",
            "status": "seam_fit_ready",
            "video": str(args.video),
            "video_stream": probe(args.video),
            "quality": make_diagnostics(frames, track, args.output),
            "warning": "Visibility only. Absolute seam orientation has not yet been fitted or validated.",
        }
        if args.include_track:
            report["ball_track"] = [
                {
                    "frame": item.frame + 1,
                    "x_px": round(item.x, 3),
                    "y_px": round(item.y, 3),
                    "radius_px": round(max(item.width, item.height) / 2, 3),
                }
                for item in track
            ]
        if args.fit:
            camera_fit = fit_seam_motion(
                frames,
                track,
                args.output / "seam-fit-overlay.jpg",
                spin_rate_rpm=args.spin_rate_rpm,
                capture_fps=args.capture_fps,
                axis_tilt_degrees=args.axis_tilt_degrees,
                spin_efficiency=args.spin_efficiency,
                fit_start_frame=args.fit_start_frame,
                fit_end_frame=args.fit_end_frame,
                lock_axis_prior=args.lock_axis_prior,
                gyro_sign=args.gyro_sign,
            )
            if args.observed_ivb is not None and args.observed_hb is not None:
                tilt = math.radians(float(camera_fit["video_release_tilt_degrees"]) - 180)
                predicted = np.asarray([math.sin(tilt), math.cos(tilt)])
                observed = np.asarray([args.observed_hb, args.observed_ivb], dtype=float)
                observed_size = float(np.linalg.norm(observed))
                if observed_size > 1e-6:
                    camera_fit["movement_axis_alignment"] = round(
                        float(np.dot(predicted, observed / observed_size)), 4
                    )
            report["camera_fit"] = camera_fit
            overlap_validated = (
                float(camera_fit["held_out_predicted_seam_support_median"]) >= 0.60
                and float(camera_fit["held_out_observed_seam_support_median"]) >= 0.40
                and float(camera_fit["held_out_aligned_frame_fraction"]) >= 0.50
            )
            report["status"] = "seam_fit_validated" if overlap_validated else "review_required"
            report["warning"] = (
                "Held-out temporal seam overlap passed. Import quality gates still apply."
                if overlap_validated
                else "Held-out temporal seam overlap failed; do not display or import this orientation."
            )
        (args.output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        if args.keep_frames:
            kept = args.output / "frames"
            if kept.exists():
                shutil.rmtree(kept)
            shutil.copytree(temporary, kept)
        print(json.dumps(report, indent=2))
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


if __name__ == "__main__":
    main()
