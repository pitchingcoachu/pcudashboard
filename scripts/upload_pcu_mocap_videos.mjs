#!/usr/bin/env node

import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const PROJECT_ROOT = process.cwd();
const force = process.argv.includes('--force');
// --only=<prefix> limits the run to dataset keys starting with the prefix.
const only = process.argv.find((arg) => arg.startsWith('--only='))?.slice('--only='.length);
const legacyRecordings = [
  {
    datasetKey: 'test',
    root: '/Users/jaredgaynor/Downloads/mocap/2026-09-24_14-15-10_GMT-7',
    payload: path.join(PROJECT_ROOT, 'public/mocap/pcu-three-camera-test.json'),
  },
  {
    datasetKey: 'tj-kenyon',
    root: '/Users/jaredgaynor/Downloads/Kenyon',
    payload: path.join(PROJECT_ROOT, 'public/mocap/pcu-tj-kenyon-five-camera.json'),
  },
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function exists(client, bucket, key) {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false;
    throw error;
  }
}

async function main() {
  const accountId = required('R2_ACCOUNT_ID');
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
  });
  const bucket = process.env.R2_BUCKET_NAME?.trim() || 'pcu';
  const workDir = await mkdtemp(path.join(tmpdir(), 'pcu-mocap-video-'));
  const generatedManifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'public/mocap/pcu-mocap-manifest.json'), 'utf8'));
  const generatedRecordings = generatedManifest.map((capture) => {
    const athleteSlug = String(capture.athlete).toLowerCase().replace(/[^a-z0-9]+/g, '-');
    const stamp = String(capture.datasetKey).match(/(\d{8})-(\d{6})$/);
    if (!stamp) throw new Error(`Dataset key does not contain a capture timestamp: ${capture.datasetKey}`);
    const folder = `${stamp[1].slice(0, 4)}-${stamp[1].slice(4, 6)}-${stamp[1].slice(6, 8)}_${stamp[2].slice(0, 2)}-${stamp[2].slice(2, 4)}-${stamp[2].slice(4, 6)}_GMT-7`;
    return {
      datasetKey: capture.datasetKey,
      root: path.join('/tmp/pcu-mocap-import', athleteSlug, folder),
      payload: path.join(PROJECT_ROOT, 'public/mocap', capture.file),
    };
  });
  const recordings = [...legacyRecordings, ...generatedRecordings]
    .filter((recording) => !only || recording.datasetKey.startsWith(only));

  try {
    for (const recording of recordings) {
      const payload = JSON.parse(await readFile(recording.payload, 'utf8'));
      const startFrame = Number(payload.analysisWindow.startFrame);
      const endFrame = Number(payload.analysisWindow.endFrame);
      const frameCount = endFrame - startFrame + 1;
      const captureFps = Number(payload.captureFps);
      const videoVariants = [
        { view: 'overlay', directory: path.join(recording.root, 'annotated_videos'), keyPrefix: '' },
      ];

      for (const variant of videoVariants) {
        const videoNames = (await readdir(variant.directory))
          .filter((name) => name.toLowerCase().endsWith('.mp4'))
          .sort((a, b) => Number(a.match(/idx-(\d+)/)?.[1] ?? 999) - Number(b.match(/idx-(\d+)/)?.[1] ?? 999));

        for (const videoName of videoNames) {
          const camera = Number(videoName.match(/idx-(\d+)/)?.[1]);
          if (!Number.isFinite(camera)) continue;
          const key = `motion-capture/pcu/${recording.datasetKey}/${variant.keyPrefix}camera-${camera}.mp4`;
          if (!force && await exists(client, bucket, key)) {
            console.log(`Already uploaded: ${key}`);
            continue;
          }

          const output = path.join(workDir, `${recording.datasetKey}-${variant.keyPrefix}camera-${camera}.mp4`);
          await run('ffmpeg', [
            '-y', '-loglevel', 'error',
            '-i', path.join(variant.directory, videoName),
            '-an',
            // Export the exact source-frame range used by the metric payload.
            // Timestamp-based seeking drifted because the recording timestamp
            // CSV and encoded MP4 use different time bases.
            '-vf', `select=between(n\\,${startFrame}\\,${endFrame}),setpts=N/(${captureFps}*TB),scale=-2:720:flags=lanczos`,
            '-r', String(captureFps),
            '-frames:v', String(frameCount),
            '-c:v', 'libx264', '-preset', 'medium', '-crf', '25',
            '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
            output,
          ]);
          const body = await readFile(output);
          await client.send(new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: 'video/mp4',
            CacheControl: 'private, max-age=3600',
            Metadata: {
              school_code: 'PCU',
              dataset: recording.datasetKey,
              camera: String(camera),
              view: variant.view,
              analysis_start_frame: String(payload.analysisWindow.startFrame),
              analysis_end_frame: String(payload.analysisWindow.endFrame),
            },
          }));
          console.log(`Uploaded ${key} (${(body.length / 1024 / 1024).toFixed(2)} MB)`);
        }
      }
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
