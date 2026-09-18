export type DashboardMetricDomain = 'pitching' | 'hitting';

const FORCE_PLATE_METRIC_PREFIX = 'force_plate:';

export function forcePlateFlagMetric(metricName: string, metricUnit: string): string {
  return `${FORCE_PLATE_METRIC_PREFIX}${encodeURIComponent(metricName)}:${encodeURIComponent(metricUnit)}`;
}

export function parseForcePlateFlagMetric(metric: string): { metricName: string; metricUnit: string } | null {
  if (!metric.startsWith(FORCE_PLATE_METRIC_PREFIX)) return null;
  const encoded = metric.slice(FORCE_PLATE_METRIC_PREFIX.length);
  const separator = encoded.indexOf(':');
  if (separator < 0) return null;
  try {
    return {
      metricName: decodeURIComponent(encoded.slice(0, separator)),
      metricUnit: decodeURIComponent(encoded.slice(separator + 1)),
    };
  } catch {
    return null;
  }
}

const OVR_SPRINT_METRIC_PREFIX = 'ovr_sprint:';

export function ovrSprintFlagMetric(exercise: string, metric: 'totalTime' | 'speedMph'): string {
  return `${OVR_SPRINT_METRIC_PREFIX}${encodeURIComponent(exercise)}:${metric}`;
}

export function parseOvrSprintFlagMetric(metric: string): { exercise: string; metric: 'totalTime' | 'speedMph' } | null {
  if (!metric.startsWith(OVR_SPRINT_METRIC_PREFIX)) return null;
  const encoded = metric.slice(OVR_SPRINT_METRIC_PREFIX.length);
  const separator = encoded.lastIndexOf(':');
  if (separator < 0) return null;
  const metricPart = encoded.slice(separator + 1);
  if (metricPart !== 'totalTime' && metricPart !== 'speedMph') return null;
  try {
    return { exercise: decodeURIComponent(encoded.slice(0, separator)), metric: metricPart };
  } catch {
    return null;
  }
}

const BIOMECHANICS_METRIC_PREFIX = 'biomechanics:';

export function biomechanicsFlagMetric(column: string): string {
  return `${BIOMECHANICS_METRIC_PREFIX}${encodeURIComponent(column)}`;
}

export function parseBiomechanicsFlagMetric(metric: string): { column: string } | null {
  if (!metric.startsWith(BIOMECHANICS_METRIC_PREFIX)) return null;
  try {
    return { column: decodeURIComponent(metric.slice(BIOMECHANICS_METRIC_PREFIX.length)) };
  } catch {
    return null;
  }
}

const SEPARATION_COLUMNS = ['fb', 'si'].flatMap((base) =>
  ['CH', 'SP', 'CT', 'SL', 'CB', 'SW'].flatMap((pitch) => [
    `${base}${pitch}ivbSEP`,
    `${base}${pitch}hbSEP`,
    `${base}${pitch}totSEP`,
  ])
);

export const PITCHING_TABLE_METRICS = [
  'P', 'BF', 'P/IP', 'P/BF', 'Velo', 'Max', 'IVB', 'xIVB', 'dIVB', 'HB', 'xHB', 'dHB',
  'MagAngle', 'Spin', 'rTilt', 'bTilt', 'TiltDev', 'SpinEff', 'Height', 'Side', 'Ext', 'VAA', 'nVAA', 'HAA',
  'Strike%', 'Swing%', 'FPS%', 'FPS(FB)%', 'FPS(OS)%', 'Called-S%', 'Take%', 'Chase%', 'GoZoneSw%',
  'IZswing%', 'Z-Whiff%', 'EdgeSwing%', 'PosSD%', 'Early%', 'Ahead%', 'E+A%', '1-1W%', 'InZone%', 'Comp%', 'QP%',
  'Whiff%', 'SwStrk%', 'K%', 'BB%', 'K-BB%', 'GB%', 'Barrel%', 'CSW%', 'EV', 'LA',
  'Stuff+', 'Command+', 'Ctrl+', 'QP+', 'RV/100', 'PV/100',
  'ITMissAvg', 'ITMissMed',
  'IP', 'H', 'XBH', 'HR', 'Barrels', 'BB', 'HBP', 'K', 'Whiffs', 'ERA', 'FIP', 'xFIP', 'SIERA', 'WHIP',
  'Fastball%', 'Sinker%', 'Cutter%', 'Slider%', 'Sweeper%', 'Curveball%', 'ChangeUp%', 'Splitter%',
  'FastSink%', 'Breaking%', 'Change/Split%', '2kFB%', '2kOS%',
  ...SEPARATION_COLUMNS,
] as const;

export const HITTING_TABLE_METRICS = [
  'P', 'PA', 'BF', 'AB', 'AVG', 'SLG', 'OBP', 'OPS', 'wOBA', 'xWOBA', 'ISO', 'xISO', 'BABIP',
  'H', 'XBH', 'HR', 'Barrels', 'BB', 'HBP', 'K', 'Whiffs',
  'InZone%', 'Strike%', 'Swing%', 'Swing Rate', 'FPS%', 'FPS(FB)%', 'FPS(OS)%', 'Called-S%', 'Take%',
  'Chase%', 'GoZoneSw%', 'IZswing%', 'Z-Whiff%', 'EdgeSwing%', 'PosSD%', 'Early%', 'Ahead%', 'E+A%', '1-1W%',
  'Comp%', 'QP%', 'Whiff%', 'Whiff Rate', 'SwStrk%', 'K%', 'BB%', 'K-BB%', 'GB%', 'GB Rate',
  'Barrel%', 'CSW%', 'EV', 'Exit Velocity', 'LA', 'Stuff+', 'Ctrl+', 'QP+', 'RV/100', 'Run Values', 'PV/100',
] as const;

const LEGACY_TO_TABLE: Record<string, string> = {
  velocity: 'Velo',
  ivb: 'IVB',
  hb: 'HB',
  release_height: 'Height',
  release_side: 'Side',
  extension: 'Ext',
  spin_rate: 'Spin',
  exit_velocity: 'EV',
  launch_angle: 'LA',
  bat_speed: 'BatSpeed',
};

export function canonicalFlagMetric(metric: string): string {
  return LEGACY_TO_TABLE[String(metric ?? '').trim()] ?? String(metric ?? '').trim();
}

export function dashboardMetricOptions(domain: DashboardMetricDomain): string[] {
  return [...(domain === 'pitching' ? PITCHING_TABLE_METRICS : HITTING_TABLE_METRICS)];
}

export function dashboardMetricLabel(metricInput: string): string {
  const metric = canonicalFlagMetric(metricInput);
  const forcePlateMetric = parseForcePlateFlagMetric(metric);
  if (forcePlateMetric) return `${forcePlateMetric.metricName}${forcePlateMetric.metricUnit ? ` (${forcePlateMetric.metricUnit})` : ''}`;
  const ovrSprintMetric = parseOvrSprintFlagMetric(metric);
  if (ovrSprintMetric) return `${ovrSprintMetric.exercise} — ${ovrSprintMetric.metric === 'speedMph' ? 'Total Speed' : 'Total Time'}`;
  const biomechanicsMetric = parseBiomechanicsFlagMetric(metric);
  if (biomechanicsMetric) return biomechanicsMetric.column;
  if (['Velo', 'Max', 'EV', 'Exit Velocity', 'BatSpeed'].includes(metric)) return `${metric} (mph)`;
  if (['IVB', 'xIVB', 'dIVB', 'HB', 'xHB', 'dHB'].includes(metric) || /(?:ivb|hb|tot)SEP$/i.test(metric)) return `${metric} (in)`;
  if (['Height', 'Side', 'Ext'].includes(metric)) return `${metric} (ft)`;
  if (metric === 'ITMissAvg') return 'Average Miss Distance (in)';
  if (metric === 'ITMissMed') return 'Median Miss Distance (in)';
  if (metric === 'IZswing%') return 'Z-Swing%';
  if (metric === 'Spin') return 'Spin (rpm)';
  if (['MagAngle', 'VAA', 'nVAA', 'HAA', 'LA'].includes(metric)) return `${metric} (°)`;
  if (metric === 'SpinEff') return 'SpinEff (%)';
  if (['rTilt', 'bTilt', 'TiltDev'].includes(metric)) return `${metric} (clock)`;
  return metric;
}

export function forcePlateDisplayUnit(unitInput: string): string {
  const unit = String(unitInput ?? '').trim();
  if (/^Newton Per Second Per Kilo$/i.test(unit)) return 'N/(s·kg)';
  return unit;
}

export function formatForcePlateMetricValue(metric: string, value: unknown): string {
  const parsedMetric = parseForcePlateFlagMetric(metric);
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!parsedMetric || !Number.isFinite(numericValue)) return value === null || value === undefined || value === '' ? '—' : String(value);
  return numericValue.toFixed(1);
}

export function metricSampleColumn(domain: DashboardMetricDomain, metricInput: string): 'P' | 'PA' {
  const metric = canonicalFlagMetric(metricInput);
  if (domain === 'hitting' && ['PA', 'AB', 'AVG', 'SLG', 'OBP', 'OPS', 'wOBA', 'xWOBA', 'ISO', 'xISO', 'BABIP', 'H', 'XBH', 'HR', 'BB', 'HBP', 'K', 'K%', 'BB%', 'K-BB%'].includes(metric)) return 'PA';
  return 'P';
}
