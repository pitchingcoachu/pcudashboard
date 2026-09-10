export type DashboardMetricDomain = 'pitching' | 'hitting';

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
  'IZswing%', 'EdgeSwing%', 'PosSD%', 'Early%', 'Ahead%', 'E+A%', '1-1W%', 'InZone%', 'Comp%', 'QP%',
  'Whiff%', 'SwStrk%', 'K%', 'BB%', 'K-BB%', 'GB%', 'Barrel%', 'CSW%', 'EV', 'LA',
  'Stuff+', 'Command+', 'Ctrl+', 'QP+', 'RV/100', 'PV/100',
  'IP', 'H', 'XBH', 'HR', 'Barrels', 'BB', 'HBP', 'K', 'Whiffs', 'ERA', 'FIP', 'xFIP', 'SIERA', 'WHIP',
  'Fastball%', 'Sinker%', 'Cutter%', 'Slider%', 'Sweeper%', 'Curveball%', 'ChangeUp%', 'Splitter%',
  'FastSink%', 'Breaking%', 'Change/Split%', '2kFB%', '2kOS%',
  ...SEPARATION_COLUMNS,
] as const;

export const HITTING_TABLE_METRICS = [
  'P', 'PA', 'BF', 'AB', 'AVG', 'SLG', 'OBP', 'OPS', 'wOBA', 'xWOBA', 'ISO', 'xISO', 'BABIP',
  'H', 'XBH', 'HR', 'Barrels', 'BB', 'HBP', 'K', 'Whiffs',
  'InZone%', 'Strike%', 'Swing%', 'Swing Rate', 'FPS%', 'FPS(FB)%', 'FPS(OS)%', 'Called-S%', 'Take%',
  'Chase%', 'GoZoneSw%', 'IZswing%', 'EdgeSwing%', 'PosSD%', 'Early%', 'Ahead%', 'E+A%', '1-1W%',
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
  if (['Velo', 'Max', 'EV', 'Exit Velocity', 'BatSpeed'].includes(metric)) return `${metric} (mph)`;
  if (['IVB', 'xIVB', 'dIVB', 'HB', 'xHB', 'dHB'].includes(metric) || /(?:ivb|hb|tot)SEP$/i.test(metric)) return `${metric} (in)`;
  if (['Height', 'Side', 'Ext'].includes(metric)) return `${metric} (ft)`;
  if (['ITMissAvg', 'ITMissMed'].includes(metric)) return `${metric} (ft)`;
  if (metric === 'Spin') return 'Spin (rpm)';
  if (['MagAngle', 'VAA', 'nVAA', 'HAA', 'LA'].includes(metric)) return `${metric} (°)`;
  if (metric === 'SpinEff') return 'SpinEff (%)';
  if (['rTilt', 'bTilt', 'TiltDev'].includes(metric)) return `${metric} (clock)`;
  return metric;
}

export function metricSampleColumn(domain: DashboardMetricDomain, metricInput: string): 'P' | 'PA' {
  const metric = canonicalFlagMetric(metricInput);
  if (domain === 'hitting' && ['PA', 'AB', 'AVG', 'SLG', 'OBP', 'OPS', 'wOBA', 'xWOBA', 'ISO', 'xISO', 'BABIP', 'H', 'XBH', 'HR', 'BB', 'HBP', 'K', 'K%', 'BB%', 'K-BB%'].includes(metric)) return 'PA';
  return 'P';
}
