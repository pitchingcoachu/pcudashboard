#!/usr/bin/env python3
"""Train and validate a compact seam-orientation movement residual model.

The script scans TrackMan CSV archives, deduplicates by PitchUID, holds out
entire pitchers, compares context-only and context+seam ridge models, and then
fits a deployable all-data candidate. It intentionally predicts measured
movement minus a Magnus-only physics baseline; that residual is not asserted to
be pure SSW without independent validation.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

SKIP_DIRS = {".git", ".next", "node_modules", ".venv", "venv", "dist", "build"}
BALL_RADIUS_METERS = 0.0366
BALL_MASS_KG = 0.145
AIR_DENSITY_KG_M3 = 1.225
BALL_AREA_M2 = math.pi * BALL_RADIUS_METERS**2
MAGNUS_K = (0.5 * AIR_DENSITY_KG_M3 * BALL_AREA_M2) / BALL_MASS_KG
LIFT_A = 0.336
LIFT_B = 6.041
MPH_TO_MPS = 0.44704
FEET_TO_METERS = 0.3048
METERS_TO_INCHES = 39.3700787402
RUBBER_TO_PLATE_POINT_FEET = 60.5
PLATE_DEPTH_FEET = 17 / 12

REQUIRED = [
    "PitchUID", "Pitcher", "RelSpeed", "SpinRate", "Extension", "RelHeight", "RelSide",
    "InducedVertBreak", "HorzBreak", "SpinAxis3dActiveSpinRate", "SpinAxis3dSpinEfficiency",
    "SpinAxis3dTilt", "SpinAxis3dVectorX", "SpinAxis3dVectorY", "SpinAxis3dVectorZ",
    "SpinAxis3dSeamOrientationRotationX", "SpinAxis3dSeamOrientationRotationY",
    "SpinAxis3dSeamOrientationRotationZ",
]

BASE_FEATURES = [
    "velocity_mph", "spin_rate_rpm", "active_spin_rpm", "spin_efficiency",
    "extension_ft", "release_height_ft", "release_side_ft", "axis_x", "axis_y", "axis_z",
]
SEAM_FEATURES = [
    *[f"rotation_matrix_{row}{column}" for row in range(3) for column in range(3)],
    "spin_in_ball_x", "spin_in_ball_y", "spin_in_ball_z",
    "spin_ball_x_x_velocity", "spin_ball_y_x_velocity", "spin_ball_z_x_velocity",
    "spin_ball_x_x_active_spin", "spin_ball_y_x_active_spin", "spin_ball_z_x_active_spin",
]


def numeric(row: dict[str, str], name: str) -> float | None:
    raw = str(row.get(name, "")).strip().replace(",", "")
    if raw in {"", "NA", "NaN", "nan", "null", "None"}:
        return None
    try:
        value = float(raw)
        return value if math.isfinite(value) else None
    except ValueError:
        return None


def tilt_degrees(raw_value: str) -> float | None:
    raw = str(raw_value or "").strip()
    if not raw:
        return None
    if ":" in raw or "." in raw:
        separator = ":" if ":" in raw else "."
        pieces = raw.split(separator)
        if len(pieces) == 2:
            try:
                hour, minute = int(pieces[0]), int(pieces[1])
                if 1 <= hour <= 12 and 0 <= minute <= 59:
                    return (((hour % 12) * 60 + minute) / 2 - 180) % 360
            except ValueError:
                pass
    try:
        return float(raw) % 360
    except ValueError:
        return None


def magnus_movement(row: dict[str, str]) -> tuple[float, float] | None:
    velocity = numeric(row, "RelSpeed")
    total_spin = numeric(row, "SpinRate")
    active_spin = numeric(row, "SpinAxis3dActiveSpinRate")
    extension = numeric(row, "Extension")
    tilt = tilt_degrees(row.get("SpinAxis3dTilt", ""))
    if not all(value is not None for value in (velocity, total_spin, active_spin, extension, tilt)):
        return None
    assert velocity is not None and total_spin is not None and active_spin is not None
    assert extension is not None and tilt is not None
    if velocity <= 0 or total_spin <= 0 or active_spin < 0 or extension < 0:
        return None
    velocity_mps = velocity * MPH_TO_MPS
    active_radians = active_spin * (2 * math.pi / 60)
    spin_factor = BALL_RADIUS_METERS * active_radians / velocity_mps
    lift_coefficient = LIFT_A * (1 - math.exp(-LIFT_B * spin_factor))
    distance_feet = RUBBER_TO_PLATE_POINT_FEET - PLATE_DEPTH_FEET - extension
    if distance_feet <= 0:
        return None
    distance_meters = distance_feet * FEET_TO_METERS
    magnitude = 0.5 * MAGNUS_K * lift_coefficient * distance_meters**2 * METERS_TO_INCHES
    angle = math.radians(tilt - 180)
    return magnitude * math.sin(angle), magnitude * math.cos(angle)


def intrinsic_xyz_matrix(x_degrees: float, y_degrees: float, z_degrees: float) -> np.ndarray:
    x, y, z = np.radians([x_degrees, y_degrees, z_degrees])
    rx = np.array([[1, 0, 0], [0, np.cos(x), -np.sin(x)], [0, np.sin(x), np.cos(x)]])
    ry = np.array([[np.cos(y), 0, np.sin(y)], [0, 1, 0], [-np.sin(y), 0, np.cos(y)]])
    rz = np.array([[np.cos(z), -np.sin(z), 0], [np.sin(z), np.cos(z), 0], [0, 0, 1]])
    return rx @ ry @ rz


def seam_features_for_convention(intrinsic_xyz_features: np.ndarray, base_x: np.ndarray, order: str, intrinsic: bool):
    original = intrinsic_xyz_features[:, :9].reshape(-1, 3, 3)
    y = np.arcsin(np.clip(original[:, 0, 2], -1, 1))
    x = np.arctan2(-original[:, 1, 2], original[:, 2, 2])
    z = np.arctan2(-original[:, 0, 1], original[:, 0, 0])
    angles = {"X": x, "Y": y, "Z": z}
    count = len(base_x)
    identity = np.broadcast_to(np.eye(3), (count, 3, 3)).copy()
    rotations = {}
    for axis, values in angles.items():
        cosine, sine = np.cos(values), np.sin(values)
        matrix = identity.copy()
        if axis == "X":
            matrix[:, 1, 1], matrix[:, 1, 2], matrix[:, 2, 1], matrix[:, 2, 2] = cosine, -sine, sine, cosine
        elif axis == "Y":
            matrix[:, 0, 0], matrix[:, 0, 2], matrix[:, 2, 0], matrix[:, 2, 2] = cosine, sine, -sine, cosine
        else:
            matrix[:, 0, 0], matrix[:, 0, 1], matrix[:, 1, 0], matrix[:, 1, 1] = cosine, -sine, sine, cosine
        rotations[axis] = matrix
    result = identity
    for axis in order:
        result = np.matmul(result, rotations[axis]) if intrinsic else np.matmul(rotations[axis], result)
    axis = base_x[:, 7:10]
    spin_in_ball = np.einsum("nji,nj->ni", result, axis)
    return np.column_stack([
        result.reshape(-1, 9), spin_in_ball,
        spin_in_ball * (base_x[:, 0:1] / 90),
        spin_in_ball * (base_x[:, 2:3] / 2200),
    ])


def row_features(row: dict[str, str]) -> tuple[list[float], list[float], list[float]] | None:
    values = {name: numeric(row, name) for name in REQUIRED if name not in {"PitchUID", "Pitcher", "SpinAxis3dTilt"}}
    if any(value is None for value in values.values()):
        return None
    magnus = magnus_movement(row)
    if magnus is None:
        return None
    value = {key: float(item) for key, item in values.items() if item is not None}
    axis = np.array([value["SpinAxis3dVectorX"], value["SpinAxis3dVectorY"], value["SpinAxis3dVectorZ"]])
    magnitude = np.linalg.norm(axis)
    if magnitude <= 1e-9:
        return None
    axis /= magnitude
    efficiency = value["SpinAxis3dSpinEfficiency"]
    if efficiency > 1.25:
        efficiency /= 100
    if not 0 <= efficiency <= 1.05:
        return None
    rotation = intrinsic_xyz_matrix(
        value["SpinAxis3dSeamOrientationRotationX"],
        value["SpinAxis3dSeamOrientationRotationY"],
        value["SpinAxis3dSeamOrientationRotationZ"],
    )
    spin_in_ball = rotation.T @ axis
    velocity_scaled = value["RelSpeed"] / 90
    active_spin_scaled = value["SpinAxis3dActiveSpinRate"] / 2200
    base = [
        value["RelSpeed"], value["SpinRate"], value["SpinAxis3dActiveSpinRate"], efficiency,
        value["Extension"], value["RelHeight"], value["RelSide"], *axis.tolist(),
    ]
    seam = [
        *rotation.reshape(-1).tolist(), *spin_in_ball.tolist(),
        *(spin_in_ball * velocity_scaled).tolist(), *(spin_in_ball * active_spin_scaled).tolist(),
    ]
    actual_hb = value["HorzBreak"]
    actual_ivb = value["InducedVertBreak"]
    magnus_hb, magnus_ivb = magnus
    target = [actual_hb - magnus_hb, actual_ivb - magnus_ivb]
    if not np.all(np.isfinite(base + seam + target)):
        return None
    return base, seam, target


def split_bucket(group: str) -> str:
    bucket = int(hashlib.sha256(group.encode("utf-8")).hexdigest()[:8], 16) % 100
    return "train" if bucket < 70 else "validation" if bucket < 85 else "test"


def metrics(actual: np.ndarray, predicted: np.ndarray) -> dict[str, object]:
    error = predicted - actual
    result: dict[str, object] = {}
    labels = ["hb", "ivb"]
    for index, label in enumerate(labels):
        mse = float(np.mean(error[:, index] ** 2))
        denominator = float(np.sum((actual[:, index] - np.mean(actual[:, index])) ** 2))
        result[label] = {
            "mae": float(np.mean(np.abs(error[:, index]))),
            "rmse": math.sqrt(mse),
            "r2": 1 - float(np.sum(error[:, index] ** 2)) / denominator if denominator > 0 else None,
        }
    result["vector_mae"] = float(np.mean(np.linalg.norm(error, axis=1)))
    return result


def fit_ridge(train_x: np.ndarray, train_y: np.ndarray, evaluation_x: np.ndarray, alpha: float):
    mean = train_x.mean(axis=0)
    scale = train_x.std(axis=0)
    scale[scale < 1e-9] = 1
    standardized = (train_x - mean) / scale
    design = np.column_stack([np.ones(len(standardized)), standardized])
    penalty = np.eye(design.shape[1]) * alpha
    penalty[0, 0] = 0
    coefficients = np.linalg.solve(design.T @ design + penalty, design.T @ train_y)
    evaluation = np.column_stack([np.ones(len(evaluation_x)), (evaluation_x - mean) / scale])
    return evaluation @ coefficients, mean, scale, coefficients


def choose_ridge(train_x, train_y, validation_x, validation_y):
    candidates = []
    for alpha in (0.1, 1.0, 10.0, 100.0, 1000.0):
        predicted, mean, scale, coefficients = fit_ridge(train_x, train_y, validation_x, alpha)
        report = metrics(validation_y, predicted)
        candidates.append((report["vector_mae"], alpha, report, mean, scale, coefficients))
    return min(candidates, key=lambda item: item[0]), candidates


def fit_hist_gradient(train_x: np.ndarray, train_y: np.ndarray, evaluation_x: np.ndarray):
    predictions = []
    models = []
    for target_index in range(train_y.shape[1]):
        model = HistGradientBoostingRegressor(
            loss="squared_error",
            learning_rate=0.06,
            max_iter=300,
            max_leaf_nodes=31,
            min_samples_leaf=60,
            l2_regularization=2.0,
            early_stopping=True,
            validation_fraction=0.1,
            n_iter_no_change=20,
            random_state=20260823 + target_index,
        )
        model.fit(train_x, train_y[:, target_index])
        predictions.append(model.predict(evaluation_x))
        models.append(model)
    return np.column_stack(predictions), models


def uncertainty_calibration(validation_y, validation_prediction, test_y, test_prediction):
    validation_error = np.linalg.norm(validation_prediction - validation_y, axis=1)
    test_error = np.linalg.norm(test_prediction - test_y, axis=1)
    quantiles = {}
    coverage = {}
    for level in (0.5, 0.8, 0.9, 0.95):
        threshold = float(np.quantile(validation_error, level, method="higher"))
        label = str(int(level * 100))
        quantiles[label] = threshold
        coverage[label] = float(np.mean(test_error <= threshold))
    return {"validation_vector_error_quantiles_inches": quantiles, "test_coverage": coverage}


def evaluate_nonlinear_split(base_x, full_x, y, split_values):
    split_values = np.asarray(split_values)
    train = split_values == "train"
    validation = split_values == "validation"
    test = split_values == "test"
    if min(train.sum(), validation.sum(), test.sum()) == 0:
        return {"error": "empty grouped partition"}
    base_validation, base_models = fit_hist_gradient(base_x[train], y[train], base_x[validation])
    seam_validation, seam_models = fit_hist_gradient(full_x[train], y[train], full_x[validation])
    base_test = np.column_stack([model.predict(base_x[test]) for model in base_models])
    seam_test = np.column_stack([model.predict(full_x[test]) for model in seam_models])
    return {
        "counts": {"train": int(train.sum()), "validation": int(validation.sum()), "test": int(test.sum())},
        "context_only_test": metrics(y[test], base_test),
        "context_plus_seams_test": metrics(y[test], seam_test),
        "uncertainty": uncertainty_calibration(y[validation], seam_validation, y[test], seam_test),
    }


def serialize_hist_model(model):
    trees = []
    for iteration in model._predictors:
        nodes = iteration[0].nodes
        trees.append([
            {
                "value": float(node["value"]), "feature": int(node["feature_idx"]),
                "threshold": float(node["num_threshold"]), "left": int(node["left"]),
                "right": int(node["right"]), "missing_left": bool(node["missing_go_to_left"]),
                "leaf": bool(node["is_leaf"]),
            }
            for node in nodes
        ])
    return {"baseline": float(model._baseline_prediction.reshape(-1)[0]), "trees": trees}


def candidate_csvs(root: Path):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS]
        for filename in filenames:
            if filename.lower().endswith(".csv"):
                yield Path(dirpath) / filename


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/Users/jaredgaynor/Documents/GitHub"))
    parser.add_argument("--output", type=Path, default=Path("data/models/ssw-ridge-candidate-v1.json"))
    args = parser.parse_args()

    base_rows: list[list[float]] = []
    seam_rows: list[list[float]] = []
    targets: list[list[float]] = []
    splits: list[str] = []
    session_splits: list[str] = []
    facility_splits: list[str] = []
    seen: set[str] = set()
    source_files = 0
    candidate_rows = 0

    for path in candidate_csvs(args.root):
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as handle:
                reader = csv.DictReader(handle)
                if not set(REQUIRED).issubset(set(reader.fieldnames or [])):
                    continue
                source_files += 1
                for row in reader:
                    candidate_rows += 1
                    uid = str(row.get("PitchUID", "")).strip()
                    if not uid or uid in seen:
                        continue
                    features = row_features(row)
                    if features is None:
                        continue
                    seen.add(uid)
                    base, seam, target = features
                    pitcher = str(row.get("PitcherId") or row.get("Pitcher") or uid).strip()
                    base_rows.append(base)
                    seam_rows.append(seam)
                    targets.append(target)
                    splits.append(split_bucket(pitcher))
                    game_uid = str(row.get("GameUID") or "").strip()
                    session_group = game_uid or "|".join([
                        str(row.get("Date") or "").strip(), str(row.get("Stadium") or "").strip(),
                        str(row.get("HomeTeam") or "").strip(), str(row.get("AwayTeam") or "").strip(), path.name,
                    ])
                    facility_group = str(row.get("Stadium") or "").strip() or path.parent.name
                    session_splits.append(split_bucket(session_group))
                    facility_splits.append(split_bucket(facility_group))
        except (OSError, UnicodeError, csv.Error):
            continue

    base_x = np.asarray(base_rows, dtype=np.float64)
    seam_x = np.asarray(seam_rows, dtype=np.float64)
    y = np.asarray(targets, dtype=np.float64)
    split_array = np.asarray(splits)
    train = split_array == "train"
    validation = split_array == "validation"
    test = split_array == "test"
    if min(train.sum(), validation.sum(), test.sum()) == 0:
        raise RuntimeError("Grouped split produced an empty partition")

    convention_results = {}
    winning_convention = ""
    winning_score = float("inf")
    full_x = None
    for intrinsic in (True, False):
        for order in ("XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"):
            name = f"{'intrinsic' if intrinsic else 'extrinsic'}:{order}"
            candidate_seams = seam_features_for_convention(seam_x, base_x, order, intrinsic)
            candidate_full = np.column_stack([base_x, candidate_seams])
            best, _ = choose_ridge(candidate_full[train], y[train], candidate_full[validation], y[validation])
            convention_results[name] = {"alpha": best[1], "validation": best[2]}
            score = float(best[2]["vector_mae"])
            if score < winning_score:
                winning_convention, winning_score, full_x = name, score, candidate_full
    if full_x is None:
        raise RuntimeError("No rotation convention could be evaluated")

    zero_test = metrics(y[test], np.zeros_like(y[test]))
    (base_best, base_candidates) = choose_ridge(base_x[train], y[train], base_x[validation], y[validation])
    (full_best, full_candidates) = choose_ridge(full_x[train], y[train], full_x[validation], y[validation])
    _, base_alpha, _, _, _, _ = base_best
    _, full_alpha, _, _, _, _ = full_best
    base_prediction, _, _, _ = fit_ridge(base_x[train], y[train], base_x[test], base_alpha)
    full_prediction, _, _, _ = fit_ridge(full_x[train], y[train], full_x[test], full_alpha)

    nonlinear_base_validation, nonlinear_base_models = fit_hist_gradient(base_x[train], y[train], base_x[validation])
    nonlinear_full_validation, nonlinear_full_models = fit_hist_gradient(full_x[train], y[train], full_x[validation])
    nonlinear_base_test = np.column_stack([model.predict(base_x[test]) for model in nonlinear_base_models])
    nonlinear_full_test = np.column_stack([model.predict(full_x[test]) for model in nonlinear_full_models])
    session_holdout = evaluate_nonlinear_split(base_x, full_x, y, session_splits)
    facility_holdout = evaluate_nonlinear_split(base_x, full_x, y, facility_splits)

    _, production_context_models = fit_hist_gradient(base_x, y, base_x[:1])
    _, production_models = fit_hist_gradient(full_x, y, full_x[:1])

    all_prediction, all_mean, all_scale, all_coefficients = fit_ridge(full_x, y, full_x[:1], full_alpha)
    del all_prediction
    report = {
        "model_version": "ssw-ridge-candidate-v1",
        "warning": "Predicts measured-minus-Magnus residual; independent data are required before interpreting the full residual as pure SSW.",
        "coordinate_convention": winning_convention,
        "source_root": str(args.root),
        "source_files": source_files,
        "candidate_rows": candidate_rows,
        "unique_complete_pitches": len(y),
        "split_strategy": "deterministic 70/15/15 holdout by PitcherId, falling back to Pitcher",
        "split_counts": {"train": int(train.sum()), "validation": int(validation.sum()), "test": int(test.sum())},
        "targets": ["hb_residual_inches", "ivb_residual_inches"],
        "validation": {
            "magnus_only_zero_residual_test": zero_test,
            "context_only_test": metrics(y[test], base_prediction),
            "context_plus_seams_test": metrics(y[test], full_prediction),
            "context_alpha": base_alpha,
            "context_plus_seams_alpha": full_alpha,
            "nonlinear_context_only_validation": metrics(y[validation], nonlinear_base_validation),
            "nonlinear_context_plus_seams_validation": metrics(y[validation], nonlinear_full_validation),
            "nonlinear_context_only_test": metrics(y[test], nonlinear_base_test),
            "nonlinear_context_plus_seams_test": metrics(y[test], nonlinear_full_test),
            "nonlinear_iterations": {
                "context_hb": int(nonlinear_base_models[0].n_iter_),
                "context_ivb": int(nonlinear_base_models[1].n_iter_),
                "seams_hb": int(nonlinear_full_models[0].n_iter_),
                "seams_ivb": int(nonlinear_full_models[1].n_iter_),
            },
            "nonlinear_uncertainty": uncertainty_calibration(
                y[validation], nonlinear_full_validation, y[test], nonlinear_full_test
            ),
            "rotation_conventions": convention_results,
            "session_holdout": session_holdout,
            "facility_holdout": facility_holdout,
            "context_validation_candidates": {str(item[1]): item[2] for item in base_candidates},
            "seam_validation_candidates": {str(item[1]): item[2] for item in full_candidates},
        },
        "features": BASE_FEATURES + SEAM_FEATURES,
        "normalization_mean": all_mean.tolist(),
        "normalization_scale": all_scale.tolist(),
        "coefficients": all_coefficients.tolist(),
        "nonlinear_model": {
            "outputs": ["hb_residual_inches", "ivb_residual_inches"],
            "context_hb": serialize_hist_model(production_context_models[0]),
            "context_ivb": serialize_hist_model(production_context_models[1]),
            "hb": serialize_hist_model(production_models[0]),
            "ivb": serialize_hist_model(production_models[1]),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key not in {"normalization_mean", "normalization_scale", "coefficients", "nonlinear_model"}}, indent=2))
    print(f"Wrote candidate artifact to {args.output}")


if __name__ == "__main__":
    main()
