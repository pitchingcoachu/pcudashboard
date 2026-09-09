# Edgertronic seam-orientation pipeline

## Current status

`scripts/edger_spin_cv.py` is an offline feasibility and fitting worker. It:

1. decodes every exported frame with FFmpeg;
2. tracks the released baseball using brightness and temporal foreground masks;
3. normalizes the moving ball to a fixed crop;
4. isolates thin, dark seam evidence after removing the broad lighting gradient;
5. fits the dashboard's 3D baseball seam curve through the full frame sequence;
6. reports the initial seam pose and rotation axis in **Edger camera coordinates**;
7. writes seam-detection and 3D-reprojection overlays for review.

`scripts/import-edger-spin-estimate.mjs` applies the quality gate and persists
accepted estimates with source URL, model version, diagnostics, and confidence.
The dashboard labels them `Video-derived`. Edger image coordinates are converted
to the dashboard scene with the proper orthonormal basis
`camera (X, Y, Z) -> scene (-X, Z, Y)`. This preserves the pitcher-view camera
reference while giving the renderer a right-handed 3D frame.

## Local use

Requirements:

- `ffmpeg` and `ffprobe` on `PATH`
- Python packages in `scripts/requirements-edger-spin.txt`

Example:

```bash
python3 scripts/edger_spin_cv.py input.mov \
  --output /tmp/edger-spin-example \
  --fit \
  --spin-rate-rpm 1710.7 \
  --capture-fps 1000 \
  --axis-tilt-degrees 203.2 \
  --spin-efficiency 0.91 \
  --include-track
```

The output folder contains:

- `report.json`
- `seam-diagnostics.jpg` (detected seam evidence in red)
- `seam-fit-overlay.jpg` (detected evidence in red, projected 3D seam in green)

`scripts/edger_camera_calibration.py` consumes reports generated with
`--include-track` plus the linked TrackMan trajectory coefficients. It fits a
shared physical camera and per-pitch release-time offsets, then reports pixel
reprojection error. A calibration marked `review_required` must not be used by
the dashboard.

## PCU feasibility result (August 25, 2026)

- 41,933 distinct PCU Edger plays were found.
- 40,669 link to `pitch_events`.
- 38,329 have measured spin rate.
- 28,190 have measured spin efficiency.
- 2,253 have spin rate, release tilt, and spin efficiency.
- PCU has 56 raw TrackMan rows with seam-orientation XYZ, but none overlap an
  Edger play. PCU therefore cannot directly measure the worker's absolute
  pitcher-frame angular error yet.

The first representative fastball tracked 71 released-ball frames. Its fitted
phase was 10.364 degrees per captured frame. At the measured 1,710.743 rpm,
that implies 990.4 captured frames/second, within 1% of the expected 1,000 fps
Edger setting. A changeup and slider also reproduced their measured rpm within
1.7% when the session's 1,000 fps capture rate was used as a constraint.

An initial four-pitch camera calibration was intentionally rejected by the
quality gate (5.02 px median and 11.47 px 90th-percentile reprojection error).
That small sample is useful for diagnosing the pipeline, but is not sufficient
to establish a stable pitcher-frame transform. The next calibration run should
use several pitchers and release points from one unchanged camera session,
include radial lens distortion, and be evaluated on pitches withheld from the
camera fit.

## Pilot behavior and quality gate

The current PCU pilot uses the Edger camera view as its pitcher-view reference.
Version 5 estimates use brightness motion as one axis candidate, fuse seam
evidence on a sphere, and compare that result with a full continuous temporal
search. They do not classify a pitch as four-seam or two-seam; the stored cover
pose and angular-velocity axis remain continuous.
TrackMan break tilt is never substituted for release tilt, and TrackMan spin
efficiency does not constrain the video solution. Measured IVB/HB is used only
as a hemisphere sanity check so a visually ambiguous solution cannot promote an
obvious topspin fastball. The dashboard labels video-inferred release tilt and
efficiency as `vTilt` and `vEff`.

Only estimates that pass all of these gates should be promoted:

- at least 12 usable seam frames;
- adequate ball size and sharpness;
- stable temporal fit on at least 8 held-out frames;
- at least 60% median support for the projected seam and 40% median support for
  detected seam pixels, with both thresholds met on at least half of held-out
  frames;
- brightness-motion support and directional spread are retained as diagnostics,
  while the full seam sequence can supersede an unreliable flow estimate;
- agreement between the inferred Magnus hemisphere and measured movement;
- fit cost at or below 5.5 and held-out cost at or below 6.5;
- rotation rate within 3% of measured RPM using the original 1,000 fps Edger
  capture rate (the Cloudinary file is a 30 fps playback export of sequential
  high-speed frames);
- explicit `video_estimated` source and confidence label in the UI.
- explicit human confirmation that the complete rotating seam pattern—not just
  individual projected arcs—matches the source Edger clip. Automated imports
  remain disabled without `--reviewed-seam-orientation true` because baseball
  cover symmetries can otherwise produce a convincing but globally wrong pose.

The confidence score measures seam visibility and reprojection fit. It is not a
ground-truth angular-accuracy percentage. A future physical camera calibration
against held-out pitches would still improve absolute pitcher-frame accuracy.

Passing v5 fits are stored with `testing` status. Local and preview testing only
include v5 review rows; the older permissive v4 testing fits are hidden.
Production only includes estimates explicitly promoted to `accepted` after
comparison with the Edger source.

TrackMan-measured seam XYZ must continue to take precedence over video-derived
estimates.
