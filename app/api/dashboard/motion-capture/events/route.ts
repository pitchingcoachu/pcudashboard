import { NextResponse } from 'next/server';
import { ensureAuthDbReady, getDbPool } from '../../../../../lib/auth-db';
import { authorizedMotionCaptureSession, DATASET_FRAME_BOUNDS } from '../../../../../lib/motion-capture-access';

declare global {
  var __motionCaptureEventOverridesV2Ready: boolean | undefined;
}

async function ensureEventOverridesTable() {
  if (globalThis.__motionCaptureEventOverridesV2Ready) return;
  await ensureAuthDbReady();
  await getDbPool().query(`
    CREATE TABLE IF NOT EXISTS motion_capture_event_overrides (
      school_code TEXT NOT NULL,
      dataset_key TEXT NOT NULL,
      foot_contact_frame INTEGER,
      ball_release_frame INTEGER NOT NULL,
      updated_by TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (school_code, dataset_key)
    )
  `);
  await getDbPool().query(`
    ALTER TABLE motion_capture_event_overrides
    ADD COLUMN IF NOT EXISTS foot_contact_frame INTEGER
  `);
  globalThis.__motionCaptureEventOverridesV2Ready = true;
}

export async function GET(request: Request) {
  const auth = await authorizedMotionCaptureSession();
  if ('response' in auth) return auth.response;
  const dataset = new URL(request.url).searchParams.get('dataset')?.trim().toLowerCase() ?? '';
  if (!DATASET_FRAME_BOUNDS[dataset]) return NextResponse.json({ error: 'Dataset not found.' }, { status: 404 });

  await ensureEventOverridesTable();
  const result = await getDbPool().query<{ foot_contact_frame: number | null; ball_release_frame: number }>(
    `SELECT foot_contact_frame, ball_release_frame
     FROM motion_capture_event_overrides
     WHERE school_code = 'PCU' AND dataset_key = $1`,
    [dataset]
  );
  return NextResponse.json({
    footContactFrame: result.rows[0]?.foot_contact_frame ?? null,
    ballReleaseFrame: result.rows[0]?.ball_release_frame ?? null,
  });
}

export async function POST(request: Request) {
  const auth = await authorizedMotionCaptureSession(true);
  if ('response' in auth) return auth.response;

  const body = await request.json().catch(() => null) as { dataset?: unknown; footContactFrame?: unknown; ballReleaseFrame?: unknown } | null;
  const dataset = String(body?.dataset ?? '').trim().toLowerCase();
  const footContactFrame = Number(body?.footContactFrame);
  const ballReleaseFrame = Number(body?.ballReleaseFrame);
  const bounds = DATASET_FRAME_BOUNDS[dataset];
  if (!bounds
    || !Number.isInteger(footContactFrame)
    || !Number.isInteger(ballReleaseFrame)
    || footContactFrame < bounds.first
    || ballReleaseFrame > bounds.last
    || footContactFrame >= ballReleaseFrame) {
    return NextResponse.json({ error: 'Valid foot-contact and ball-release frames are required.' }, { status: 400 });
  }

  await ensureEventOverridesTable();
  await getDbPool().query(
    `INSERT INTO motion_capture_event_overrides
       (school_code, dataset_key, foot_contact_frame, ball_release_frame, updated_by, updated_at)
     VALUES ('PCU', $1, $2, $3, $4, NOW())
     ON CONFLICT (school_code, dataset_key)
     DO UPDATE SET
       foot_contact_frame = EXCLUDED.foot_contact_frame,
       ball_release_frame = EXCLUDED.ball_release_frame,
       updated_by = EXCLUDED.updated_by,
       updated_at = NOW()`,
    [dataset, footContactFrame, ballReleaseFrame, auth.session.email]
  );
  return NextResponse.json({ ok: true, footContactFrame, ballReleaseFrame });
}
