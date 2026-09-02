import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

type Mp4Box = {
  type: string;
  offset: number;
  size: number;
};

function readTopLevelMp4Boxes(buffer: Buffer): Mp4Box[] {
  const boxes: Mp4Box[] = [];
  let offset = 0;

  while (offset + 8 <= buffer.length) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    let size: number;

    if (size32 === 1) {
      if (offset + 16 > buffer.length) throw new Error('MP4 has an incomplete extended box header.');
      const extendedSize = buffer.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('MP4 box is too large to validate safely.');
      size = Number(extendedSize);
      headerSize = 16;
    } else if (size32 === 0) {
      size = buffer.length - offset;
    } else {
      size = size32;
    }

    if (size < headerSize || offset + size > buffer.length) {
      throw new Error(`MP4 has an incomplete ${type || 'unknown'} box.`);
    }
    boxes.push({ type, offset, size });
    offset += size;
  }

  if (offset !== buffer.length) throw new Error('MP4 has trailing incomplete data.');
  return boxes;
}

/**
 * Rejects the exact failure mode that produces a 0:00 black video in both
 * browsers and native players: an MP4 with media data but no finalized moov
 * metadata atom. A complete file must also be fast-started for reliable range
 * playback on iOS and the web.
 */
export function assertPlayableMp4(buffer: Buffer): void {
  if (buffer.length < 24) throw new Error('Transcoded MP4 is empty or incomplete.');
  const boxes = readTopLevelMp4Boxes(buffer);
  const ftyp = boxes.find((box) => box.type === 'ftyp');
  const moov = boxes.find((box) => box.type === 'moov');
  const mdat = boxes.find((box) => box.type === 'mdat');
  if (!ftyp) throw new Error('Transcoded MP4 is missing its file-type header.');
  if (!moov) throw new Error('Transcoded MP4 is missing its playback metadata (moov atom).');
  if (!mdat || mdat.size <= 8) throw new Error('Transcoded MP4 has no playable media data.');
  if (moov.size <= 8) throw new Error('Transcoded MP4 playback metadata is empty.');
  if (moov.offset > mdat.offset) throw new Error('Transcoded MP4 is not optimized for streaming playback.');
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath.path, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
      if (stderr.length > 8000) stderr = stderr.slice(-8000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

/**
 * Re-encodes an uploaded video to broadly-compatible H.264/AAC MP4 with
 * `-movflags +faststart` (moov atom moved to the front of the file).
 *
 * Neither the web nor the app upload path does any normalization -- files
 * are stored exactly as the browser/OS handed them over. Browsers accept
 * essentially any container/codec a desktop file picker exposes (HEVC .mov,
 * non-faststart MP4, even WebM/MKV), which expo-video's native player
 * (AVPlayer/ExoPlayer) is far stricter about than a browser <video> tag --
 * that mismatch is the root cause of web-uploaded videos stuttering or
 * failing to play in the mobile app. This normalizes every video upload
 * (both platforms) to one known-good format so playback no longer depends
 * on what format the source file happened to already be in.
 */
export async function transcodePlayerVideo(inputBuffer: Buffer): Promise<Buffer> {
  const workDir = await mkdtemp(path.join(tmpdir(), 'pcu-player-video-'));
  const inputPath = path.join(workDir, 'input');
  const outputPath = path.join(workDir, 'output.mp4');
  try {
    await writeFile(inputPath, inputBuffer);
    await runFfmpeg([
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '160k',
      '-movflags', '+faststart',
      outputPath,
    ]);
    const output = await readFile(outputPath);
    assertPlayableMp4(output);
    return output;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
