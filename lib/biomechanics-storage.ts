import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Cloudflare R2 client
// ---------------------------------------------------------------------------

let r2Client: S3Client | null = null;

export function getR2Client(): S3Client | null {
  if (r2Client) return r2Client;
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  r2Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return r2Client;
}

export function getR2Bucket(): string {
  return process.env.R2_BUCKET_NAME?.trim() || 'pcu';
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID?.trim() &&
    process.env.R2_ACCESS_KEY_ID?.trim() &&
    process.env.R2_SECRET_ACCESS_KEY?.trim()
  );
}

function canUseLocalMotionCaptureStorage(): boolean {
  return process.env.VERCEL !== '1' && process.env.NODE_ENV !== 'production';
}

function localMotionCaptureRoot(): string {
  return path.join(process.cwd(), '.motion-capture-uploads');
}

export function isMotionCaptureVideoStorageConfigured(): boolean {
  return isR2Configured() || canUseLocalMotionCaptureStorage();
}

function inferVideoContentTypeFromKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.mp4') || lower.endsWith('.m4v')) return 'video/mp4';
  if (lower.endsWith('.mov') || lower.endsWith('.qt')) return 'video/quicktime';
  if (lower.endsWith('.webm')) return 'video/webm';
  return 'application/octet-stream';
}

export async function uploadRawCsvToR2(args: {
  schoolCode: string;
  sourceFileHash: string;
  sourceFileName: string;
  csvContent: string;
}): Promise<string | null> {
  const client = getR2Client();
  if (!client) return null;
  const bucket = getR2Bucket();
  const key = `raw/${args.schoolCode}/${args.sourceFileHash}/${args.sourceFileName}`;
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: args.csvContent,
      ContentType: 'text/csv',
      Metadata: {
        school_code: args.schoolCode,
        source_file_hash: args.sourceFileHash,
        source_file_name: args.sourceFileName,
      },
    }));
    return key;
  } catch {
    return null;
  }
}

export async function getRawCsvFromR2(args: {
  schoolCode: string;
  sourceFileHash: string;
  sourceFileName: string;
}): Promise<string | null> {
  const client = getR2Client();
  if (!client) return null;
  const bucket = getR2Bucket();
  const key = `raw/${args.schoolCode}/${args.sourceFileHash}/${args.sourceFileName}`;
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = response.Body;
    if (!body) return null;
    const chunks: Uint8Array[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
  } catch {
    return null;
  }
}

export async function uploadMotionCaptureVideoToR2(args: {
  organizationId: number;
  playerId: number;
  throwId: number;
  viewType: string;
  fileName: string;
  contentType: string;
  body: Buffer;
}): Promise<string | null> {
  const safeView = String(args.viewType ?? 'video').toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const safeName = String(args.fileName ?? 'clip.mov').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const key = `motion-capture/org-${args.organizationId}/player-${args.playerId}/throw-${args.throwId}/${safeView}-${Date.now()}-${safeName}`;
  const client = getR2Client();
  if (!client) {
    if (!canUseLocalMotionCaptureStorage()) return null;
    try {
      const filePath = path.join(localMotionCaptureRoot(), key);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, args.body);
      return `local:${key}`;
    } catch {
      return null;
    }
  }
  const bucket = getR2Bucket();
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: args.body,
      ContentType: args.contentType || 'application/octet-stream',
      Metadata: {
        organization_id: String(args.organizationId),
        player_id: String(args.playerId),
        throw_id: String(args.throwId),
        view_type: safeView,
        source_file_name: safeName,
      },
    }));
    return key;
  } catch {
    return null;
  }
}

export async function uploadBiomechanicsPitchVideoToR2(args: {
  organizationId: number;
  schoolCode: string;
  pitchKey: string;
  fileName: string;
  contentType: string;
  body: Buffer;
}): Promise<string | null> {
  const safeName = String(args.fileName ?? 'pitch.mp4').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const key = `biomechanics-video/org-${args.organizationId}/school-${args.schoolCode}/${args.pitchKey}/${safeName}`;
  const client = getR2Client();
  if (!client) {
    if (!canUseLocalMotionCaptureStorage()) return null;
    try {
      const filePath = path.join(localMotionCaptureRoot(), key);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, args.body);
      return `local:${key}`;
    } catch {
      return null;
    }
  }
  const bucket = getR2Bucket();
  try {
    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: args.body,
      ContentType: args.contentType || inferVideoContentTypeFromKey(safeName),
      Metadata: {
        organization_id: String(args.organizationId),
        school_code: args.schoolCode,
        pitch_key: args.pitchKey,
        source_file_name: safeName,
      },
    }));
    return key;
  } catch {
    return null;
  }
}

export async function uploadPlayerMediaToR2(args: {
  organizationId: number;
  playerId: number;
  fileName: string;
  contentType: string;
  body: Buffer;
}): Promise<string | null> {
  const safeName = String(args.fileName ?? 'media').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const normalizedType = String(args.contentType ?? '').toLowerCase();
  const kind = normalizedType.startsWith('image/') ? 'photo' : normalizedType.startsWith('video/') ? 'video' : normalizedType === 'application/pdf' ? 'pdf' : 'file';
  const key = `player-media/org-${args.organizationId}/player-${args.playerId}/${kind}-${Date.now()}-${safeName}`;
  const client = getR2Client();
  if (!client) {
    if (!canUseLocalMotionCaptureStorage()) throw new Error('R2 not configured and local storage only works in dev (NODE_ENV=development, VERCEL!=1)');
    const filePath = path.join(localMotionCaptureRoot(), key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, args.body);
    return `local:${key}`;
  }
  const bucket = getR2Bucket();
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: args.body,
    ContentType: args.contentType || 'application/octet-stream',
    Metadata: {
      organization_id: String(args.organizationId),
      player_id: String(args.playerId),
      source_file_name: safeName,
      media_kind: kind,
    },
  }));
  return key;
}

export async function getObjectFromR2(key: string): Promise<{ body: AsyncIterable<Uint8Array>; contentType: string; contentLength: number | null } | null> {
  if (key.startsWith('local:')) {
    if (!canUseLocalMotionCaptureStorage()) return null;
    const localKey = key.slice('local:'.length);
    const filePath = path.join(localMotionCaptureRoot(), localKey);
    try {
      const info = await stat(filePath);
      return {
        body: createReadStream(filePath) as unknown as AsyncIterable<Uint8Array>,
        contentType: inferVideoContentTypeFromKey(localKey),
        contentLength: info.size,
      };
    } catch {
      return null;
    }
  }
  const client = getR2Client();
  if (!client) return null;
  const bucket = getR2Bucket();
  try {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) return null;
    return {
      body: response.Body as AsyncIterable<Uint8Array>,
      contentType: response.ContentType ?? 'application/octet-stream',
      contentLength: typeof response.ContentLength === 'number' ? response.ContentLength : null,
    };
  } catch {
    return null;
  }
}

export async function deleteObjectFromR2(key: string): Promise<void> {
  if (key.startsWith('local:')) {
    if (!canUseLocalMotionCaptureStorage()) return;
    const localKey = key.slice('local:'.length);
    try {
      await rm(path.join(localMotionCaptureRoot(), localKey), { force: true });
    } catch {
      // Deleting the DB record should not be blocked by a missing local file.
    }
    return;
  }
  const client = getR2Client();
  if (!client || !key) return;
  const bucket = getR2Bucket();
  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch {
    // Deleting the DB record should not be blocked by a missing storage object.
  }
}

// ---------------------------------------------------------------------------
// LTTB (Largest-Triangle-Three-Buckets) downsampling
// Preserves peaks, valleys, and shape-critical inflection points.
// ---------------------------------------------------------------------------

export interface GraphPoint {
  t: number;
  fx: number | null;
  fy: number | null;
  fz: number | null;
  mx: number | null;
  my: number | null;
  mz: number | null;
  phase_name: string | null;
  device_id: string | null;
  position_id: string | null;
}

export function lttbDownsample(points: GraphPoint[], targetCount: number): GraphPoint[] {
  const n = points.length;
  if (n <= targetCount) return points;
  if (targetCount < 3) return [points[0]!, points[n - 1]!];

  const sampled: GraphPoint[] = [];
  // Always keep first point
  sampled.push(points[0]!);

  const bucketSize = (n - 2) / (targetCount - 2);

  let prevIdx = 0;

  for (let i = 0; i < targetCount - 2; i += 1) {
    // Current bucket range
    const bucketStart = Math.floor((i + 0) * bucketSize) + 1;
    const bucketEnd = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);

    // Next bucket average point (for triangle area calculation)
    const nextBucketStart = Math.floor((i + 1) * bucketSize) + 1;
    const nextBucketEnd = Math.min(Math.floor((i + 2) * bucketSize) + 1, n - 1);
    let avgFy = 0;
    let avgT = 0;
    let avgCount = 0;
    for (let j = nextBucketStart; j < nextBucketEnd; j += 1) {
      const p = points[j];
      if (!p) continue;
      avgT += p.t;
      avgFy += (p.fy ?? 0);
      avgCount += 1;
    }
    if (avgCount > 0) {
      avgT /= avgCount;
      avgFy /= avgCount;
    }

    // Pick point in current bucket with largest triangle area
    const prevPoint = points[prevIdx]!;
    let maxArea = -1;
    let maxIdx = bucketStart;
    for (let j = bucketStart; j < bucketEnd; j += 1) {
      const p = points[j];
      if (!p) continue;
      // Triangle area using Fz as the primary signal (dominant metric signal)
      const area = Math.abs(
        (prevPoint.t - avgT) * ((p.fz ?? 0) - (prevPoint.fz ?? 0)) -
        (prevPoint.t - p.t) * (avgFy - (prevPoint.fz ?? 0))
      ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        maxIdx = j;
      }
    }
    sampled.push(points[maxIdx]!);
    prevIdx = maxIdx;
  }

  // Always keep last point
  sampled.push(points[n - 1]!);
  return sampled;
}

// Target points per pitch for graph rendering — enough for smooth curves,
// small enough to keep DB rows minimal.
export const GRAPH_CACHE_TARGET_POINTS = 600;
