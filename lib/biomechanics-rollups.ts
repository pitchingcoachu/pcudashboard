import { getBiomechanicsSnapshot } from './biomechanics-db';
import { buildAxioforceDailyRollups, replacePerformanceRollupRange } from './performance-rollups';

export async function refreshBiomechanicsPerformanceRollups(args: {
  organizationId: number;
  schoolCode: string;
  startDate: string;
  endDate: string;
}): Promise<number> {
  const bwSnapshot = await getBiomechanicsSnapshot({
    ...args,
    forceMode: 'bw',
    includeAllPitchValues: false,
    skipMissingMetricRecompute: true,
  });
  const forceSnapshot = await getBiomechanicsSnapshot({
    ...args,
    forceMode: 'force',
    includeAllPitchValues: false,
    skipMissingMetricRecompute: true,
  });
  const rows = [
    ...buildAxioforceDailyRollups(bwSnapshot.leaderboardIndividualRows, 'bw'),
    ...buildAxioforceDailyRollups(forceSnapshot.leaderboardIndividualRows, 'force'),
  ];
  await replacePerformanceRollupRange({ ...args, source: 'axioforce', rows });
  return rows.length;
}

export function biomechanicsDateRangeFromRows(rows: Array<Record<string, unknown>>): { startDate: string; endDate: string } | null {
  const dates: string[] = [];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      if (!/(?:capture|date|time)/i.test(key)) continue;
      const raw = String(value ?? '').trim();
      const iso = raw.match(/(20\d{2})-(\d{2})-(\d{2})/);
      const compact = raw.match(/(20\d{2})(\d{2})(\d{2})/);
      if (iso) dates.push(`${iso[1]}-${iso[2]}-${iso[3]}`);
      else if (compact) dates.push(`${compact[1]}-${compact[2]}-${compact[3]}`);
    }
  }
  dates.sort();
  return dates.length ? { startDate: dates[0], endDate: dates[dates.length - 1] } : null;
}
