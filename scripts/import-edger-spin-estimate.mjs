import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const MODEL_VERSION = 'edger-seam-fit-v3';
const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const pitchEventId = Number(args.get('--pitch-event-id'));
const reportPath = args.get('--report');
const sourceUrl = args.get('--source-url') ?? null;
if (!Number.isInteger(pitchEventId) || !reportPath) {
  throw new Error('Usage: node scripts/import-edger-spin-estimate.mjs --pitch-event-id ID --report report.json [--source-url URL]');
}

const report = JSON.parse(await readFile(resolve(reportPath), 'utf8'));
const fit = report.camera_fit;
const quality = report.quality;
if (!fit || !quality) throw new Error('Report must contain camera_fit and quality.');
const heldOutCost = Number(fit.held_out_cost_px);
const rpmError = Number(fit.spin_rate_error_at_1000_fps_pct);
const lockedAxisPass = fit.axis_prior_locked === true
  && Number(fit.fit_cost_px) <= 6.5
  && heldOutCost <= 8.5;
const videoAxisPass = fit.axis_prior_locked === false
  && Number(fit.fit_cost_px) <= 6.25
  && heldOutCost <= 8;
const accepted = quality.usable_seam_frames >= 12
  && quality.visibility_score >= 0.65
  && Number(fit.held_out_frames) >= 8
  && Number.isFinite(heldOutCost)
  && (lockedAxisPass || videoAxisPass)
  && Number.isFinite(rpmError)
  && rpmError <= 3;
if (!accepted) throw new Error(`Estimate failed quality gates: ${JSON.stringify({ quality, fit })}`);

const fitScore = Math.max(0, Math.min(1, 1 - ((Number(fit.fit_cost_px) - 3) / 5)));
const heldOutScore = Math.max(0, Math.min(1, 1 - ((heldOutCost - 4) / 6)));
const rpmScore = Math.max(0, 1 - (rpmError / 10));
const confidence = Math.max(0, Math.min(1,
  (quality.visibility_score * 0.25) + (fitScore * 0.25) + (heldOutScore * 0.3) + (rpmScore * 0.2)
));

const connectionString = process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not configured.');
const { Pool } = pg;
const pool = new Pool({ connectionString, max: 1 });

try {
  await pool.query(`SET statement_timeout = '30s'`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.video_spin_estimates (
      pitch_event_id BIGINT NOT NULL,
      model_version TEXT NOT NULL,
      school_code TEXT NOT NULL,
      play_id TEXT,
      pitch_uid TEXT,
      source_url TEXT,
      coordinate_frame TEXT NOT NULL DEFAULT 'edger_camera',
      status TEXT NOT NULL DEFAULT 'accepted',
      rotation_x DOUBLE PRECISION NOT NULL,
      rotation_y DOUBLE PRECISION NOT NULL,
      rotation_z DOUBLE PRECISION NOT NULL,
      axis_x DOUBLE PRECISION NOT NULL,
      axis_y DOUBLE PRECISION NOT NULL,
      axis_z DOUBLE PRECISION NOT NULL,
      phase_degrees_per_frame DOUBLE PRECISION NOT NULL,
      confidence DOUBLE PRECISION NOT NULL,
      diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (pitch_event_id, model_version)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS video_spin_estimates_school_pitch_idx ON public.video_spin_estimates (school_code, pitch_event_id DESC)`);
  const pitch = await pool.query(`
    SELECT id, UPPER(COALESCE(school_code, '')) AS school_code,
      NULLIF(TRIM(playid), '') AS play_id, NULLIF(TRIM(pitchuid), '') AS pitch_uid
    FROM public.pitch_events WHERE id = $1
  `, [pitchEventId]);
  if (!pitch.rowCount) throw new Error(`pitch_events row ${pitchEventId} was not found.`);
  const row = pitch.rows[0];
  await pool.query(`
    INSERT INTO public.video_spin_estimates (
      pitch_event_id, model_version, school_code, play_id, pitch_uid, source_url,
      rotation_x, rotation_y, rotation_z, axis_x, axis_y, axis_z,
      phase_degrees_per_frame, confidence, diagnostics, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,NOW())
    ON CONFLICT (pitch_event_id, model_version) DO UPDATE SET
      school_code = EXCLUDED.school_code, play_id = EXCLUDED.play_id,
      pitch_uid = EXCLUDED.pitch_uid, source_url = EXCLUDED.source_url,
      rotation_x = EXCLUDED.rotation_x, rotation_y = EXCLUDED.rotation_y,
      rotation_z = EXCLUDED.rotation_z, axis_x = EXCLUDED.axis_x,
      axis_y = EXCLUDED.axis_y, axis_z = EXCLUDED.axis_z,
      phase_degrees_per_frame = EXCLUDED.phase_degrees_per_frame,
      confidence = EXCLUDED.confidence, diagnostics = EXCLUDED.diagnostics,
      status = 'accepted', updated_at = NOW()
  `, [
    pitchEventId, MODEL_VERSION, row.school_code, row.play_id, row.pitch_uid, sourceUrl,
    ...fit.initial_seam_euler_xyz_deg,
    ...fit.spin_axis_camera_xyz,
    fit.phase_degrees_per_export_frame,
    confidence,
    JSON.stringify({ video_stream: report.video_stream, quality, camera_fit: fit }),
  ]);
  console.log(JSON.stringify({ pitchEventId, modelVersion: MODEL_VERSION, confidence: Number(confidence.toFixed(3)) }));
} finally {
  await pool.end();
}
