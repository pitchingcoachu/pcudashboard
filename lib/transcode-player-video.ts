import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

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
    return await readFile(outputPath);
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
