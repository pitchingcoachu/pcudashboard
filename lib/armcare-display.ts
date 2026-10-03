export type ArmCareForceMode = 'force' | 'bw';

export function isArmCareForceMetric(metric: string): boolean {
  return /Strength|Force-Lbs|Max-Lbs|Primer/i.test(String(metric ?? ''));
}

export function armCareMetricUnit(metric: string, forceMode: ArmCareForceMode = 'force'): string {
  if (/%Fresh/i.test(metric)) return '%';
  if (/Shoulder Balance| RS$|SVR/i.test(metric)) return 'ratio';
  if (/ROM|TARC/i.test(metric)) return 'deg';
  if (/Velo/i.test(metric)) return 'mph';
  if (isArmCareForceMetric(metric)) return forceMode === 'bw' ? 'BW%' : 'lb';
  if (/Pitch Count|High Intent/i.test(metric)) return 'throws';
  if (/RPE|Arm Score/i.test(metric)) return 'score';
  return '';
}

export function armCareNumericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function armCareMetricValueForMode(
  metric: string,
  value: unknown,
  bodyWeightLb: number | null | undefined,
  forceMode: ArmCareForceMode,
): number | null {
  const numeric = armCareNumericValue(value);
  if (numeric === null) return null;
  if (forceMode !== 'bw' || !isArmCareForceMetric(metric)) return numeric;
  const weight = Number(bodyWeightLb);
  return Number.isFinite(weight) && weight > 0 ? (numeric / weight) * 100 : null;
}
