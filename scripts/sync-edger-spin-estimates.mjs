import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import pg from 'pg';

const run = promisify(execFile);
const MODEL_VERSION = 'edger-seam-fit-v3';

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function finite(value) {
  const match = String(value ?? '').match(/[-+]?[0-9]*\.?[0-9]+/);
  const number = match ? Number(match[0]) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

async function download(url, destination) {
  const response = await fetch(url);
  if (!response.ok || !response.body) throw new Error(`video download returned ${response.status}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));
}

async function fit(video, output, pitch, gyroSign) {
  const efficiencyRaw = finite(pitch.spin_efficiency);
  const efficiency = efficiencyRaw === null ? null : Math.max(0, Math.min(1, efficiencyRaw > 1.25 ? efficiencyRaw / 100 : efficiencyRaw));
  const args = [
    'scripts/edger_spin_cv.py', video, '--output', output, '--fit',
    '--spin-rate-rpm', String(pitch.spin_rate), '--capture-fps', '1000',
  ];
  if (pitch.axis_tilt !== null && efficiency !== null) {
    args.push('--axis-tilt-degrees', String(pitch.axis_tilt), '--spin-efficiency', String(efficiency), '--lock-axis-prior', '--gyro-sign', String(gyroSign));
  }
  await run('python3', args, { maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(await readFile(join(output, 'report.json'), 'utf8'));
}

const schoolCode = String(option('--school', 'ARIZONA')).trim().toUpperCase();
const limit = Math.max(1, Math.min(25, Number(option('--limit', '4')) || 4));
if (schoolCode !== 'ARIZONA') throw new Error('This sync currently supports ARIZONA only.');
const connectionString = process.env.DATABASE_URL || process.env.DASHBOARD_DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is not configured.');

const pool = new pg.Pool({ connectionString, max: 1 });
async function recordAttempt(pitchEventId, status, detail = null) {
  await pool.query(`
    INSERT INTO public.video_spin_fit_attempts (pitch_event_id, model_version, school_code, status, detail, attempted_at)
    VALUES ($1, $2, $3, $4, $5, NOW())
    ON CONFLICT (pitch_event_id, model_version) DO UPDATE SET
      status = EXCLUDED.status, detail = EXCLUDED.detail, attempted_at = NOW()
  `, [pitchEventId, MODEL_VERSION, schoolCode, status, detail]);
}

let processed = 0;
let accepted = 0;
let rejected = 0;
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS public.video_spin_fit_attempts (
      pitch_event_id BIGINT NOT NULL,
      model_version TEXT NOT NULL,
      school_code TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT,
      attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (pitch_event_id, model_version)
    )
  `);
  const result = await pool.query(`
    WITH pitches AS (
      SELECT DISTINCT ON (NULLIF(TRIM(pe.playid), ''))
        pe.id, NULLIF(TRIM(pe.playid), '') AS play_id,
        (regexp_match(COALESCE(pe.spinrate::text, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS spin_rate,
        pe.spinefficiency AS spin_efficiency,
        (regexp_match(COALESCE(pe.spinaxis3dtransverseangle::text, pe.releasetilt::text, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision AS axis_tilt,
        vm.cloudinary_url
      FROM public.pitch_events pe
      JOIN public.video_map_arizona vm
        ON vm.school_code = 'ARIZONA' AND NULLIF(TRIM(vm.play_id), '') = NULLIF(TRIM(pe.playid), '')
      LEFT JOIN public.video_spin_estimates vse
        ON vse.pitch_event_id = pe.id AND vse.model_version = $1 AND vse.status = 'accepted'
      LEFT JOIN public.video_spin_fit_attempts vfa
        ON vfa.pitch_event_id = pe.id AND vfa.model_version = $1
      WHERE pe.school_code = 'ARIZONA'
        AND NULLIF(TRIM(pe.playid), '') IS NOT NULL
        AND NULLIF(TRIM(vm.cloudinary_url), '') IS NOT NULL
        AND vse.pitch_event_id IS NULL
        AND vfa.pitch_event_id IS NULL
        AND (regexp_match(COALESCE(pe.spinrate::text, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1] IS NOT NULL
      ORDER BY NULLIF(TRIM(pe.playid), ''), pe.session_date DESC, pe.id DESC
    )
    SELECT * FROM pitches ORDER BY id DESC LIMIT $2
  `, [MODEL_VERSION, limit]);

  for (const pitch of result.rows) {
    processed += 1;
    const work = await mkdtemp(join(tmpdir(), `edger-${pitch.id}-`));
    try {
      const video = join(work, 'pitch.mov');
      await download(pitch.cloudinary_url, video);
      const candidates = [];
      for (const sign of [-1, 1]) {
        const output = join(work, `fit-${sign}`);
        try {
          const report = await fit(video, output, pitch, sign);
          if (report.camera_fit) candidates.push({ report, output });
        } catch (error) {
          console.warn(`pitch ${pitch.id}, gyro ${sign}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      candidates.sort((a, b) => Number(a.report.camera_fit.held_out_cost_px ?? Infinity) - Number(b.report.camera_fit.held_out_cost_px ?? Infinity));
      if (!candidates.length) throw new Error('no seam fit was produced');
      await run('node', [
        'scripts/import-edger-spin-estimate.mjs', '--pitch-event-id', String(pitch.id),
        '--report', join(candidates[0].output, 'report.json'), '--source-url', pitch.cloudinary_url,
      ], { env: process.env, maxBuffer: 2 * 1024 * 1024 });
      accepted += 1;
      await recordAttempt(pitch.id, 'accepted');
      console.log(`Accepted Arizona Edger seam fit for pitch_events.id=${pitch.id}`);
    } catch (error) {
      rejected += 1;
      const detail = error instanceof Error ? error.message : String(error);
      await recordAttempt(pitch.id, 'rejected', detail.slice(0, 2000));
      console.warn(`Skipped pitch_events.id=${pitch.id}: ${detail}`);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  console.log(JSON.stringify({ ok: true, schoolCode, candidates: result.rowCount, processed, accepted, rejected }));
} finally {
  await pool.end();
}
