import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
import { renderPitchExportOverlayPng, PITCH_EXPORT_PANEL_WIDTH } from '../../../../../lib/pitch-export-overlay';

// Multi-clip download + ffmpeg re-encode/concat can genuinely take a while
// (each clip is downloaded fresh from Cloudinary, then re-encoded to a
// shared canvas before concatenation) -- give this route real headroom
// rather than the Next.js default.
export const maxDuration = 300;

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

/** Fixed per-camera-count layouts for the "Combined" export mode. 2 cameras
 * go side by side; 3 cameras put the Edger clip on top spanning the full
 * width with the two non-Edger cameras split below it, per explicit request
 * (Edger is the wide/primary angle, the two other cameras are secondary). */
function buildTileLayout(selections: CameraSelection[]): Map<CameraSelection, TileSlot> {
  const layout = new Map<CameraSelection, TileSlot>();
  if (selections.length <= 1) {
    if (selections.length === 1) layout.set(selections[0], { xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 1 });
    return layout;
  }
  if (selections.length === 2) {
    layout.set(selections[0], { xFrac: 0, yFrac: 0, wFrac: 0.5, hFrac: 1 });
    layout.set(selections[1], { xFrac: 0.5, yFrac: 0, wFrac: 0.5, hFrac: 1 });
    return layout;
  }
  // 3 cameras: Edger (if present) always takes the full-width top row;
  // otherwise the first selection takes that slot so the layout is still
  // filled predictably. The remaining two share the bottom row.
  const edgerIdx = selections.indexOf('edger');
  const topSelection = edgerIdx >= 0 ? selections[edgerIdx] : selections[0];
  const rest = selections.filter((s) => s !== topSelection);
  layout.set(topSelection, { xFrac: 0, yFrac: 0, wFrac: 1, hFrac: 0.5 });
  layout.set(rest[0], { xFrac: 0, yFrac: 0.5, wFrac: 0.5, hFrac: 0.5 });
  if (rest[1]) layout.set(rest[1], { xFrac: 0.5, yFrac: 0.5, wFrac: 0.5, hFrac: 0.5 });
  return layout;
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

/** Generates a solid dark gray tile of the given size/duration, for a pitch
 * missing one of the selected cameras -- keeps every pitch's composite the
 * same tile layout instead of reflowing. Deliberately no text label: ffmpeg's
 * drawtext filter requires a font file, and the deploy environment isn't
 * guaranteed to have one at a known path (confirmed: crashes with "No font
 * filename provided" when none is configured) -- a plain, visually distinct
 * gray fill (vs. black video letterboxing/backgrounds elsewhere) doesn't
 * depend on that. */
async function prepareBlankTile(outputPath: string, tileWidth: number, tileHeight: number, durationSeconds: number): Promise<void> {
  await runFfmpeg([
    '-y',
    '-f', 'lavfi',
    '-i', `color=c=0x333333:s=${tileWidth}x${tileHeight}:d=${durationSeconds}:r=30`,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-an',
    outputPath,
  ]);
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

/** Builds one pitch's multi-camera composite: each selected camera's clip
 * (or a blank placeholder tile if that pitch has no clip for that camera)
 * trimmed per exportTrimArgs, laid out per buildTileLayout, overlaid onto
 * one canvas via ffmpeg's overlay filter chain, and paired with a metrics +
 * strike-zone side panel (see renderPitchExportOverlayPng) if metrics data
 * is available for this pitch. */
async function buildCombinedPitchClip(
  workDir: string,
  pitchIndex: number,
  pitch: PitchVideoUrls,
  selections: CameraSelection[],
  tileCanvasWidth: number,
  tileCanvasHeight: number,
  metrics: PitchExportMetrics | undefined
): Promise<string | null> {
  const layout = buildTileLayout(selections);
  const clipsBySelection = new Map(
    selections.map((s) => [s, { url: resolveClipUrl(pitch, s), isEdger: resolveClipIsEdger(pitch, s) }])
  );
  if (![...clipsBySelection.values()].some((c) => c.url)) return null;

  const tilePaths: Array<{ path: string; slot: TileSlot }> = [];
  for (const selection of selections) {
    const slot = layout.get(selection);
    if (!slot) continue;
    const tileWidth = Math.max(2, Math.round(tileCanvasWidth * slot.wFrac) - (Math.round(tileCanvasWidth * slot.wFrac) % 2));
    const tileHeight = Math.max(2, Math.round(tileCanvasHeight * slot.hFrac) - (Math.round(tileCanvasHeight * slot.hFrac) % 2));
    const tilePath = path.join(workDir, `pitch${pitchIndex}-${selection}.mp4`);
    const clip = clipsBySelection.get(selection);
    if (clip?.url) {
      await prepareCombinedTile(clip.url, tilePath, tileWidth, tileHeight, clip.isEdger);
    } else {
      await prepareBlankTile(tilePath, tileWidth, tileHeight, EXPORT_CLIP_SECONDS);
    }
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
  return addMetricsPanel(workDir, `pitch${pitchIndex}-panel`, videoPath, tileCanvasHeight, metrics);
}

export async function POST(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 500 });

  const body = (await request.json().catch(() => null)) as
    | { pitchEventIds?: number[]; camera?: string | string[]; mode?: string }
    | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });

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
  // the video itself is the primary thing being requested.
  let metricsById = new Map<number, PitchExportMetrics>();
  try {
    const metrics = await lookupPitchExportMetrics(
      orderedPitches.map((p) => p.pitch_event_id),
      schoolCode
    );
    metricsById = new Map(metrics.map((m) => [m.pitch_event_id, m]));
  } catch {
    // Export continues without the metrics panel.
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
  const canvasWidth = Math.max(480, ...dimensions.map((d) => d?.width ?? 0));
  const canvasHeight = Math.max(360, ...dimensions.map((d) => d?.height ?? 0));

  const workDir = await mkdtemp(path.join(tmpdir(), 'pcu-video-export-'));
  try {
    let finalPath: string;

    if (mode === 'combined') {
      const pitchClipPaths: string[] = [];
      for (let i = 0; i < orderedPitches.length; i += 1) {
        const clipPath = await buildCombinedPitchClip(
          workDir,
          i,
          orderedPitches[i],
          camerasToExport,
          canvasWidth,
          canvasHeight,
          metricsById.get(orderedPitches[i].pitch_event_id)
        );
        if (clipPath) pitchClipPaths.push(clipPath);
      }
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
      const groupOutputs: string[] = [];
      for (const selection of camerasToExport) {
        const clips = clipsByCamera.get(selection) ?? [];
        const output = await concatCameraGroup(workDir, selection, clips, canvasWidth, canvasHeight);
        if (output) groupOutputs.push(output);
      }

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

    const fileBuffer = await readFile(finalPath);
    const fileName = `pitch-export-${randomUUID().slice(0, 8)}.mp4`;
    return new NextResponse(new Uint8Array(fileBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Content-Length': String(fileBuffer.length),
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to export video.' },
      { status: 500 }
    );
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
