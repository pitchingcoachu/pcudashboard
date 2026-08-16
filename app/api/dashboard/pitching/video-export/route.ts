import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import { getSessionFromRequest } from '../../../../../lib/auth';
import { isDatabaseConfigured } from '../../../../../lib/auth-db';
import { resolveDashboardSchoolCode } from '../../../../../lib/dashboard-access';
import {
  lookupPitchExportMetrics,
  lookupPitchVideoUrls,
  type PitchExportMetrics,
  type PitchVideoUrls,
} from '../../../../../lib/pitching-video-lookup';
import {
  renderPitchExportOverlayPng,
  renderPitchExportOverlayHorizontalPng,
  PITCH_EXPORT_PANEL_WIDTH,
} from '../../../../../lib/pitch-export-overlay';

// Multi-clip download + ffmpeg re-encode/concat is a media-processing job,
// not a normal API request. A 25-pitch, 2-camera combined export performs
// work on roughly 50 source videos and previously hit the old 300-second
// ceiling exactly. This project runs on Vercel Pro + Fluid Compute, whose
// Node runtime supports the 30-minute media-processing duration.
export const maxDuration = 1800;

const MAX_PITCHES_PER_EXPORT = 50;
const CAMERA_KEYS = ['video_clip_1', 'video_clip_2', 'video_clip_3'] as const;
type CameraKey = (typeof CAMERA_KEYS)[number];
const EDGER_KEY_BY_CAMERA_KEY: Record<CameraKey, keyof PitchVideoUrls> = {
  video_clip_1: 'video_clip_1_is_edger',
  video_clip_2: 'video_clip_2_is_edger',
  video_clip_3: 'video_clip_3_is_edger',
};

// "edger" isn't a fixed slot -- which camera number is Edgertronic footage
// varies pitch to pitch (almost always slot 1, but not guaranteed), so it's
// resolved per pitch at export time rather than mapped to one CameraKey up
// front like '1'/'2'/'3' are.
const CAMERA_KEY_BY_NUMBER: Record<string, CameraKey> = {
  '1': 'video_clip_1',
  '2': 'video_clip_2',
  '3': 'video_clip_3',
};

type CameraSelection = CameraKey | 'edger';

/** Maps independent work with a small concurrency cap. Video exports are a
 * mix of remote downloads and ffmpeg work; two workers overlap network waits
 * without allowing a large export to launch dozens of ffmpeg processes and
 * exhaust the function's memory/file-descriptor budget. Results retain input
 * order so the final video still follows the modal's pitch order. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let hasError = false;
  let firstError: unknown;

  const worker = async () => {
    while (!hasError) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await mapper(items[index], index);
      } catch (error) {
        hasError = true;
        firstError = error;
      }
    }
  };

  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (hasError) throw firstError;
  return results;
}

// Accepts either the legacy single-value shape ("1" | "2" | "3" | "all") or
// an array of camera selectors (["1","3"] or ["edger"]) for a custom
// multi-camera subset. Falls back to every camera when nothing valid was
// sent, matching the old "all" default.
function parseCameraSelection(value: unknown): CameraSelection[] {
  const values = Array.isArray(value) ? value : [value];
  const keys = values
    .map((v) => String(v ?? '').trim())
    .flatMap((v): CameraSelection[] => {
      if (v === 'all') return Object.values(CAMERA_KEY_BY_NUMBER);
      if (v === 'edger') return ['edger'];
      const key = CAMERA_KEY_BY_NUMBER[v];
      return key ? [key] : [];
    });
  const deduped = Array.from(new Set(keys));
  return deduped.length ? deduped : [...CAMERA_KEYS];
}

/** Resolves the actual clip URL for one pitch given a camera selection --
 * for 'edger', picks whichever slot is confirmed Edgertronic for THIS
 * specific pitch (never falls back to a non-Edger slot); for a fixed slot,
 * just reads that slot directly. */
function resolveClipUrl(pitch: PitchVideoUrls, selection: CameraSelection): string {
  if (selection === 'edger') {
    const edgerKey = CAMERA_KEYS.find((key) => pitch[EDGER_KEY_BY_CAMERA_KEY[key]]);
    return edgerKey ? String(pitch[edgerKey] ?? '').trim() : '';
  }
  return String(pitch[selection] ?? '').trim();
}

/** Whether the clip resolved by resolveClipUrl for this (pitch, selection)
 * pair is actually Edgertronic footage. A fixed slot ('1'/'2'/'3') isn't
 * consistently Edger or non-Edger across pitches -- which slot number holds
 * the Edger clip varies per pitch -- so this must be checked per pitch, not
 * assumed from the selection alone. Drives export trim direction (see
 * exportTrimArgs). */
function resolveClipIsEdger(pitch: PitchVideoUrls, selection: CameraSelection): boolean {
  if (selection === 'edger') return true;
  return Boolean(pitch[EDGER_KEY_BY_CAMERA_KEY[selection]]);
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath.path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      // ffmpeg's stderr can grow unbounded for long jobs; only the tail is
      // useful for diagnosing a failure, so cap what's retained.
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/** Runs ffmpeg and returns its stderr output, regardless of exit code -- used
 * for probing (e.g. duration via `-f null -`) where a non-zero/odd exit from
 * a null-muxer probe isn't itself a real failure, only a missing duration
 * line in the output would be. */
function runFfmpegCapture(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath.path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', () => resolve(stderr));
    child.on('close', () => resolve(stderr));
  });
}

/** Downloads a clip to a local temp path without any re-encoding -- shared by
 * both the normalize-and-concat path and the probe-duration path so a clip
 * is only fetched from Cloudinary once per use site. */
async function downloadClip(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download clip: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(destPath, buffer);
}

/** Probes a local file's duration in seconds via ffmpeg's own stderr report
 * (no ffprobe binary is installed in this project, and adding one just for
 * this is unnecessary -- ffmpeg -i already prints "Duration: HH:MM:SS.ss"
 * for any input). Returns null if the duration couldn't be parsed. */
async function probeDurationSeconds(filePath: string): Promise<number | null> {
  const stderr = await runFfmpegCapture(['-i', filePath, '-f', 'null', '-']);
  const match = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const [, hh, mm, ss] = match;
  const seconds = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// Export-only clip length rule (never applied to the live modal, which
// always plays clips at their real length): every exported clip is capped
// at this length. Shorter clips are left untouched -- this only trims
// clips that run long. Edgertronic clips are trimmed off the END (keep the
// beginning, since Edger capture starts at the pitch release/pitch-of-
// -interest moment); non-Edger (iPhone) clips are trimmed off the START
// (keep the end, since iPhone recordings run continuously and the pitch
// itself is usually right before the clip ends).
const EXPORT_CLIP_SECONDS = 2.5;

/** Given a clip's real duration, returns the ffmpeg trim args needed to cap
 * it at EXPORT_CLIP_SECONDS, or an empty array if it's already short enough
 * to leave untouched. */
function exportTrimArgs(durationSeconds: number | null, isEdger: boolean): string[] {
  if (!durationSeconds || durationSeconds <= EXPORT_CLIP_SECONDS) return [];
  if (isEdger) {
    // Keep [0, EXPORT_CLIP_SECONDS] -- trim off the back end.
    return ['-t', String(EXPORT_CLIP_SECONDS)];
  }
  // Keep the last EXPORT_CLIP_SECONDS -- trim off the front.
  const start = Math.max(0, durationSeconds - EXPORT_CLIP_SECONDS);
  return ['-ss', String(start), '-t', String(EXPORT_CLIP_SECONDS)];
}

/** Downloads one clip, trims it per exportTrimArgs if it runs longer than
 * EXPORT_CLIP_SECONDS, and re-encodes it to a shared landscape canvas
 * (letterboxed, matching whatever the largest source clip's dimensions are)
 * so clips with different resolutions/orientations -- confirmed to happen
 * across camera angles -- can be concatenated cleanly afterward. */
async function normalizeClip(
  url: string,
  outputPath: string,
  canvasWidth: number,
  canvasHeight: number,
  isEdger: boolean
): Promise<void> {
  const inputPath = `${outputPath}.src`;
  await downloadClip(url, inputPath);
  const duration = await probeDurationSeconds(inputPath);
  const trim = exportTrimArgs(duration, isEdger);
  // -ss before -i for fast input-side seeking (fine at this clip length --
  // we're trimming a couple seconds off a ~5-10s source, not doing precise
  // frame-level edits).
  const seekArgs = trim[0] === '-ss' ? ['-ss', trim[1]] : [];
  const durationArgs = trim[0] === '-ss' ? [trim[2], trim[3]] : trim;
  await runFfmpeg([
    '-y',
    ...seekArgs,
    '-i', inputPath,
    ...durationArgs,
    '-vf', `scale=${canvasWidth}:${canvasHeight}:force_original_aspect_ratio=decrease,pad=${canvasWidth}:${canvasHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-an',
    outputPath,
  ]);
  await rm(inputPath, { force: true });
}

async function probeDimensions(url: string): Promise<{ width: number; height: number } | null> {
  // Cloudinary exposes basic media info via a HEAD request's Server-Timing
  // header (confirmed format: content-info;desc="width=...,height=...,...")
  // -- cheaper than downloading the whole file just to learn its size.
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const timing = response.headers.get('server-timing') ?? '';
    const widthMatch = timing.match(/width=(\d+)/);
    const heightMatch = timing.match(/height=(\d+)/);
    if (widthMatch && heightMatch) {
      return { width: Number(widthMatch[1]), height: Number(heightMatch[1]) };
    }
  } catch {
    // Fall through to null -- caller uses a sane default.
  }
  return null;
}

async function concatCameraGroup(
  workDir: string,
  groupName: string,
  clips: Array<{ url: string; isEdger: boolean; metrics?: PitchExportMetrics }>,
  canvasWidth: number,
  canvasHeight: number
): Promise<string | null> {
  if (!clips.length) return null;

  const normalizedPaths: string[] = [];
  for (let i = 0; i < clips.length; i += 1) {
    const outPath = path.join(workDir, `${groupName}-${i}.mp4`);
    await normalizeClip(clips[i].url, outPath, canvasWidth, canvasHeight, clips[i].isEdger);
    const withPanel = clips[i].metrics
      ? await addMetricsPanel(workDir, `${groupName}-${i}-panel`, outPath, canvasHeight, clips[i].metrics!)
      : outPath;
    normalizedPaths.push(withPanel);
  }

  if (normalizedPaths.length === 1) return normalizedPaths[0];

  const listPath = path.join(workDir, `${groupName}-list.txt`);
  const listContents = normalizedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listPath, listContents);

  const combinedPath = path.join(workDir, `${groupName}-combined.mp4`);
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', combinedPath]);
  return combinedPath;
}

/** One (row, column-span) tile position in the composite grid, expressed as
 * fractions of the full canvas so the same layout works at any tile size. */
type TileSlot = { xFrac: number; yFrac: number; wFrac: number; hFrac: number };

/** Fixed layouts for the "Combined" export mode, sized to however many real
 * clips THIS pitch actually has among the selected cameras (not how many
 * cameras were selected overall) -- a pitch missing one of the selected
 * cameras gets its remaining tile(s) resized to fill the space instead of
 * leaving a blank placeholder, per explicit request. 1 clip fills the whole
 * canvas (matches the single-video view in the live modal); 2 go side by
 * side (see leftWFrac below) UNLESS stacked is true (both clips landscape --
 * side by side would squeeze both down to portrait-shaped slots, so they
 * stack vertically full-width instead, per explicit request); 3 puts the
 * first tile (Edger, when present) on top spanning the full width with the
 * other two split evenly below it. */
function buildTileLayout(count: number, leftWFrac = 0.5, stacked = false): TileSlot[] {
  if (count <= 1) return count === 1 ? [{ xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 1 }] : [];
  if (count === 2) {
    if (stacked) {
      return [
        { xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 0.5 },
        { xFrac: 0, yFrac: 0.5, wFrac: 1, hFrac: 0.5 },
      ];
    }
    const left = Math.min(0.9, Math.max(0.1, leftWFrac));
    return [
      { xFrac: 0, yFrac: 0, wFrac: left, hFrac: 1 },
      { xFrac: left, yFrac: 0, wFrac: 1 - left, hFrac: 1 },
    ];
  }
  return [
    { xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 0.5 },
    { xFrac: 0, yFrac: 0.5, wFrac: 0.5, hFrac: 0.5 },
    { xFrac: 0.5, yFrac: 0.5, wFrac: 0.5, hFrac: 0.5 },
  ];
}

/** For a pitch's 2-tile composite, how wide the LEFT tile should be as a
 * fraction of the combined tile-pair width (not the full canvas -- the pair
 * may itself be narrower than canvasWidth when there's a 3rd/metrics-panel
 * tile involved elsewhere), based on each clip's own aspect ratio at a
 * shared tile height -- e.g. landscape (16:9) paired with portrait (9:16) at
 * the same height naturally wants roughly 2.7x the portrait tile's width.
 * Falls back to an even 0.5/0.5 split whenever a clip's real dimensions
 * aren't known (probe failure) -- never crash or degenerate the layout over
 * a missing HEAD-request field. */
function computeTwoTileWidthFrac(
  leftDims: { width: number; height: number } | null,
  rightDims: { width: number; height: number } | null
): number {
  if (!leftDims || !rightDims || leftDims.height <= 0 || rightDims.height <= 0) return 0.5;
  const leftRatio = leftDims.width / leftDims.height;
  const rightRatio = rightDims.width / rightDims.height;
  const total = leftRatio + rightRatio;
  if (!Number.isFinite(total) || total <= 0) return 0.5;
  return leftRatio / total;
}

/** One real clip resolved for a single pitch's Combined-mode composite,
 * already in final display order (see resolvePitchCombinedClips). */
type ResolvedPitchClip = { url: string; isEdger: boolean };

/** Resolves, for ONE pitch, the ordered list of real clips to composite --
 * dropping any selected camera this pitch has no footage for entirely
 * (buildTileLayout then sizes tiles to however many clips are actually left,
 * instead of rendering a blank gray placeholder in the gap). Order is fixed
 * regardless of which numbered slot (video_clip_1/2/3) each clip happens to
 * live in for this particular pitch:
 *   1. Edger (if selected and present)
 *   2. Back view (camera_target = "PitchersBack")
 *   3. Side view (camera_target = "PitchersOpenSide"/"PitchersFront")
 * iPhone clips whose camera_target is blank for this pitch (a real gap in
 * the source data, not a bug -- confirmed common) fall back to plain slot
 * order (video_clip_2 before video_clip_3) after the ones with a known view,
 * so ordering is still deterministic even without camera_target. */
function resolvePitchCombinedClips(pitch: PitchVideoUrls, selections: CameraSelection[]): ResolvedPitchClip[] {
  const selected = new Set(selections);
  const edger: ResolvedPitchClip[] = [];
  const back: ResolvedPitchClip[] = [];
  const side: ResolvedPitchClip[] = [];
  const unknown: ResolvedPitchClip[] = [];

  for (const key of CAMERA_KEYS) {
    const isEdgerClip = Boolean(pitch[EDGER_KEY_BY_CAMERA_KEY[key]]);
    const wantedBySlot = selected.has(key);
    const wantedAsEdger = isEdgerClip && selected.has('edger');
    if (!wantedBySlot && !wantedAsEdger) continue;
    const url = String(pitch[key] ?? '').trim();
    if (!url) continue;

    if (isEdgerClip) {
      edger.push({ url, isEdger: true });
      continue;
    }
    const view = pitch[`${key}_view` as const];
    if (view === 'back') back.push({ url, isEdger: false });
    else if (view === 'side') side.push({ url, isEdger: false });
    else unknown.push({ url, isEdger: false });
  }

  return [...edger, ...back, ...side, ...unknown];
}

/** Downloads one clip, trims it to EXPORT_CLIP_SECONDS per exportTrimArgs
 * (Edger from the back, iPhone from the front) if it runs longer, and
 * scales/pads it to exactly fill its tile size (cover-style crop, not
 * letterbox -- a black-bar letterboxed tile inside an already-small
 * composite tile reads as mostly dead space, so each tile crops to fill
 * instead). */
async function prepareCombinedTile(
  url: string,
  outputPath: string,
  tileWidth: number,
  tileHeight: number,
  isEdger: boolean
): Promise<void> {
  const inputPath = `${outputPath}.src`;
  await downloadClip(url, inputPath);
  const duration = await probeDurationSeconds(inputPath);
  const trim = exportTrimArgs(duration, isEdger);
  const seekArgs = trim[0] === '-ss' ? ['-ss', trim[1]] : [];
  const durationArgs = trim[0] === '-ss' ? [trim[2], trim[3]] : trim;
  await runFfmpeg([
    '-y',
    ...seekArgs,
    '-i', inputPath,
    ...durationArgs,
    '-vf',
    `scale=${tileWidth}:${tileHeight}:force_original_aspect_ratio=increase,crop=${tileWidth}:${tileHeight},setsar=1,fps=30`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-an',
    outputPath,
  ]);
  await rm(inputPath, { force: true });
}

/** Renders the metrics + strike-zone side panel (see
 * renderPitchExportOverlayPng) and places it to the right of the given
 * video via ffmpeg's hstack filter, widening the canvas by
 * PITCH_EXPORT_PANEL_WIDTH. Panel height matches the video's height so
 * hstack doesn't need any additional scaling. Panel duration matches the
 * video's OWN real (already-trimmed-or-not) length, probed directly, rather
 * than a caller-assumed duration -- a clip left untouched because it was
 * already under EXPORT_CLIP_SECONDS must not get force-cut to exactly
 * EXPORT_CLIP_SECONDS just because that's this export's nominal target. */
async function addMetricsPanel(
  workDir: string,
  namePrefix: string,
  videoPath: string,
  videoHeight: number,
  metrics: PitchExportMetrics
): Promise<string> {
  const panelPng = renderPitchExportOverlayPng(metrics, videoHeight);
  const panelPath = path.join(workDir, `${namePrefix}.png`);
  await writeFile(panelPath, panelPng);

  const durationSeconds = (await probeDurationSeconds(videoPath)) ?? EXPORT_CLIP_SECONDS;

  const outputPath = path.join(workDir, `${namePrefix}-out.mp4`);
  await runFfmpeg([
    '-y',
    '-i', videoPath,
    '-framerate', '30',
    '-loop', '1',
    '-t', String(durationSeconds),
    '-i', panelPath,
    // PNG stills have no real frame rate, and `-loop 1` alone leaves it
    // effectively unset -- hstack then inherits an absurd/mismatched rate
    // from that input (confirmed: produced a 76800fps, 28MB/2.5s output).
    // Explicitly normalize both streams to 30fps before stacking.
    '-filter_complex', '[0:v]fps=30[v0];[1:v]fps=30[v1];[v0][v1]hstack=inputs=2[out]',
    '-map', '[out]',
    '-t', String(durationSeconds),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-an',
    outputPath,
  ]);
  return outputPath;
}

/** Horizontal-strip variant of addMetricsPanel, used for the landscape+
 * portrait 2-tile case: widening the canvas for a side panel next to
 * already-landscape-weighted video would make the export excessively wide,
 * so instead the panel goes BELOW the video (vstack, not hstack) and the
 * export grows taller instead. Panel width matches the video's width (so
 * vstack doesn't need extra scaling); panel height is the overlay module's
 * own fixed HORIZONTAL_PANEL_HEIGHT, unlike the side panel where the video
 * dictates the panel's height -- here the video dictates the panel's width
 * instead, the same relationship inverted. */
async function addMetricsPanelBelow(
  workDir: string,
  namePrefix: string,
  videoPath: string,
  videoWidth: number,
  metrics: PitchExportMetrics
): Promise<string> {
  const panelPng = renderPitchExportOverlayHorizontalPng(metrics, videoWidth);
  const panelPath = path.join(workDir, `${namePrefix}.png`);
  await writeFile(panelPath, panelPng);

  const durationSeconds = (await probeDurationSeconds(videoPath)) ?? EXPORT_CLIP_SECONDS;

  const outputPath = path.join(workDir, `${namePrefix}-out.mp4`);
  await runFfmpeg([
    '-y',
    '-i', videoPath,
    '-framerate', '30',
    '-loop', '1',
    '-t', String(durationSeconds),
    '-i', panelPath,
    '-filter_complex', '[0:v]fps=30[v0];[1:v]fps=30[v1];[v0][v1]vstack=inputs=2[out]',
    '-map', '[out]',
    '-t', String(durationSeconds),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-an',
    outputPath,
  ]);
  return outputPath;
}

/** Builds one pitch's multi-camera composite: whichever of the selected
 * cameras this pitch actually has footage for (see
 * resolvePitchCombinedClips), each trimmed per exportTrimArgs, laid out per
 * buildTileLayout (sized to however many clips this pitch has, not the
 * overall selection count), overlaid onto one canvas via ffmpeg's overlay
 * filter chain, and paired with a metrics + strike-zone side panel (see
 * renderPitchExportOverlayPng) if metrics data is available for this pitch. */
async function buildCombinedPitchClip(
  workDir: string,
  pitchIndex: number,
  pitch: PitchVideoUrls,
  selections: CameraSelection[],
  tileCanvasWidth: number,
  tileCanvasHeight: number,
  metrics: PitchExportMetrics | undefined,
  twoTileLeftWFrac = 0.5,
  twoTileStacked = false,
  metricsPanelMode: 'side' | 'below' = 'side'
): Promise<string | null> {
  const clips = resolvePitchCombinedClips(pitch, selections);
  if (!clips.length) return null;
  const layout = buildTileLayout(clips.length, twoTileLeftWFrac, clips.length === 2 && twoTileStacked);

  const tilePaths: Array<{ path: string; slot: TileSlot }> = [];
  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    const slot = layout[i];
    if (!slot) continue;
    const tileWidth = Math.max(2, Math.round(tileCanvasWidth * slot.wFrac) - (Math.round(tileCanvasWidth * slot.wFrac) % 2));
    const tileHeight = Math.max(2, Math.round(tileCanvasHeight * slot.hFrac) - (Math.round(tileCanvasHeight * slot.hFrac) % 2));
    const tilePath = path.join(workDir, `pitch${pitchIndex}-tile${i}.mp4`);
    await prepareCombinedTile(clip.url, tilePath, tileWidth, tileHeight, clip.isEdger);
    tilePaths.push({ path: tilePath, slot });
  }
  if (!tilePaths.length) return null;

  const tileGridPath = path.join(workDir, `pitch${pitchIndex}-grid.mp4`);
  let videoPath: string;
  if (tilePaths.length === 1) {
    // Nothing to composite -- the single tile already matches the full
    // tile canvas (buildTileLayout gives a lone selection wFrac/hFrac = 1).
    videoPath = tilePaths[0].path;
  } else {
    // Input 0 is the black base canvas; inputs 1..N are the prepared tiles,
    // in the same order as tilePaths so `[i+1:v]` always matches tilePaths[i].
    const inputArgs = tilePaths.flatMap(({ path: p }) => ['-i', p]);
    const filterParts: string[] = [];
    let lastLabel = '0:v';
    tilePaths.forEach(({ slot }, idx) => {
      const x = Math.round(tileCanvasWidth * slot.xFrac);
      const y = Math.round(tileCanvasHeight * slot.yFrac);
      const nextLabel = idx === tilePaths.length - 1 ? 'out' : `ov${idx}`;
      filterParts.push(`[${lastLabel}][${idx + 1}:v]overlay=${x}:${y}:shortest=0[${nextLabel}]`);
      lastLabel = nextLabel;
    });

    await runFfmpeg([
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=black:s=${tileCanvasWidth}x${tileCanvasHeight}:d=${EXPORT_CLIP_SECONDS}:r=30`,
      ...inputArgs,
      '-filter_complex',
      filterParts.join(';'),
      '-map', '[out]',
      '-t', String(EXPORT_CLIP_SECONDS),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-an',
      tileGridPath,
    ]);
    videoPath = tileGridPath;
  }

  if (!metrics) return videoPath;
  if (metricsPanelMode === 'below') {
    return addMetricsPanelBelow(workDir, `pitch${pitchIndex}-panel`, videoPath, tileCanvasWidth, metrics);
  }
  return addMetricsPanel(workDir, `pitch${pitchIndex}-panel`, videoPath, tileCanvasHeight, metrics);
}

export async function POST(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 500 });

  const body = (await request.json().catch(() => null)) as
    | { pitchEventIds?: number[]; camera?: string | string[]; mode?: string; showMetrics?: boolean }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
  // Whether to burn the metrics + strike-zone side panel into the exported
  // video -- defaults to true (matches behavior before this option existed)
  // so older callers that don't send this field are unaffected.
  const showMetrics = body.showMetrics !== false;

  const pitchEventIds = Array.from(
    new Set((body.pitchEventIds ?? []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))
  );
  if (!pitchEventIds.length) return NextResponse.json({ error: 'At least one pitch is required.' }, { status: 400 });
  if (pitchEventIds.length > MAX_PITCHES_PER_EXPORT) {
    return NextResponse.json({ error: `Export is limited to ${MAX_PITCHES_PER_EXPORT} pitches at a time.` }, { status: 400 });
  }

  const camerasToExport = parseCameraSelection(body.camera ?? null);
  // 'combined' shows every selected camera side by side per pitch, then
  // advances to the next pitch's composite; 'sequential' (default) is the
  // original behavior -- each camera's clips concatenated across all pitches
  // before moving to the next camera.
  const mode: 'sequential' | 'combined' = body.mode === 'combined' ? 'combined' : 'sequential';
  if (mode === 'combined' && camerasToExport.length < 2) {
    return NextResponse.json({ error: 'Combined export needs at least 2 cameras selected.' }, { status: 400 });
  }

  const schoolCode = resolveDashboardSchoolCode({
    userId: session.userId ?? 0,
    email: session.email,
    name: session.name,
    role: session.role === 'player' ? 'player' : session.role === 'coach' ? 'coach' : 'admin',
    organizationId: session.organizationId ?? 0,
    playerId: session.playerId ?? null,
    dashboardSchoolCode: session.dashboardSchoolCode ?? null,
    appUrl: session.appUrl,
    apps: session.apps,
  })
    .trim()
    .toUpperCase();

  let pitches: PitchVideoUrls[];
  try {
    pitches = await lookupPitchVideoUrls(pitchEventIds, schoolCode);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve pitch videos.' },
      { status: 500 }
    );
  }
  // Preserve the order the caller asked for (e.g. Prev/Next pitch order in
  // the modal), not whatever order the DB happened to return rows in.
  const byId = new Map(pitches.map((p) => [p.pitch_event_id, p]));
  const orderedPitches = pitchEventIds.map((id) => byId.get(id)).filter((p): p is PitchVideoUrls => Boolean(p));
  if (!orderedPitches.length) return NextResponse.json({ error: 'No video found for the selected pitches.' }, { status: 404 });

  // Metrics/location for the exported video's side panel -- best-effort:
  // export still proceeds without the panel if this lookup fails, since
  // the video itself is the primary thing being requested. Skipped entirely
  // when showMetrics is off (leaving metricsById empty makes every
  // downstream site render video-only, same as a failed lookup would).
  let metricsById = new Map<number, PitchExportMetrics>();
  if (showMetrics) {
    try {
      const metrics = await lookupPitchExportMetrics(
        orderedPitches.map((p) => p.pitch_event_id),
        schoolCode
      );
      metricsById = new Map(metrics.map((m) => [m.pitch_event_id, m]));
    } catch {
      // Export continues without the metrics panel.
    }
  }

  const clipsByCamera = new Map(
    camerasToExport.map((selection) => [
      selection,
      orderedPitches
        .map((p) => ({
          url: resolveClipUrl(p, selection),
          isEdger: resolveClipIsEdger(p, selection),
          metrics: metricsById.get(p.pitch_event_id),
        }))
        .filter((c) => c.url),
    ])
  );

  // All clips across every camera being exported share one canvas size, not
  // just clips within the same camera -- otherwise "all cameras" concats
  // segments of different resolutions with -c copy (stream copy, no
  // re-encode) at the final join, which produces a technically-valid file
  // that most players silently stop decoding partway through (plays fine,
  // then freezes while the duration/timer keeps advancing) since stream
  // copy never renegotiates resolution mid-stream.
  const allUrls = Array.from(clipsByCamera.values()).flat().map((c) => c.url);
  const dimensions = await Promise.all(allUrls.map((url) => probeDimensions(url)));
  const dimensionsByUrl = new Map(allUrls.map((url, i) => [url, dimensions[i]]));
  const canvasWidth = Math.max(480, ...dimensions.map((d) => d?.width ?? 0));
  const canvasHeight = Math.max(360, ...dimensions.map((d) => d?.height ?? 0));

  // Combined mode's 2-tile layout normally splits the tile pair 50/50, but a
  // landscape clip (e.g. Edger) squeezed into the same width as a portrait
  // clip crops away most of its frame (confirmed via a real export
  // screenshot -- the landscape tile lost nearly all its horizontal field of
  // view). Every pitch's clip is concatenated into one final file, so they
  // all must share one canvas size/split -- can't vary per pitch. Instead,
  // look at every pitch that will actually render 2 tiles and use whichever
  // one needs the widest landscape tile, applied to all of them; portrait-
  // only pitches just get a bit of unused space on the sides of their
  // (now-wider) landscape-shaped slot instead of any clip ever being cropped
  // tighter than necessary.
  //
  // Separately, the metrics panel PLACEMENT for a 2-tile pitch also depends
  // on this same landscape/portrait shape, per explicit request: two
  // portraits keep the side-by-side + side-panel layout as-is; two
  // landscapes stack the videos vertically (side by side would squeeze both
  // to portrait-shaped slots) with the panel still on the side; one of each
  // keeps side-by-side videos but moves the panel BELOW them instead of
  // widening the canvas further. Since every pitch shares one canvas/layout,
  // classify each 2-tile pitch's shape combo and use whichever combo the
  // MOST pitches in this export actually have.
  let twoTileLeftWFrac = 0.5;
  let twoTileCanvasWidth = canvasWidth;
  let twoTileCanvasHeight = canvasHeight;
  let twoTileStacked = false;
  let metricsPanelMode: 'side' | 'below' = 'side';
  if (mode === 'combined') {
    let widestDelta = 0;
    const comboCounts = { landscapePortrait: 0, bothLandscape: 0, bothPortrait: 0 };
    for (const pitch of orderedPitches) {
      const clips = resolvePitchCombinedClips(pitch, camerasToExport);
      if (clips.length !== 2) continue;
      const leftDims = dimensionsByUrl.get(clips[0].url) ?? null;
      const rightDims = dimensionsByUrl.get(clips[1].url) ?? null;
      const leftWFrac = computeTwoTileWidthFrac(leftDims, rightDims);
      const delta = Math.abs(leftWFrac - 0.5);
      if (delta > widestDelta) {
        widestDelta = delta;
        twoTileLeftWFrac = leftWFrac;
      }

      if (leftDims && rightDims && leftDims.height > 0 && rightDims.height > 0) {
        const leftIsLandscape = leftDims.width >= leftDims.height;
        const rightIsLandscape = rightDims.width >= rightDims.height;
        if (leftIsLandscape && rightIsLandscape) comboCounts.bothLandscape += 1;
        else if (!leftIsLandscape && !rightIsLandscape) comboCounts.bothPortrait += 1;
        else comboCounts.landscapePortrait += 1;
      }
    }
    if (widestDelta > 0) {
      // Keep the narrower tile's absolute width at least what the even
      // 50/50 split would have given it (canvasWidth / 2), rather than
      // shrinking it to make room -- so only the canvas grows, nothing gets
      // smaller than today's baseline.
      const narrowerFrac = Math.min(twoTileLeftWFrac, 1 - twoTileLeftWFrac);
      const neededWidth = Math.round(canvasWidth / 2 / narrowerFrac);
      twoTileCanvasWidth = Math.max(canvasWidth, neededWidth);
      twoTileCanvasWidth -= twoTileCanvasWidth % 2;
    }

    const totalClassified = comboCounts.landscapePortrait + comboCounts.bothLandscape + comboCounts.bothPortrait;
    if (totalClassified > 0) {
      if (comboCounts.bothLandscape >= comboCounts.landscapePortrait && comboCounts.bothLandscape >= comboCounts.bothPortrait) {
        twoTileStacked = true;
        metricsPanelMode = 'side';
        // Stacked full-width videos don't need the aspect-ratio-driven
        // width growth that side-by-side layouts do -- revert to the plain
        // probed canvas width, since there's no longer a narrow tile being
        // squeezed. Height doubles instead, since each of the 2 stacked
        // tiles now only gets half the canvas height -- without this, two
        // landscape clips stacked into a normal single-video-height canvas
        // would each render at half their natural height.
        twoTileCanvasWidth = canvasWidth;
        twoTileCanvasHeight = canvasHeight * 2;
      } else if (comboCounts.landscapePortrait >= comboCounts.bothPortrait) {
        metricsPanelMode = 'below';
      }
    }
  }

  const workDir = await mkdtemp(path.join(tmpdir(), 'pcu-video-export-'));
  let cleanupOwnedByResponseStream = false;
  try {
    let finalPath: string;

    if (mode === 'combined') {
      // Every pitch's composite is concatenated into one final file, so all
      // of them -- regardless of whether THIS particular pitch renders 1, 2,
      // or 3 tiles -- must share the exact same canvas size (see the
      // stream-copy/resolution-mismatch note above). twoTileCanvasWidth/
      // twoTileCanvasHeight are only ever >= canvasWidth/canvasHeight (grown,
      // never shrunk), so 1- and 3-tile pitches just get proportionally more
      // background canvas, never less.
      const builtPitchClipPaths = await mapWithConcurrency(
        orderedPitches,
        2,
        (pitch, i) =>
          buildCombinedPitchClip(
            workDir,
            i,
            pitch,
            camerasToExport,
            twoTileCanvasWidth,
            twoTileCanvasHeight,
            metricsById.get(pitch.pitch_event_id),
            twoTileLeftWFrac,
            twoTileStacked,
            metricsPanelMode
          )
      );
      const pitchClipPaths = builtPitchClipPaths.filter((clipPath): clipPath is string => Boolean(clipPath));
      if (!pitchClipPaths.length) {
        return NextResponse.json({ error: 'None of the selected pitches have video for the requested camera(s).' }, { status: 404 });
      }
      if (pitchClipPaths.length === 1) {
        finalPath = pitchClipPaths[0];
      } else {
        const listPath = path.join(workDir, 'final-list.txt');
        const listContents = pitchClipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        await writeFile(listPath, listContents);
        finalPath = path.join(workDir, 'final-combined.mp4');
        await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', finalPath]);
      }
    } else {
      const builtGroupOutputs = await mapWithConcurrency(
        camerasToExport,
        2,
        (selection) =>
          concatCameraGroup(
            workDir,
            selection,
            clipsByCamera.get(selection) ?? [],
            canvasWidth,
            canvasHeight
          )
      );
      const groupOutputs = builtGroupOutputs.filter((output): output is string => Boolean(output));

      if (!groupOutputs.length) {
        return NextResponse.json({ error: 'None of the selected pitches have video for the requested camera(s).' }, { status: 404 });
      }

      if (groupOutputs.length === 1) {
        finalPath = groupOutputs[0];
      } else {
        // "All cameras" with multiple pitches: each camera's own concatenated
        // sequence is itself concatenated after the others (camera 1's full
        // sequence, then camera 2's full sequence, ...) rather than
        // interleaving angles pitch-by-pitch, since that reads as a coherent
        // "here's every camera 1 clip, then every camera 2 clip" export
        // instead of a confusing angle-swap every few seconds. Safe to stream
        // copy here now that every segment shares the same canvas size.
        const listPath = path.join(workDir, 'final-list.txt');
        const listContents = groupOutputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        await writeFile(listPath, listContents);
        finalPath = path.join(workDir, 'final-combined.mp4');
        await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', finalPath]);
      }
    }

    const fileName = `pitch-export-${randomUUID().slice(0, 8)}.mp4`;
    const fileSize = (await stat(finalPath)).size;
    const fileStream = createReadStream(finalPath);
    // Returning a real stream avoids Vercel's 4.5 MB buffered Function
    // response limit. Keep the temp directory alive until the file has been
    // sent (or the browser cancels), then clean it up exactly once.
    fileStream.once('close', () => {
      void rm(workDir, { recursive: true, force: true });
    });
    cleanupOwnedByResponseStream = true;
    return new NextResponse(Readable.toWeb(fileStream) as ReadableStream<Uint8Array>, {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(fileSize),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export video.' },
      { status: 500 }
    );
  } finally {
    if (!cleanupOwnedByResponseStream) {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}
