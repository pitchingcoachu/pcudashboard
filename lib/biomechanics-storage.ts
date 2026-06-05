import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

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
  return process.env.R2_BUCKET_NAME?.trim() || 'pcu-biomechanics-raw';
}

export function isR2Configured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID?.trim() &&
    process.env.R2_ACCESS_KEY_ID?.trim() &&
    process.env.R2_SECRET_ACCESS_KEY?.trim()
  );
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
