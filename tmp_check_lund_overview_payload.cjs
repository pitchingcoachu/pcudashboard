const fs = require('fs');
const path = require('path');

const env = Object.fromEntries(
  fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('=');
      return index > 0 ? [line.slice(0, index), line.slice(index + 1)] : null;
    })
    .filter(Boolean)
);

const apiBase = env.DASHBOARD_API_BASE_URL || 'http://127.0.0.1:8001';

(async () => {
  const url = new URL(`${apiBase}/v1/pitching/overview`);
  url.searchParams.set('school_code', 'OSU');
  url.searchParams.set('start_date', '2026-03-13');
  url.searchParams.set('end_date', '2026-03-16');
  url.searchParams.set('pitcher', 'Lund, Ethan');
  url.searchParams.set('break_lines', 'Fastball');

  const response = await fetch(url.toString(), { cache: 'no-store' });
  const payload = await response.json();

  const chartPoints = Array.isArray(payload.chart_points) ? payload.chart_points : [];
  const hands = [...new Set(chartPoints.map((point) => String(point.pitcherthrows || '').trim()).filter(Boolean))];
  const pitchers = [...new Set(chartPoints.map((point) => String(point.pitcher || '').trim()).filter(Boolean))];

  console.log({
    status: response.status,
    totalChartPoints: chartPoints.length,
    hands,
    pitchers,
    sample: chartPoints.slice(0, 5).map((point) => ({
      pitcher: point.pitcher,
      pitcherthrows: point.pitcherthrows,
      pitch_type: point.pitch_type,
      hb: point.hb,
      ivb: point.ivb,
    })),
  });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
