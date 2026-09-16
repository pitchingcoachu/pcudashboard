import { getBiomechanicsSnapshot } from '../lib/biomechanics-db';

function option(name: string): string {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? '';
}

function parseDate(value: string, name: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`--${name}=YYYY-MM-DD is required`);
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid --${name}: ${value}`);
  }
  return date;
}

async function main(): Promise<void> {
  const organizationId = Number(option('organization-id'));
  const schoolCode = option('school-code').trim().toUpperCase();
  const start = parseDate(option('start-date'), 'start-date');
  const end = parseDate(option('end-date'), 'end-date');
  if (!Number.isInteger(organizationId) || organizationId <= 0 || !schoolCode) {
    throw new Error('--organization-id and --school-code are required');
  }
  if (start > end) throw new Error('Start date must not be after end date');

  // A month at a time bounds graph-cache reads and keeps this maintenance job
  // from competing with interactive requests over a multi-year range.
  let cursor = start;
  while (cursor <= end) {
    const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const chunkEnd = new Date(Math.min(end.getTime(), nextMonth.getTime() - 86400000));
    const from = cursor.toISOString().slice(0, 10);
    const to = chunkEnd.toISOString().slice(0, 10);
    const startedAt = Date.now();
    const snapshot = await getBiomechanicsSnapshot({
      organizationId,
      schoolCode,
      startDate: from,
      endDate: to,
      includeAllPitchValues: false,
    });
    process.stdout.write(`${from}..${to}: ${snapshot.pitchOptions.length} pitches; ${Date.now() - startedAt} ms\n`);
    cursor = new Date(chunkEnd.getTime() + 86400000);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
