import { getDbPool } from '../lib/auth-db';
import { refreshBiomechanicsPerformanceRollups } from '../lib/biomechanics-rollups';
import {
  refreshOvrPerformanceRollups,
  refreshValdPerformanceRollups,
} from '../lib/performance-rollups';

function option(name: string, fallback = ''): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

async function refreshAxio(organizationId: number, schoolCode: string): Promise<void> {
  await getDbPool().query(
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_biomech_graph_cache_pitch_headers_date
     ON biomechanics_graph_cache (organization_id, school_code, captured_at DESC, source_file_hash)
     WHERE point_index = 0`
  );
  const bounds = await getDbPool().query<{ min_date: string | null; max_date: string | null }>(
    `SELECT MIN((COALESCE(captured_at,created_at) AT TIME ZONE 'America/Phoenix')::date)::text AS min_date,
            MAX((COALESCE(captured_at,created_at) AT TIME ZONE 'America/Phoenix')::date)::text AS max_date
     FROM biomechanics_pitch_rows WHERE organization_id=$1 AND school_code=$2`,
    [organizationId, schoolCode]
  );
  const minDate = bounds.rows[0]?.min_date;
  const maxDate = bounds.rows[0]?.max_date;
  if (!minDate || !maxDate) return;
  let cursor = new Date(`${minDate}T12:00:00Z`);
  const end = new Date(`${maxDate}T12:00:00Z`);
  while (cursor <= end) {
    const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + 13 * 86_400_000));
    const startDate = cursor.toISOString().slice(0, 10);
    const endDate = chunkEnd.toISOString().slice(0, 10);
    const started = Date.now();
    const rowCount = await refreshBiomechanicsPerformanceRollups({ organizationId, schoolCode, startDate, endDate });
    process.stdout.write(`AxioForce ${startDate}..${endDate}: ${rowCount} rollups in ${Date.now() - started} ms\n`);
    cursor = new Date(chunkEnd.getTime() + 86_400_000);
  }
}

async function main(): Promise<void> {
  const organizationId = Number(option('organization-id', '1'));
  const schoolCode = option('school-code', 'PCU').trim().toUpperCase();
  const source = option('source', 'all').trim().toLowerCase();
  if (!Number.isInteger(organizationId) || organizationId <= 0 || !schoolCode) throw new Error('Invalid organization or school code.');
  if (source === 'all' || source === 'axioforce') await refreshAxio(organizationId, schoolCode);
  if (source === 'all' || source === 'vald') {
    await getDbPool().query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_force_plate_metric_rows_daily_rollup
       ON force_plate_metric_rows (organization_id, school_code, date_time_utc, player_name_norm, test_type, metric_name, metric_unit)
       WHERE point_type = 'average'`
    );
    const bounds = await getDbPool().query<{ min_date: string | null; max_date: string | null }>(
      `SELECT MIN(date_time_utc::date)::text AS min_date,MAX(date_time_utc::date)::text AS max_date
       FROM force_plate_metric_rows WHERE organization_id=$1 AND school_code=$2 AND point_type='average'`,
      [organizationId, schoolCode]
    );
    const minDate = bounds.rows[0]?.min_date;
    const maxDate = bounds.rows[0]?.max_date;
    if (minDate && maxDate) {
      let cursor = new Date(`${minDate}T12:00:00Z`);
      const end = new Date(`${maxDate}T12:00:00Z`);
      while (cursor <= end) {
        const chunkEnd = new Date(Math.min(end.getTime(), cursor.getTime() + 30 * 86_400_000));
        const startDate = cursor.toISOString().slice(0, 10);
        const endDate = chunkEnd.toISOString().slice(0, 10);
        const started = Date.now();
        await refreshValdPerformanceRollups({ organizationId, schoolCode, startDate, endDate });
        process.stdout.write(`VALD ${startDate}..${endDate} refreshed in ${Date.now() - started} ms\n`);
        cursor = new Date(chunkEnd.getTime() + 86_400_000);
      }
    }
  }
  if (source === 'all' || source === 'ovr') {
    const started = Date.now();
    await refreshOvrPerformanceRollups({ organizationId, schoolCode });
    process.stdout.write(`OVR rollups refreshed in ${Date.now() - started} ms\n`);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
