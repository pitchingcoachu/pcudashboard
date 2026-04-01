export type SharedXMetric = 'xWOBA' | 'xISO';

export type SharedHeatCell = {
  x: number;
  y: number;
  w: number;
  h: number;
  value: number;
  density: number;
};

type SharedPoint = {
  plate_side?: number | null;
  plate_height?: number | null;
  estimated_woba_using_speedangle?: number | null;
  iso_value?: number | null;
};

export function buildSharedXMetricHeatCells<T extends SharedPoint>(
  points: T[],
  metric: SharedXMetric
): SharedHeatCell[] {
  const xMin = -2.5;
  const xMax = 2.5;
  const yMin = 0;
  const yMax = 4.5;
  const cols = 40;
  const rows = 40;
  const cellW = (xMax - xMin) / cols;
  const cellH = (yMax - yMin) / rows;
  const sigmaX = 0.22;
  const sigmaY = 0.22;
  const eps = 1e-9;

  const valid = points
    .map((p) => ({
      p,
      x: typeof p.plate_side === 'number' && Number.isFinite(p.plate_side) ? p.plate_side : null,
      y: typeof p.plate_height === 'number' && Number.isFinite(p.plate_height) ? p.plate_height : null,
    }))
    .filter((row): row is { p: T; x: number; y: number } => row.x !== null && row.y !== null);
  if (!valid.length) return [];

  const xMetricShrinkStrength = 0;
  const globalXwobaRows = valid.filter(
    (row) =>
      typeof row.p.estimated_woba_using_speedangle === 'number' &&
      Number.isFinite(row.p.estimated_woba_using_speedangle)
  );
  const globalXisoRows = valid.filter(
    (row) =>
      typeof row.p.iso_value === 'number' &&
      Number.isFinite(row.p.iso_value)
  );
  const globalXwobaAvg =
    globalXwobaRows.length > 0
      ? globalXwobaRows.reduce((sum, row) => sum + Number(row.p.estimated_woba_using_speedangle || 0), 0) / globalXwobaRows.length
      : 0.35;
  const globalXisoAvg =
    globalXisoRows.length > 0
      ? globalXisoRows.reduce((sum, row) => sum + Number(row.p.iso_value || 0), 0) / globalXisoRows.length
      : 0.17;

  const cells: SharedHeatCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    const cy = yMin + (row + 0.5) * cellH;
    for (let col = 0; col < cols; col += 1) {
      const cx = xMin + (col + 0.5) * cellW;
      let sumW = 0;
      let xwobaWSum = 0;
      let xwobaW = 0;
      let xisoWSum = 0;
      let xisoW = 0;

      for (const rowPoint of valid) {
        const dx = (cx - rowPoint.x) / sigmaX;
        const dy = (cy - rowPoint.y) / sigmaY;
        const w = Math.exp(-0.5 * (dx * dx + dy * dy));
        if (w < 1e-6) continue;
        sumW += w;
        if (
          typeof rowPoint.p.estimated_woba_using_speedangle === 'number' &&
          Number.isFinite(rowPoint.p.estimated_woba_using_speedangle)
        ) {
          xwobaWSum += w * rowPoint.p.estimated_woba_using_speedangle;
          xwobaW += w;
        }
        if (
          typeof rowPoint.p.iso_value === 'number' &&
          Number.isFinite(rowPoint.p.iso_value)
        ) {
          xisoWSum += w * rowPoint.p.iso_value;
          xisoW += w;
        }
      }

      const value =
        metric === 'xWOBA'
          ? (xwobaW > eps
              ? (xwobaWSum + xMetricShrinkStrength * globalXwobaAvg) / Math.max(eps, xwobaW + xMetricShrinkStrength)
              : Number.NaN)
          : (xisoW > eps
              ? (xisoWSum + xMetricShrinkStrength * globalXisoAvg) / Math.max(eps, xisoW + xMetricShrinkStrength)
              : Number.NaN);
      cells.push({ x: xMin + col * cellW, y: yMin + row * cellH, w: cellW, h: cellH, value, density: sumW });
    }
  }

  return cells;
}

