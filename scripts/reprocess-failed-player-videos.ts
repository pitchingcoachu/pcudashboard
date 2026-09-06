import { getDbPool } from '../lib/auth-db';
import {
  deleteObjectFromR2,
  getObjectFromR2,
  getObjectMetadataFromR2,
  uploadPlayerMediaToR2,
} from '../lib/biomechanics-storage';
import { transcodePlayerVideo } from '../lib/transcode-player-video';

type FailedVideo = {
  id: number;
  organization_id: number;
  player_id: number;
  full_name: string;
  file_name: string;
  r2_key: string;
};

function requestedSchool(): string {
  const value = process.argv.find((arg) => arg.startsWith('--school='))?.slice('--school='.length).trim().toUpperCase();
  if (!value) throw new Error('Pass a school code, for example --school=UNOH.');
  return value;
}

async function readBody(body: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of body) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const schoolCode = requestedSchool();
  const pool = getDbPool();
  try {
    const result = await pool.query<FailedVideo>(
      `
        SELECT pm.id, pm.organization_id, pm.player_id, p.full_name, pm.file_name, pm.r2_key
        FROM player_media pm
        JOIN players p ON p.id = pm.player_id
        JOIN organizations o ON o.id = pm.organization_id
        WHERE pm.media_type = 'video'
          AND pm.processing_status = 'failed'
          AND (
            UPPER(COALESCE(p.school_code, '')) = $1
            OR UPPER(o.name) = $1
            OR UPPER(o.name) LIKE '%' || $1 || '%'
          )
        ORDER BY pm.created_at, pm.id
      `,
      [schoolCode]
    );

    console.log(`Found ${result.rows.length} failed ${schoolCode} video(s).`);
    let succeeded = 0;
    let failed = 0;

    for (const video of result.rows) {
      let replacementKey: string | null = null;
      try {
        await pool.query(
          `UPDATE player_media SET processing_status = 'processing', processing_error = NULL, updated_at = NOW() WHERE id = $1`,
          [video.id]
        );
        const original = await getObjectFromR2(video.r2_key);
        if (!original) throw new Error('Could not read the original video from storage.');
        const output = await transcodePlayerVideo(await readBody(original.body));
        replacementKey = await uploadPlayerMediaToR2({
          organizationId: video.organization_id,
          playerId: video.player_id,
          fileName: video.file_name.replace(/\.[^./]+$/, '') + '.mp4',
          contentType: 'video/mp4',
          body: output,
        });
        if (!replacementKey) throw new Error('Could not store the transcoded video.');
        const stored = await getObjectMetadataFromR2(replacementKey);
        if (!stored || stored.contentLength !== output.length) throw new Error('The replacement video failed its storage size check.');

        await pool.query(
          `
            UPDATE player_media
            SET r2_key = $2, content_type = 'video/mp4', size_bytes = $3,
                processing_status = 'ready', processing_error = NULL, updated_at = NOW()
            WHERE id = $1
          `,
          [video.id, replacementKey, output.length]
        );
        await deleteObjectFromR2(video.r2_key);
        succeeded += 1;
        console.log(`Ready: ${video.full_name} / ${video.file_name} (media ${video.id})`);
      } catch (error) {
        if (replacementKey) await deleteObjectFromR2(replacementKey).catch(() => {});
        const message = error instanceof Error ? error.message : String(error);
        await pool.query(
          `UPDATE player_media SET processing_status = 'failed', processing_error = $2, updated_at = NOW() WHERE id = $1`,
          [video.id, message.slice(0, 2000)]
        );
        failed += 1;
        console.error(`Failed: ${video.full_name} / ${video.file_name} (media ${video.id}): ${message}`);
      }
    }

    console.log(`Finished: ${succeeded} ready, ${failed} failed.`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
