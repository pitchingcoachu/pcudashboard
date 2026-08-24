#!/usr/bin/env python3
"""Audit whether seam inputs rank movement differences on matched pitches.

This is deliberately a go/no-go validation tool, not a production trainer. It
matches pitches within pitcher/session under tight non-seam tolerances, holds
out entire pitchers, and tests whether changing the seam representation ranks
the observed HB/IVB residual differences in the correct direction.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from sklearn.ensemble import HistGradientBoostingRegressor

from train_ssw_ridge_model import (
    REQUIRED,
    candidate_csvs,
    row_features,
    seam_features_for_convention,
    split_bucket,
)


@dataclass
class Record:
    uid: str
    pitcher: str
    session: str
    split: str
    base: list[float]
    seam_xyz: list[float]
    target: list[float]


LIMITS = np.array([1.0, 100.0, 100.0, 0.03, 0.30, 0.20, 0.20], dtype=np.float64)


def rotation_distance_degrees(left: np.ndarray, right: np.ndarray) -> float:
    relative = left.T @ right
    cosine = np.clip((np.trace(relative) - 1) / 2, -1, 1)
    return float(np.degrees(np.arccos(cosine)))


def context_match(left: Record, right: Record) -> tuple[bool, float]:
    a = np.asarray(left.base, dtype=np.float64)
    b = np.asarray(right.base, dtype=np.float64)
    delta = np.abs(a[:7] - b[:7])
    if np.any(delta > LIMITS):
        return False, math.inf
    axis_cosine = float(np.clip(np.dot(a[7:10], b[7:10]), -1, 1))
    axis_angle = math.degrees(math.acos(axis_cosine))
    if axis_angle > 3.0:
        return False, math.inf
    normalized = delta / LIMITS
    score = float(np.sqrt(np.mean(normalized**2) + (axis_angle / 3.0) ** 2))
    return True, score


def make_pairs(records: list[Record], max_partners: int = 2):
    groups: dict[tuple[str, str], list[int]] = defaultdict(list)
    for index, record in enumerate(records):
        groups[(record.pitcher, record.session)].append(index)

    pairs: list[tuple[int, int]] = []
    seen: set[tuple[str, str]] = set()
    for indexes in groups.values():
        indexes.sort(key=lambda index: records[index].base[0])
        for position, left_index in enumerate(indexes):
            left = records[left_index]
            candidates: list[tuple[float, int]] = []
            for right_index in indexes[position + 1:]:
                right = records[right_index]
                if right.base[0] - left.base[0] > LIMITS[0]:
                    break
                matched, score = context_match(left, right)
                if not matched:
                    continue
                left_rotation = np.asarray(left.seam_xyz[:9]).reshape(3, 3)
                right_rotation = np.asarray(right.seam_xyz[:9]).reshape(3, 3)
                if rotation_distance_degrees(left_rotation, right_rotation) < 15.0:
                    continue
                candidates.append((score, right_index))
            for _, right_index in sorted(candidates)[:max_partners]:
                key = tuple(sorted((left.uid, records[right_index].uid)))
                if key not in seen:
                    seen.add(key)
                    pairs.append((left_index, right_index))
    return pairs


def fit_models(train_x: np.ndarray, train_y: np.ndarray):
    models = []
    for target_index in range(2):
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
            random_state=20260824 + target_index,
        )
        model.fit(train_x, train_y[:, target_index])
        models.append(model)
    return models


def predict(models, features: np.ndarray) -> np.ndarray:
    return np.column_stack([model.predict(features) for model in models])


def pair_differences(
    pairs: list[tuple[int, int]],
    base_x: np.ndarray,
    seam_x: np.ndarray,
    targets: np.ndarray,
    models,
):
    left = np.asarray([pair[0] for pair in pairs], dtype=np.int64)
    right = np.asarray([pair[1] for pair in pairs], dtype=np.int64)
    truth = targets[right] - targets[left]

    needed = np.unique(np.concatenate([left, right]))
    record_predictions = predict(models, np.column_stack([base_x[needed], seam_x[needed]]))
    lookup = np.full(len(base_x), -1, dtype=np.int64)
    lookup[needed] = np.arange(len(needed))
    own_context = record_predictions[lookup[right]] - record_predictions[lookup[left]]

    fixed_chunks = []
    for start in range(0, len(pairs), 20_000):
        stop = min(start + 20_000, len(pairs))
        chunk_left, chunk_right = left[start:stop], right[start:stop]
        midpoint = (base_x[chunk_left] + base_x[chunk_right]) / 2
        counterfactual_left = np.column_stack([midpoint, seam_x[chunk_left]])
        counterfactual_right = np.column_stack([midpoint, seam_x[chunk_right]])
        fixed_chunks.append(
            predict(models, counterfactual_right) - predict(models, counterfactual_left)
        )
    fixed_context = np.vstack(fixed_chunks)
    return truth, own_context, fixed_context


def ranking_report(truth: np.ndarray, prediction: np.ndarray):
    report: dict[str, object] = {
        "pairs": int(len(truth)),
        "vector_delta_mae": float(np.mean(np.linalg.norm(prediction - truth, axis=1))),
    }
    for index, label in enumerate(("hb", "ivb")):
        component = {}
        for threshold in (1.0, 2.0, 3.0, 5.0):
            eligible = np.abs(truth[:, index]) >= threshold
            count = int(eligible.sum())
            component[f"at_least_{int(threshold)}in"] = {
                "count": count,
                "coverage": float(count / len(truth)) if len(truth) else 0.0,
                "direction_accuracy": (
                    float(np.mean(np.sign(prediction[eligible, index]) == np.sign(truth[eligible, index])))
                    if count else None
                ),
                "predicted_delta_mae": (
                    float(np.mean(np.abs(prediction[eligible, index] - truth[eligible, index])))
                    if count else None
                ),
            }
        report[label] = component
    for margin in (0.5, 1.0, 2.0, 3.0):
        confident = np.max(np.abs(prediction), axis=1) >= margin
        if not confident.any():
            continue
        component_correct = np.sign(prediction[confident]) == np.sign(truth[confident])
        report[f"confidence_margin_{margin:g}in"] = {
            "pairs": int(confident.sum()),
            "coverage": float(confident.mean()),
            "component_direction_accuracy": float(component_correct.mean()),
        }
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path("/Users/jaredgaynor/Documents/GitHub"))
    parser.add_argument("--output", type=Path, default=Path("data/models/ssw-pairwise-audit-v1.json"))
    args = parser.parse_args()

    records: list[Record] = []
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
                if source_files % 500 == 0:
                    print(
                        f"Scanned {source_files} seam-data files; retained {len(records):,} unique complete pitches",
                        file=sys.stderr,
                        flush=True,
                    )
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
                    game_uid = str(row.get("GameUID") or "").strip()
                    session = game_uid or "|".join([
                        str(row.get("Date") or "").strip(),
                        str(row.get("Stadium") or "").strip(),
                        str(row.get("HomeTeam") or "").strip(),
                        str(row.get("AwayTeam") or "").strip(),
                        path.name,
                    ])
                    records.append(Record(uid, pitcher, session, split_bucket(pitcher), base, seam, target))
        except (OSError, UnicodeError, csv.Error):
            continue

    if not records:
        raise RuntimeError("No complete seam-orientation records found")
    base_x = np.asarray([record.base for record in records], dtype=np.float64)
    seam_xyz = np.asarray([record.seam_xyz for record in records], dtype=np.float64)
    seam_x = seam_features_for_convention(seam_xyz, base_x, "ZXY", True)
    targets = np.asarray([record.target for record in records], dtype=np.float64)
    splits = np.asarray([record.split for record in records])

    train = splits == "train"
    print(f"Fitting held-out model on {int(train.sum()):,} training pitches", file=sys.stderr, flush=True)
    full_models = fit_models(np.column_stack([base_x[train], seam_x[train]]), targets[train])
    print("Held-out model fit complete", file=sys.stderr, flush=True)
    reports = {}
    pair_counts = {}
    for split in ("validation", "test"):
        indexes = np.flatnonzero(splits == split)
        subset = [records[index] for index in indexes]
        local_pairs = make_pairs(subset)
        global_pairs = [(int(indexes[left]), int(indexes[right])) for left, right in local_pairs]
        pair_counts[split] = len(global_pairs)
        print(f"Evaluating {len(global_pairs):,} {split} matched pairs", file=sys.stderr, flush=True)
        truth, own_context, fixed_context = pair_differences(
            global_pairs, base_x, seam_x, targets, full_models
        )
        reports[split] = {
            "own_context_prediction": ranking_report(truth, own_context),
            "seam_only_fixed_midpoint_context": ranking_report(truth, fixed_context),
        }

    result = {
        "audit_version": "ssw-pairwise-audit-v1",
        "coordinate_convention": "intrinsic:ZXY",
        "warning": "Matched observational pitches reduce confounding but do not prove a causal seam effect.",
        "source_files": source_files,
        "candidate_rows": candidate_rows,
        "unique_complete_pitches": len(records),
        "split_counts": {name: int(np.sum(splits == name)) for name in ("train", "validation", "test")},
        "matching": {
            "same_pitcher_and_session": True,
            "velocity_mph": 1.0,
            "spin_rate_rpm": 100.0,
            "active_spin_rpm": 100.0,
            "spin_efficiency": 0.03,
            "extension_ft": 0.30,
            "release_height_ft": 0.20,
            "release_side_ft": 0.20,
            "spin_axis_degrees": 3.0,
            "minimum_seam_rotation_difference_degrees": 15.0,
            "maximum_partners_per_pitch": 2,
        },
        "pair_counts": pair_counts,
        "results": reports,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
