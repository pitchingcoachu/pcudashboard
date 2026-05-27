import pg from 'pg';

const { Pool } = pg;

function toFinite(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePhase(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'loading') return 'loading';
  if (normalized === 'delivery') return 'delivery';
  return null;
}

function computeImpulseTime(points) {
  const isMoundDevice = (value) => {
    const normalized = String(value ?? '').toLowerCase();
    return normalized.includes('pitching mound.drive') || normalized.includes('pitching mound.parent');
  };
  const isParentDevice = (value) => String(value ?? '').toLowerCase().includes('pitching mound.parent');
  const isDriveDevice = (value) => String(value ?? '').toLowerCase().includes('pitching mound.drive');

  const phasePoints = points.filter((point) => normalizePhase(point.phase_name));
  const moundPoints = phasePoints.filter((point) => isMoundDevice(point.device_id));
  const hasParent = moundPoints.some((point) => isParentDevice(point.device_id));
  const sourcePoints = moundPoints.filter((point) => (hasParent ? isParentDevice(point.device_id) : isDriveDevice(point.device_id)));

  const rawTimes = sourcePoints.map((point) => toFinite(point.t)).filter((v) => v !== null);
  if (!rawTimes.length) return null;
  const minRawTime = Math.min(...rawTimes);
  const maxRawTime = Math.max(...rawTimes);
  const rawRange = maxRawTime - minRawTime;
  const treatAsMs = rawRange > 1000 || minRawTime > 100000;

  const normalizedPoints = sourcePoints
    .map((point) => {
      const rawT = toFinite(point.t);
      if (rawT === null) return null;
      const t = treatAsMs ? (rawT - minRawTime) / 1000 : (rawT - minRawTime);
      return {
        t,
        fy: toFinite(point.fy),
        fz: toFinite(point.fz),
        phase: normalizePhase(point.phase_name),
      };
    })
    .filter((point) => point !== null && point.phase !== null);

  const loading = normalizedPoints
    .filter((point) => point.phase === 'loading')
    .map((point) => ({ t: point.t, fy: point.fy, fz: point.fz }))
    .sort((a, b) => a.t - b.t);

  if (loading.length <= 2) return null;

  const maxBy = (arr) => arr.filter((r) => r.v !== null).reduce((best, row) => {
    if (row.v === null) return best;
    if (!best || row.v > best.v) return { t: row.t, v: row.v };
    return best;
  }, null);

  const peakFz = maxBy(loading.map((p) => ({ t: p.t, v: p.fz })));
  const peakZIdx = peakFz ? loading.findIndex((p) => p.t === peakFz.t && p.fz === peakFz.v) : -1;
  let startIdx = -1;
  if (peakZIdx > 1 && peakFz) {
    const peakTime = peakFz.t;
    const windowStartTime = peakTime - 0.7;
    const candidates = [];
    for (let i = 0; i < peakZIdx; i += 1) {
      const t = loading[i]?.t;
      if (t !== undefined && t >= windowStartTime) candidates.push(i);
    }
    if (candidates.length) {
      let minIdx = candidates[0] ?? 0;
      for (const idx of candidates) {
        const curr = loading[idx]?.fz;
        const best = loading[minIdx]?.fz;
        if (curr === null || curr === undefined) continue;
        if (best === null || best === undefined || curr < best) minIdx = idx;
      }
      startIdx = minIdx;
    }
  }
  if (startIdx < 0) return null;

  const peakFyFromStart = maxBy(loading.slice(startIdx).map((p) => ({ t: p.t, v: p.fy })));
  let endIdx = loading.length - 1;
  if (peakFyFromStart) {
    const peakIdx = loading.findIndex((p) => p.t === peakFyFromStart.t && p.fy === peakFyFromStart.v);
    if (peakIdx >= 0) {
      for (let i = peakIdx + 1; i < loading.length; i += 1) {
        const fy = loading[i]?.fy;
        if (fy !== null && fy <= 0) {
          endIdx = i;
          break;
        }
      }
    }
  }

  const startT = loading[startIdx]?.t ?? null;
  const endT = loading[endIdx]?.t ?? null;
  if (startT === null || endT === null) return null;
  return Math.max(0, endT - startT);
}

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL missing');
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

async function run() {
  const client = await pool.connect();
  try {
    const missing = await client.query(`
      SELECT organization_id, school_code, source_file_hash
      FROM biomechanics_pitch_metrics
      WHERE impulse_time IS NULL
      LIMIT 2000
    `);

    let updated = 0;
    let skipped = 0;

    for (const row of missing.rows) {
      const pointsRes = await client.query(`
        SELECT t, fy, fz, row_json
        FROM biomechanics_single_pitch_points
        WHERE organization_id = $1
          AND school_code = $2
          AND source_file_hash = $3
        ORDER BY point_index ASC
      `, [row.organization_id, row.school_code, row.source_file_hash]);

      const points = pointsRes.rows.map((p) => {
        const rj = p.row_json ?? {};
        return {
          t: toFinite(p.t) ?? 0,
          fy: toFinite(p.fy),
          fz: toFinite(p.fz),
          phase_name: rj['Phase Name'] ?? rj['Phase'] ?? null,
          device_id: rj['Device Id'] ?? rj['Device'] ?? null,
        };
      });

      const impulseTime = computeImpulseTime(points);
      if (impulseTime === null || !Number.isFinite(impulseTime)) {
        skipped += 1;
        continue;
      }

      const u = await client.query(`
        UPDATE biomechanics_pitch_metrics
        SET impulse_time = $4
        WHERE organization_id = $1
          AND school_code = $2
          AND source_file_hash = $3
      `, [row.organization_id, row.school_code, row.source_file_hash, impulseTime]);
      if ((u.rowCount ?? 0) > 0) updated += 1;
    }

    console.log(JSON.stringify({ missing_rows: missing.rowCount ?? 0, updated, skipped }, null, 2));
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error(String(e?.stack ?? e?.message ?? e));
  process.exit(1);
});
