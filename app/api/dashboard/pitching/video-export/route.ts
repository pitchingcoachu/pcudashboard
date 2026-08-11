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
import { lookupPitchVideoUrls, type PitchVideoUrls } from '../../../../../lib/pitching-video-lookup';

// Multi-clip download + ffmpeg re-encode/concat can genuinely take a while
// (each clip is downloaded fresh from Cloudinary, then re-encoded to a
// shared canvas before concatenation) -- give this route real headroom
// rather than the Next.js default.
export const maxDuration = 300;

const MAX_PITCHES_PER_EXPORT = 20;
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

/** Downloads one clip and re-encodes it to a shared landscape canvas
 * (letterboxed, matching whatever the largest source clip's dimensions are)
 * so clips with different resolutions/orientations -- confirmed to happen
 * across camera angles -- can be concatenated cleanly afterward. */
async function normalizeClip(url: string, outputPath: string, canvasWidth: number, canvasHeight: number): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download clip: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const inputPath = `${outputPath}.src`;
  await writeFile(inputPath, buffer);
  await runFfmpeg([
    '-y',
    '-i', inputPath,
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
  urls: string[],
  canvasWidth: number,
  canvasHeight: number
): Promise<string | null> {
  if (!urls.length) return null;

  const normalizedPaths: string[] = [];
  for (let i = 0; i < urls.length; i += 1) {
    const outPath = path.join(workDir, `${groupName}-${i}.mp4`);
    await normalizeClip(urls[i], outPath, canvasWidth, canvasHeight);
    normalizedPaths.push(outPath);
  }

  if (normalizedPaths.length === 1) return normalizedPaths[0];

  const listPath = path.join(workDir, `${groupName}-list.txt`);
  const listContents = normalizedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await writeFile(listPath, listContents);

  const combinedPath = path.join(workDir, `${groupName}-combined.mp4`);
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', combinedPath]);
  return combinedPath;
}

export async function POST(request: Request) {
  const session = getSessionFromRequest(request, await cookies());
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: 'DATABASE_URL is not configured.' }, { status: 500 });

  const body = (await request.json().catch(() => null)) as
    | { pitchEventIds?: number[]; camera?: string | string[] }
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

  const urlsByCamera = new Map(
    camerasToExport.map((selection) => [
      selection,
      orderedPitches.map((p) => resolveClipUrl(p, selection)).filter(Boolean),
    ])
  );

  // All clips across every camera being exported share one canvas size, not
  // just clips within the same camera -- otherwise "all cameras" concats
  // segments of different resolutions with -c copy (stream copy, no
  // re-encode) at the final join, which produces a technically-valid file
  // that most players silently stop decoding partway through (plays fine,
  // then freezes while the duration/timer keeps advancing) since stream
  // copy never renegotiates resolution mid-stream.
  const allUrls = Array.from(urlsByCamera.values()).flat();
  const dimensions = await Promise.all(allUrls.map((url) => probeDimensions(url)));
  const canvasWidth = Math.max(480, ...dimensions.map((d) => d?.width ?? 0));
  const canvasHeight = Math.max(360, ...dimensions.map((d) => d?.height ?? 0));

  const workDir = await mkdtemp(path.join(tmpdir(), 'pcu-video-export-'));
  try {
    const groupOutputs: string[] = [];
    for (const selection of camerasToExport) {
      const urls = urlsByCamera.get(selection) ?? [];
      const output = await concatCameraGroup(workDir, selection, urls, canvasWidth, canvasHeight);
      if (output) groupOutputs.push(output);
    }

    if (!groupOutputs.length) {
      return NextResponse.json({ error: 'None of the selected pitches have video for the requested camera(s).' }, { status: 404 });
    }

    let finalPath: string;
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
