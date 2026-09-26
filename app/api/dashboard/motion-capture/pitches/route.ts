import { NextResponse } from 'next/server';
import { ensureAuthDbReady, getDbPool } from '../../../../../lib/auth-db';
import { authorizedMotionCaptureSession, DATASET_FRAME_BOUNDS } from '../../../../../lib/motion-capture-access';

declare global {
  var __motionCaptureDeletedPitchesReady: boolean | undefined;
}

// Pitch payloads ship as static JSON, so deleting a pitch hides it here rather
// than removing files. Delete the row to restore a pitch.
async function ensureDeletedPitchesTable() {
  if (globalThis.__motionCaptureDeletedPitchesReady) return;
  await ensureAuthDbReady();
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS motion_capture_deleted_pitches (
      school_code TEXT NOT NULL,
      dataset_key TEXT NOT NULL,
      deleted_by TEXT,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (school_code, dataset_key)
    )
  `);
  globalThis.__motionCaptureDeletedPitchesReady = true;
}

export async function GET() {
  const auth = await authorizedMotionCaptureSession();
  if ('response' in auth) return auth.response;

  await ensureDeletedPitchesTable();
  const result = await getDbPool().query<{ dataset_key: string }>(
    `SELECT dataset_key FROM motion_capture_deleted_pitches WHERE school_code = 'PCU'`
  );
  return NextResponse.json({ deleted: result.rows.map((row) => row.dataset_key) });
}

export async function DELETE(request: Request) {
  const auth = await authorizedMotionCaptureSession(true);
  if ('response' in auth) return auth.response;

  const dataset = new URL(request.url).searchParams.get('dataset')?.trim().toLowerCase() ?? '';
  if (!DATASET_FRAME_BOUNDS[dataset]) return NextResponse.json({ error: 'Dataset not found.' }, { status: 404 });

  await ensureDeletedPitchesTable();
  await getDbPool().query(
    `INSERT INTO motion_capture_deleted_pitches (school_code, dataset_key, deleted_by, deleted_at)
     VALUES ('PCU', $1, $2, NOW())
     ON CONFLICT (school_code, dataset_key) DO NOTHING`,
    [dataset, auth.session.email]
  );
  return NextResponse.json({ ok: true, dataset });
}
