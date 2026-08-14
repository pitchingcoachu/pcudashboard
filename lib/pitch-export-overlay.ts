import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { PitchExportMetrics } from './pitching-video-lookup';

// Mirrors pitching-suite.tsx's renderVideoPitchMetrics text fields and the
// action-modal strike-zone SVG (actionZonePx/actionZonePy geometry,
// actionStrikeLeft/Right/Top/Bottom, the compass ring) plus the dark-theme
// actionModalTheme colors and the Pearl logo shown below the zone diagram,
// so the exported video's side panel matches the modal look -- redesigned
// as a cleaner card layout (label/value pairs, section dividers) rather
// than a plain stacked list.

function fmtNum(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '-';
  return value.toFixed(digits);
}

function formatNameFirstLast(name: string): string {
  const normalized = (name || '').trim();
  if (!normalized) return '';
  const parts = normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts.slice(1).join(' ')} ${parts[0]}`.replace(/\s+/g, ' ').trim();
  return normalized;
}

function formatShortDate(value: string): string {
  const trimmed = (value || '').trim();
  const parts = trimmed.split('-');
  if (parts.length !== 3) return trimmed;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return trimmed;
  return `${month}/${day}/${String(year).slice(-2)}`;
}

function formatTiltClock(value: string | null | undefined): string {
  const raw = (value ?? '').trim();
  if (!raw) return '—';
  const colon = raw.match(/^(\d{1,2})\s*:\s*(\d{1,2})$/);
  if (colon) {
    const h = ((Number(colon[1]) - 1 + 12) % 12) + 1;
    const m = Math.max(0, Math.min(59, Number(colon[2])));
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  const dotClock = raw.match(/^(\d{1,2})\.(\d{1,2})$/);
  if (dotClock) {
    const h = ((Number(dotClock[1]) - 1 + 12) % 12) + 1;
    const m = Math.max(0, Math.min(59, Number(dotClock[2])));
    return `${h}:${String(m).padStart(2, '0')}`;
  }
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const deg = ((n % 360) + 360) % 360;
  const shifted = (deg + 180) % 360;
  const totalMinutes = Math.round((shifted / 360) * 720) % 720;
  const h = Math.floor(totalMinutes / 60) || 12;
  const m = totalMinutes % 60;
  return `${h}:${String(m).padStart(2, '0')}`;
}

function orientX(x: number, schoolCode: string): number {
  return schoolCode.toUpperCase() === 'PRO' ? -x : x;
}

// Matches pitchColors in pitching-suite.tsx, except Fastball -- the modal
// uses a CSS variable (--portal-fastball-color) that only resolves in a
// browser, so this uses that variable's actual color value instead.
const PITCH_COLORS: Record<string, string> = {
  Fastball: '#ef4444',
  Sinker: '#f97316',
  Cutter: '#a16207',
  Slider: '#dc2626',
  Sweeper: '#a855f7',
  Curveball: '#3b82f6',
  ChangeUp: '#16a34a',
  Splitter: '#2dd4bf',
  Knuckleball: '#1e3a8a',
  Undefined: '#9ca3af',
};

// Matches actionModalTheme's dark-mode values in pitching-suite.tsx (this
// export overlay always renders dark, regardless of the dashboard's
// light/dark toggle, since exported video is viewed outside the app).
const PANEL_BG = '#05070b';
const TEXT_STRONG = '#f8fafc';
const TEXT_MUTED = '#94a3b8';
const TEXT_LABEL = '#64748b';
const ACCENT = '#e2e8f0';
const DIVIDER = 'rgba(148,163,184,0.18)';
const ZONE_STROKE = '#f8fafc';

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

let cachedLogoDataUri: string | null = null;
function getLogoDataUri(): string {
  if (cachedLogoDataUri !== null) return cachedLogoDataUri;
  try {
    const logoPath = path.join(process.cwd(), 'public', 'pearl-clam-transparent.png');
    const base64 = readFileSync(logoPath).toString('base64');
    cachedLogoDataUri = `data:image/png;base64,${base64}`;
  } catch {
    cachedLogoDataUri = '';
  }
  return cachedLogoDataUri;
}

// Bundled font files rather than relying on loadSystemFonts -- the deploy
// environment (Vercel serverless) has no system fonts installed, which
// silently rendered blank/missing text in production even though it worked
// locally on macOS (confirmed: production exports showed the panel frame
// and colors but no readable stat/name text at all).
let cachedFontFiles: string[] | null = null;
function getFontFiles(): string[] {
  if (cachedFontFiles !== null) return cachedFontFiles;
  const fontDir = path.join(process.cwd(), 'assets', 'fonts');
  cachedFontFiles = ['Manrope-Medium.ttf', 'Manrope-Bold.ttf']
    .map((name) => path.join(fontDir, name))
    .filter((filePath) => {
      try {
        readFileSync(filePath);
        return true;
      } catch {
        return false;
      }
    });
  return cachedFontFiles;
}

// Strike-zone geometry, in "feet" units -- matches actionZonePx/actionZonePy
// and the strike-zone constants in pitching-suite.tsx exactly.
const ZONE_W = 240;
const ZONE_H = 260;
const ZONE_X_MIN = -2.5;
const ZONE_X_MAX = 2.5;
const ZONE_Y_MIN = 0;
const ZONE_Y_MAX = 4.5;
const ZONE_PAD = 10;
const ZONE_SCALE = Math.min((ZONE_W - ZONE_PAD * 2) / (ZONE_X_MAX - ZONE_X_MIN), (ZONE_H - ZONE_PAD * 2) / (ZONE_Y_MAX - ZONE_Y_MIN));
const ZONE_DRAWN_W = (ZONE_X_MAX - ZONE_X_MIN) * ZONE_SCALE;
const ZONE_DRAWN_H = (ZONE_Y_MAX - ZONE_Y_MIN) * ZONE_SCALE;
const ZONE_LEFT_PAD = (ZONE_W - ZONE_DRAWN_W) / 2;
const ZONE_TOP_PAD = (ZONE_H - ZONE_DRAWN_H) / 2;
const zonePx = (x: number) => ZONE_LEFT_PAD + (x - ZONE_X_MIN) * ZONE_SCALE;
const zonePy = (y: number) => ZONE_TOP_PAD + (ZONE_Y_MAX - y) * ZONE_SCALE;
const STRIKE_BOTTOM = 1.5;
const STRIKE_TOP = 3.6;
const STRIKE_LEFT = -0.88;
const STRIKE_RIGHT = 0.88;
const STRIKE_CENTER_X = (STRIKE_LEFT + STRIKE_RIGHT) / 2;
const STRIKE_CENTER_Y = (STRIKE_BOTTOM + STRIKE_TOP) / 2;
const COMP_RADIUS_FT = 1.5;
const COMP_BOTTOM = STRIKE_CENTER_Y - COMP_RADIUS_FT;
const COMP_TOP = STRIKE_CENTER_Y + COMP_RADIUS_FT;
const COMP_LEFT = STRIKE_CENTER_X - COMP_RADIUS_FT;
const COMP_RIGHT = STRIKE_CENTER_X + COMP_RADIUS_FT;

function buildZoneSvg(pitch: PitchExportMetrics): string {
  const plateX =
    typeof pitch.plate_side === 'number' && Number.isFinite(pitch.plate_side)
      ? zonePx(orientX(pitch.plate_side, pitch.school_code))
      : null;
  const plateY =
    typeof pitch.plate_height === 'number' && Number.isFinite(pitch.plate_height) ? zonePy(pitch.plate_height) : null;
  const dotColor = PITCH_COLORS[pitch.pitch_type] ?? '#9ca3af';

  const thirds = [1, 2].map(
    (i) =>
      `<line x1="${zonePx(STRIKE_LEFT + ((STRIKE_RIGHT - STRIKE_LEFT) * i) / 3)}" y1="${zonePy(STRIKE_BOTTOM)}" x2="${zonePx(STRIKE_LEFT + ((STRIKE_RIGHT - STRIKE_LEFT) * i) / 3)}" y2="${zonePy(STRIKE_TOP)}" stroke="${ZONE_STROKE}" stroke-width="3" stroke-opacity="0.55" />`
  );
  const hThirds = [1, 2].map(
    (i) =>
      `<line x1="${zonePx(STRIKE_LEFT)}" y1="${zonePy(STRIKE_BOTTOM + ((STRIKE_TOP - STRIKE_BOTTOM) * i) / 3)}" x2="${zonePx(STRIKE_RIGHT)}" y2="${zonePy(STRIKE_BOTTOM + ((STRIKE_TOP - STRIKE_BOTTOM) * i) / 3)}" stroke="${ZONE_STROKE}" stroke-width="3" stroke-opacity="0.55" />`
  );

  return `
    <polygon points="${zonePx(-0.75)},${zonePy(0.55)} ${zonePx(0.75)},${zonePy(0.55)} ${zonePx(0.75)},${zonePy(0.65)} ${zonePx(0)},${zonePy(0.75)} ${zonePx(-0.75)},${zonePy(0.65)}" fill="none" stroke="${ZONE_STROKE}" stroke-width="4" stroke-opacity="0.85" />
    <rect x="${zonePx(COMP_LEFT)}" y="${zonePy(COMP_TOP)}" width="${zonePx(COMP_RIGHT) - zonePx(COMP_LEFT)}" height="${zonePy(COMP_BOTTOM) - zonePy(COMP_TOP)}" fill="none" stroke="${ZONE_STROKE}" stroke-width="4" stroke-opacity="0.85" />
    <line x1="${zonePx(COMP_LEFT)}" y1="${zonePy(STRIKE_CENTER_Y)}" x2="${zonePx(STRIKE_LEFT)}" y2="${zonePy(STRIKE_CENTER_Y)}" stroke="${ZONE_STROKE}" stroke-width="3" stroke-opacity="0.85" />
    <line x1="${zonePx(STRIKE_RIGHT)}" y1="${zonePy(STRIKE_CENTER_Y)}" x2="${zonePx(COMP_RIGHT)}" y2="${zonePy(STRIKE_CENTER_Y)}" stroke="${ZONE_STROKE}" stroke-width="3" stroke-opacity="0.85" />
    <line x1="${zonePx(STRIKE_CENTER_X)}" y1="${zonePy(COMP_BOTTOM)}" x2="${zonePx(STRIKE_CENTER_X)}" y2="${zonePy(STRIKE_BOTTOM)}" stroke="${ZONE_STROKE}" stroke-width="3" stroke-opacity="0.85" />
    <line x1="${zonePx(STRIKE_CENTER_X)}" y1="${zonePy(STRIKE_TOP)}" x2="${zonePx(STRIKE_CENTER_X)}" y2="${zonePy(COMP_TOP)}" stroke="${ZONE_STROKE}" stroke-width="3" stroke-opacity="0.85" />
    <rect x="${zonePx(STRIKE_LEFT)}" y="${zonePy(STRIKE_TOP)}" width="${zonePx(STRIKE_RIGHT) - zonePx(STRIKE_LEFT)}" height="${zonePy(STRIKE_BOTTOM) - zonePy(STRIKE_TOP)}" fill="none" stroke="${ZONE_STROKE}" stroke-width="6" />
    ${thirds.join('\n    ')}
    ${hThirds.join('\n    ')}
    ${plateX !== null && plateY !== null ? `<circle cx="${plateX}" cy="${plateY}" r="11" fill="${dotColor}" stroke="${ZONE_STROKE}" stroke-width="2.5" />` : ''}
  `;
}

const PANEL_WIDTH = 320;
const PAD_X = 28;

/** Rough average-glyph-width heuristic for bold Arial/Helvetica (no real
 * text-measurement available server-side without a much heavier dependency)
 * -- shrinks font-size just enough that a long name/label fits within
 * maxWidth instead of clipping past the panel edge (confirmed: a longer
 * player name at the fixed base size overflowed off the right side of the
 * panel). Never scales up past baseSize, only down. */
function fitFontSize(text: string, baseSize: number, maxWidth: number, avgCharWidthRatio = 0.68): number {
  const estimatedWidth = text.length * baseSize * avgCharWidthRatio;
  if (estimatedWidth <= maxWidth) return baseSize;
  return Math.max(baseSize * (maxWidth / estimatedWidth), baseSize * 0.55);
}

type StatRow = { label: string; value: string };

/** Renders the same metrics + strike-zone location diagram shown in the
 * pitch video modal as a standalone PNG, sized to exactly PANEL_WIDTH x
 * panelHeight, for compositing as a side panel next to exported video.
 * Uses @resvg/resvg-js (SVG rasterization) rather than ffmpeg's drawtext
 * filter, since drawtext requires a font file and the deploy environment
 * isn't guaranteed to have one at a known path (confirmed: crashes with
 * "No font filename provided" when none is configured).
 *
 * Everything is laid out directly in panelHeight-native pixels (a single
 * `scale` factor computed from panelHeight/BASE_HEIGHT is applied to every
 * font-size/position/stroke-width number below) rather than drawing at a
 * fixed size and letting the SVG viewport stretch it -- non-uniform SVG
 * viewport scaling (preserveAspectRatio="none") distorts glyph shapes
 * (confirmed: produced visibly stretched-looking text), so this avoids
 * that entirely; the panel's pixel width never changes (always
 * PANEL_WIDTH), only the vertical scale of the content varies. */
export function renderPitchExportOverlayPng(pitch: PitchExportMetrics, panelHeight: number): Buffer {
  const BASE_HEIGHT = 1120;
  const scale = panelHeight / BASE_HEIGHT;
  const s = (n: number) => n * scale;

  const headerName = formatNameFirstLast(pitch.pitcher);
  const headerDate = formatShortDate(pitch.session_date);
  const headerBatter = pitch.batter ? `vs ${formatNameFirstLast(pitch.batter)}` : '';
  const pitchTypeColor = PITCH_COLORS[pitch.pitch_type] ?? '#9ca3af';

  // Row order: Velo/Spin, IVB/HB, rTilt/bTilt, Height/Side, Ext/Spin Eff --
  // per explicit requested layout. Units (mph/rpm) dropped from the value
  // text per request -- the label alone conveys what's being measured.
  const stats: StatRow[] = [
    { label: 'Velo', value: fmtNum(pitch.velo) },
    { label: 'Spin', value: fmtNum(pitch.spin, 0) },
    { label: 'IVB', value: `${fmtNum(pitch.ivb)} in` },
    { label: 'HB', value: `${fmtNum(pitch.hb)} in` },
    { label: 'rTilt', value: formatTiltClock(pitch.release_tilt) },
    { label: 'bTilt', value: formatTiltClock(pitch.break_tilt) },
    { label: 'Height', value: fmtNum(pitch.release_height) },
    {
      label: 'Side',
      value: typeof pitch.release_side === 'number' ? fmtNum(orientX(pitch.release_side, pitch.school_code)) : '-',
    },
    { label: 'Ext', value: fmtNum(pitch.extension) },
    {
      label: 'Spin Eff',
      value: pitch.spin_eff !== null ? `${fmtNum(pitch.spin_eff > 1 ? pitch.spin_eff : pitch.spin_eff * 100)}%` : '—',
    },
  ];

  // X-coordinates and X-extents (column widths, horizontal centers, the
  // zone/logo horizontal centering math) are deliberately left UNSCALED --
  // the panel's pixel WIDTH never changes (always PANEL_WIDTH, matching the
  // <svg> viewBox width below), only its height varies per clip. Only Y
  // positions, font-sizes, and stroke-widths use s() to grow/shrink with
  // panelHeight. Confirmed bug: an earlier version scaled every x-coordinate
  // by s() too (via s(PANEL_WIDTH), s(PAD_X), etc.) while the SVG's own
  // viewBox stayed at the unscaled PANEL_WIDTH -- that mismatch between the
  // coordinate system content was drawn in and the viewBox describing it
  // shifted everything (most visibly the strike-zone diagram) off-center by
  // a scale-dependent amount.
  let y = s(64);
  const parts: string[] = [];

  const nameFontSize = fitFontSize(headerName, 28, PANEL_WIDTH - PAD_X * 2);
  parts.push(
    `<text x="${PAD_X}" y="${y}" font-family="Manrope" font-size="${s(nameFontSize)}" font-weight="700" fill="${TEXT_STRONG}" letter-spacing="-0.3">${escapeXml(headerName)}</text>`
  );
  y += s(30);
  const dateLine = `${headerDate}${headerBatter ? `  •  ${headerBatter}` : ''}`;
  const dateLineFontSize = fitFontSize(dateLine, 20, PANEL_WIDTH - PAD_X * 2);
  parts.push(
    `<text x="${PAD_X}" y="${y}" font-family="Manrope" font-size="${s(dateLineFontSize)}" font-weight="500" fill="${TEXT_MUTED}">${escapeXml(dateLine)}</text>`
  );

  y += s(38);
  parts.push(`<line x1="${PAD_X}" y1="${y}" x2="${PANEL_WIDTH - PAD_X}" y2="${y}" stroke="${DIVIDER}" stroke-width="${s(1.5)}" />`);
  y += s(46);

  // Pitch type pill: colored dot + label, echoing the strike-zone dot color
  // so the pitch type reads as one consistent color-coded identity.
  parts.push(`<circle cx="${PAD_X + 7}" cy="${y - s(9)}" r="${s(7)}" fill="${pitchTypeColor}" />`);
  parts.push(
    `<text x="${PAD_X + 24}" y="${y}" font-family="Manrope" font-size="${s(26)}" font-weight="700" fill="${TEXT_STRONG}">${escapeXml(pitch.pitch_type)}</text>`
  );
  y += s(44);

  // Two-column label/value stat grid instead of a single stacked list --
  // denser, reads more like a real broadcast/scouting stat card. Label and
  // value are both center-anchored on the column's own midpoint (not
  // left-aligned at the same x) so a short value like "34.9%" sits centered
  // under a longer label like "SPIN EFF" instead of trailing off to one side.
  const colGap = 18;
  const colWidth = (PANEL_WIDTH - PAD_X * 2 - colGap) / 2;
  const rowHeight = s(58);
  stats.forEach((row, i) => {
    const col = i % 2;
    const rowIdx = Math.floor(i / 2);
    const colCenter = PAD_X + col * (colWidth + colGap) + colWidth / 2;
    const cy = y + rowIdx * rowHeight;
    parts.push(
      `<text x="${colCenter}" y="${cy}" text-anchor="middle" font-family="Manrope" font-size="${s(13)}" font-weight="700" fill="${TEXT_LABEL}" letter-spacing="0.6">${escapeXml(row.label.toUpperCase())}</text>`
    );
    parts.push(
      `<text x="${colCenter}" y="${cy + s(26)}" text-anchor="middle" font-family="Manrope" font-size="${s(22)}" font-weight="700" fill="${ACCENT}">${escapeXml(row.value)}</text>`
    );
  });
  y += Math.ceil(stats.length / 2) * rowHeight + s(20);

  parts.push(`<line x1="${PAD_X}" y1="${y}" x2="${PANEL_WIDTH - PAD_X}" y2="${y}" stroke="${DIVIDER}" stroke-width="${s(1.5)}" />`);
  y += s(56);

  // Zone diagram centered on the panel's true midline (PANEL_WIDTH / 2, not
  // offset by the diagram's own internal left-padding) so it reads as
  // centered within the panel column, not just within its own bounding box.
  // Only the zone's SIZE (zoneScaleToFit) grows with panelHeight; its
  // horizontal center position does not, since PANEL_WIDTH is fixed.
  const zoneScaleToFit = Math.min(1, (PANEL_WIDTH - PAD_X * 2) / ZONE_W) * 1.35 * scale;
  const zoneX = PANEL_WIDTH / 2 - (ZONE_W * zoneScaleToFit) / 2;
  const zoneY = y;
  parts.push(`<g transform="translate(${zoneX}, ${zoneY}) scale(${zoneScaleToFit})">${buildZoneSvg(pitch)}</g>`);
  y += ZONE_H * zoneScaleToFit + s(44);

  const logoDataUri = getLogoDataUri();
  if (logoDataUri) {
    const logoSize = s(88);
    const logoX = PANEL_WIDTH / 2 - logoSize / 2;
    parts.push(`<image href="${logoDataUri}" x="${logoX}" y="${y}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" />`);
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${PANEL_WIDTH}" height="${panelHeight}" viewBox="0 0 ${PANEL_WIDTH} ${panelHeight}">
      <rect x="0" y="0" width="${PANEL_WIDTH}" height="${panelHeight}" fill="${PANEL_BG}" />
      ${parts.join('\n      ')}
    </svg>
  `;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: PANEL_WIDTH },
    font: {
      loadSystemFonts: false,
      fontFiles: getFontFiles(),
      defaultFontFamily: 'Manrope',
    },
  });
  return resvg.render().asPng();
}

export { PANEL_WIDTH as PITCH_EXPORT_PANEL_WIDTH };
