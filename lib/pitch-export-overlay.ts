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
// Fixed height for the horizontal panel variant (landscape+portrait pairs) --
// this panel's WIDTH varies with the video above it, its height is constant.
// 260 (up from an initial 200) gives the 2-row stat grid real room to
// breathe -- 200 packed the two rows so tight the labels/values visually
// overlapped (confirmed via a real export screenshot).
const HORIZONTAL_PANEL_HEIGHT = 260;

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
export function renderPitchExportOverlayPng(pitch: PitchExportMetrics, panelHeight: number, intendedTarget?: { data: IntendedTargetExportData; targetInches: number } | null): Buffer {
  const BASE_HEIGHT = 1120;
  const scale = Math.min(1, panelHeight / BASE_HEIGHT);
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

  // Both modes share one zone slot below the metrics and above the logo.
  // Cap the uniform scale by the panel width so tall videos cannot stretch it.
  const zoneScaleToFit = Math.min((PANEL_WIDTH - PAD_X * 2) / ZONE_W, 1.35 * scale);
  const zoneX = (PANEL_WIDTH - ZONE_W * zoneScaleToFit) / 2;
  if (intendedTarget) {
    parts.push(`<text x="${PANEL_WIDTH / 2}" y="${y - s(16)}" text-anchor="middle" font-family="Manrope" font-size="${s(18)}" font-weight="700" fill="${TEXT_STRONG}">Intended Target · ${intendedTarget.targetInches}&quot;</text>`);
  }
  parts.push(`<g transform="translate(${zoneX}, ${y}) scale(${zoneScaleToFit})">${intendedTarget ? buildIntendedTargetZoneSvg(intendedTarget.data) : buildZoneSvg(pitch)}</g>`);
  y += ZONE_H * zoneScaleToFit;
  if (intendedTarget) {
    const { data } = intendedTarget;
    const hasDistance = data.missDistanceFt !== null && Number.isFinite(data.missDistanceFt);
    const targetHit = hasDistance && data.missDistanceFt! <= data.targetRadiusFt;
    y += s(20);
    parts.push(`<text x="${PANEL_WIDTH / 2}" y="${y}" text-anchor="middle" font-family="Manrope" font-size="${s(19)}" font-weight="700" fill="${hasDistance ? (targetHit ? '#4ade80' : '#f87171') : TEXT_MUTED}">${hasDistance ? (targetHit ? 'TARGET HIT' : 'MISS') : 'NO LOCATION'}</text>`);
    y += s(26);
    parts.push(`<text x="${PANEL_WIDTH / 2}" y="${y}" text-anchor="middle" font-family="Manrope" font-size="${s(16)}" font-weight="500" fill="${TEXT_MUTED}">Miss distance: ${hasDistance ? (data.missDistanceFt! * 12).toFixed(1) + '&quot;' : '—'}</text>`);
  }
  y += s(30);

  const logoDataUri = getLogoDataUri();
  if (logoDataUri) {
    const logoSize = s(88);
    const logoX = PANEL_WIDTH / 2 - logoSize / 2;
    const logoY = Math.max(y, panelHeight - logoSize - s(28));
    parts.push(`<image href="${logoDataUri}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" />`);
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

/** Horizontal variant of renderPitchExportOverlayPng, used when a Combined
 * export pairs one landscape clip with one portrait clip: widening the
 * canvas to fit a side panel next to already-landscape-weighted video (like
 * the vertical panel does) would make the export excessively wide, so
 * instead the panel goes BELOW the side-by-side videos as a horizontal
 * strip, and the export grows taller instead of wider. Same content as the
 * vertical panel, rearranged left-to-right instead of top-to-bottom: name/
 * date/pitch-type on the left, all 10 stats as a compact grid in the
 * middle, strike-zone diagram + logo on the right. Panel WIDTH varies (it
 * always matches the video width above it); panel height is fixed
 * (BASE_HEIGHT below), the opposite scaling relationship from the vertical
 * panel (fixed width, varying height) -- so here a single `scale` factor
 * derived from panelWidth/BASE_WIDTH is applied to every font-size/position/
 * stroke-width number, and all Y-coordinates/heights are left unscaled. */
export function renderPitchExportOverlayHorizontalPng(
  pitch: PitchExportMetrics,
  panelWidth: number,
  intendedTarget?: { data: IntendedTargetExportData; targetInches: number } | null
): Buffer {
  const BASE_WIDTH = 1400;
  const scale = panelWidth / BASE_WIDTH;
  const s = (n: number) => n * scale;
  const PAD_Y = 28;

  const headerName = formatNameFirstLast(pitch.pitcher);
  const headerDate = formatShortDate(pitch.session_date);
  const headerBatter = pitch.batter ? `vs ${formatNameFirstLast(pitch.batter)}` : '';
  const pitchTypeColor = PITCH_COLORS[pitch.pitch_type] ?? '#9ca3af';

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

  const parts: string[] = [];
  const midY = HORIZONTAL_PANEL_HEIGHT / 2;

  // Left section: name + date pinned top-left (small, secondary -- just
  // identifying context), pitch type centered both horizontally AND
  // vertically in the remaining space below as the section's focal point
  // (large, bold, with its color-coded dot) -- per explicit request, rather
  // than three same-importance lines competing for center billing.
  const leftColWidth = s(230);
  const leftColCenter = leftColWidth / 2;
  const leftPadX = s(24);
  const leftMaxTextWidth = leftColWidth - leftPadX * 2;
  const nameFontSize = fitFontSize(headerName, 19, leftMaxTextWidth);
  const dateLine = `${headerDate}${headerBatter ? `  •  ${headerBatter}` : ''}`;
  const dateLineFontSize = fitFontSize(dateLine, 14, leftMaxTextWidth);
  parts.push(
    `<text x="${leftPadX}" y="${PAD_Y + s(16)}" font-family="Manrope" font-size="${nameFontSize}" font-weight="700" fill="${TEXT_STRONG}" letter-spacing="-0.3">${escapeXml(headerName)}</text>`
  );
  parts.push(
    `<text x="${leftPadX}" y="${PAD_Y + s(38)}" font-family="Manrope" font-size="${dateLineFontSize}" font-weight="500" fill="${TEXT_MUTED}">${escapeXml(dateLine)}</text>`
  );

  const pitchTypeCenterY = PAD_Y + s(48) + (HORIZONTAL_PANEL_HEIGHT - PAD_Y - s(48)) / 2;
  const pitchTypeFontSize = s(34);
  const pitchTypeWidth = pitch.pitch_type.length * pitchTypeFontSize * 0.6;
  const dotGap = s(14);
  const dotRadius = s(9);
  const pitchTypeGroupWidth = dotRadius * 2 + dotGap + pitchTypeWidth;
  const pitchTypeStartX = leftColCenter - pitchTypeGroupWidth / 2;
  parts.push(`<circle cx="${pitchTypeStartX + dotRadius}" cy="${pitchTypeCenterY}" r="${dotRadius}" fill="${pitchTypeColor}" />`);
  parts.push(
    `<text x="${pitchTypeStartX + dotRadius * 2 + dotGap}" y="${pitchTypeCenterY + s(12)}" font-family="Manrope" font-size="${pitchTypeFontSize}" font-weight="700" fill="${TEXT_STRONG}">${escapeXml(pitch.pitch_type)}</text>`
  );

  parts.push(`<line x1="${leftColWidth}" y1="${PAD_Y}" x2="${leftColWidth}" y2="${HORIZONTAL_PANEL_HEIGHT - PAD_Y}" stroke="${DIVIDER}" stroke-width="1.5" />`);

  // Middle section: all 10 stats as a single 5-wide x 2-row grid (denser
  // than the vertical panel's 2x5 -- this section is wide, not tall).
  const zoneColWidth = s(320);
  const midX = leftColWidth + s(28);
  const midWidth = BASE_WIDTH * scale - zoneColWidth - midX - s(20);
  const statCols = 5;
  const colWidth = midWidth / statCols;
  // rowGap is the label-baseline-to-label-baseline distance between the two
  // rows; valueOffset is how far below its OWN label's baseline each row's
  // value sits. Centering the block now properly accounts for the value
  // text's descent past row 2's label baseline (rowGap + valueOffset total),
  // not just rowGap alone -- the earlier version under-counted this and
  // pushed row 2 too close to the bottom edge (confirmed via a real export
  // screenshot). HORIZONTAL_PANEL_HEIGHT was also increased so this grid has
  // real room to breathe instead of being squeezed to fit. rowGap widened
  // further (88, up from 74) per explicit request for more clearance
  // specifically between row 1's values and row 2's labels.
  const rowGap = 88;
  const valueOffset = 26;
  const blockHeight = rowGap + valueOffset;
  const gridTop = midY - blockHeight / 2 + 8;
  stats.forEach((row, i) => {
    const col = i % statCols;
    const rowIdx = Math.floor(i / statCols);
    const colCenter = midX + col * colWidth + colWidth / 2;
    const cy = gridTop + rowIdx * rowGap;
    parts.push(
      `<text x="${colCenter}" y="${cy}" text-anchor="middle" font-family="Manrope" font-size="${s(13)}" font-weight="700" fill="${TEXT_LABEL}" letter-spacing="0.6">${escapeXml(row.label.toUpperCase())}</text>`
    );
    parts.push(
      `<text x="${colCenter}" y="${cy + s(valueOffset)}" text-anchor="middle" font-family="Manrope" font-size="${s(22)}" font-weight="700" fill="${ACCENT}">${escapeXml(row.value)}</text>`
    );
  });

  const zoneColX = BASE_WIDTH * scale - zoneColWidth;
  parts.push(`<line x1="${zoneColX}" y1="${PAD_Y}" x2="${zoneColX}" y2="${HORIZONTAL_PANEL_HEIGHT - PAD_Y}" stroke="${DIVIDER}" stroke-width="1.5" />`);

  // Give the zone nearly the full strip height, with the logo anchored
  // at the right edge. Center the zone in the space remaining to its left.
  const rightZoneW = intendedTarget ? IZ_ZONE_W : ZONE_W;
  const rightZoneH = intendedTarget ? IZ_ZONE_H : ZONE_H;
  const logoSize = s(48);
  const zoneGap = s(12);
  const logoX = panelWidth - s(12) - logoSize;
  const zoneStartX = zoneColX + s(12);
  const availableZoneWidth = logoX - zoneGap - zoneStartX;
  const zoneScaleToFit = Math.max(
    0.1,
    Math.min((HORIZONTAL_PANEL_HEIGHT - 16) / rightZoneH, availableZoneWidth / rightZoneW)
  );
  const zoneDrawnW = rightZoneW * zoneScaleToFit;
  const rightStartX = zoneStartX + (availableZoneWidth - zoneDrawnW) / 2;
  const zoneY = midY - (rightZoneH * zoneScaleToFit) / 2;
  const zoneSvgMarkup = intendedTarget ? buildIntendedTargetZoneSvg(intendedTarget.data) : buildZoneSvg(pitch);
  parts.push(`<g transform="translate(${rightStartX}, ${zoneY}) scale(${zoneScaleToFit})">${zoneSvgMarkup}</g>`);

  if (intendedTarget) {
    const distance = intendedTarget.data.missDistanceFt;
    const distanceLabel = distance !== null && Number.isFinite(distance)
      ? `${(distance * 12).toFixed(1)}"`
      : '—';
    const label = `Miss distance: ${distanceLabel}`;
    const fontSize = fitFontSize(label, Math.min(24, s(16)), availableZoneWidth);
    parts.push(`<text x="${rightStartX + zoneDrawnW / 2}" y="${HORIZONTAL_PANEL_HEIGHT - 14}" text-anchor="middle" font-family="Manrope" font-size="${fontSize}" font-weight="600" fill="${TEXT_MUTED}">${escapeXml(label)}</text>`);
  }

  const logoDataUri = getLogoDataUri();
  if (logoDataUri) {
    const logoY = midY - logoSize / 2;
    parts.push(`<image href="${logoDataUri}" x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" preserveAspectRatio="xMidYMid meet" />`);
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth}" height="${HORIZONTAL_PANEL_HEIGHT}" viewBox="0 0 ${panelWidth} ${HORIZONTAL_PANEL_HEIGHT}">
      <rect x="0" y="0" width="${panelWidth}" height="${HORIZONTAL_PANEL_HEIGHT}" fill="${PANEL_BG}" />
      ${parts.join('\n      ')}
    </svg>
  `;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: panelWidth },
    font: {
      loadSystemFonts: false,
      fontFiles: getFontFiles(),
      defaultFontFamily: 'Manrope',
    },
  });
  return resvg.render().asPng();
}

export type IntendedTargetExportData = {
  intendedSideFt: number;
  intendedHeightFt: number;
  targetRadiusFt: number;
  plateLocSide: number | null;
  plateLocHeight: number | null;
  missDistanceFt: number | null;
  pitchType: string | null;
};

// Match the web target diagram’s field coordinates, grid, and numbered
// pockets, using the regular export zone’s viewport so both modes fit alike.
const IZ_ZONE_W = ZONE_W;
const IZ_ZONE_H = ZONE_H;
const IZ_X_MIN = -2.5;
const IZ_X_MAX = 2.5;
const IZ_Y_MIN = 0;
const IZ_Y_MAX = 4.5;
const IZ_PAD = 10;
const IZ_SCALE = Math.min((IZ_ZONE_W - IZ_PAD * 2) / (IZ_X_MAX - IZ_X_MIN), (IZ_ZONE_H - IZ_PAD * 2) / (IZ_Y_MAX - IZ_Y_MIN));
const IZ_DRAWN_W = (IZ_X_MAX - IZ_X_MIN) * IZ_SCALE;
const IZ_DRAWN_H = (IZ_Y_MAX - IZ_Y_MIN) * IZ_SCALE;
const IZ_LEFT_PAD = (IZ_ZONE_W - IZ_DRAWN_W) / 2;
const IZ_TOP_PAD = (IZ_ZONE_H - IZ_DRAWN_H) / 2;
const izPx = (x: number) => IZ_LEFT_PAD + (x - IZ_X_MIN) * IZ_SCALE;
const izPy = (y: number) => IZ_TOP_PAD + (IZ_Y_MAX - y) * IZ_SCALE;
const IZ_STRIKE_LEFT = -0.88;
const IZ_STRIKE_RIGHT = 0.88;
const IZ_STRIKE_BOTTOM = 1.5;
const IZ_STRIKE_TOP = 3.6;
const IZ_STRIKE_CENTER_Y = (IZ_STRIKE_BOTTOM + IZ_STRIKE_TOP) / 2;

function buildIntendedTargetZoneSvg(pitch: IntendedTargetExportData): string {
  const targetX = izPx(pitch.intendedSideFt);
  const targetY = izPy(pitch.intendedHeightFt);
  const actualX = izPx(pitch.plateLocSide ?? 0);
  const actualY = izPy(pitch.plateLocHeight ?? 0);
  const dotColor = PITCH_COLORS[pitch.pitchType ?? 'Undefined'] ?? PITCH_COLORS.Undefined;

  const hasActual = pitch.plateLocSide !== null && Number.isFinite(pitch.plateLocSide)
    && pitch.plateLocHeight !== null && Number.isFinite(pitch.plateLocHeight);
  const grid = [1, 2].map((third) => `
    <line x1="${izPx(IZ_STRIKE_LEFT + (IZ_STRIKE_RIGHT - IZ_STRIKE_LEFT) * third / 3)}" y1="${izPy(IZ_STRIKE_TOP)}" x2="${izPx(IZ_STRIKE_LEFT + (IZ_STRIKE_RIGHT - IZ_STRIKE_LEFT) * third / 3)}" y2="${izPy(IZ_STRIKE_BOTTOM)}" stroke="#94a3b8" stroke-opacity="0.55" stroke-width="1" />
    <line x1="${izPx(IZ_STRIKE_LEFT)}" y1="${izPy(IZ_STRIKE_TOP - (IZ_STRIKE_TOP - IZ_STRIKE_BOTTOM) * third / 3)}" x2="${izPx(IZ_STRIKE_RIGHT)}" y2="${izPy(IZ_STRIKE_TOP - (IZ_STRIKE_TOP - IZ_STRIKE_BOTTOM) * third / 3)}" stroke="#94a3b8" stroke-opacity="0.55" stroke-width="1" />`).join('');
  const pockets = Array.from({ length: 9 }, (_, i) => ({
    number: i + 1,
    x: IZ_STRIKE_LEFT + (IZ_STRIKE_RIGHT - IZ_STRIKE_LEFT) * ((i % 3) + 0.5) / 3,
    y: IZ_STRIKE_TOP - (IZ_STRIKE_TOP - IZ_STRIKE_BOTTOM) * (Math.floor(i / 3) + 0.5) / 3,
  })).concat([
    { number: 10, x: -1.19, y: 3.825 }, { number: 11, x: 1.19, y: 3.825 },
    { number: 12, x: -1.19, y: 1.275 }, { number: 13, x: 1.19, y: 1.275 },
  ]).map(({ number, x, y }) => `<text x="${izPx(x)}" y="${izPy(y) + 3}" text-anchor="middle" font-family="Manrope" font-size="8" font-weight="700" fill="#94a3b8" fill-opacity="0.6">${number}</text>`).join('');

  return `
    <polygon points="${izPx(-0.75)},${izPy(0.55)} ${izPx(0.75)},${izPy(0.55)} ${izPx(0.75)},${izPy(0.65)} ${izPx(0)},${izPy(0.75)} ${izPx(-0.75)},${izPy(0.65)}" fill="none" stroke="#e2e8f0" stroke-width="3" stroke-opacity="0.75" />
    <rect x="${izPx(-1.5)}" y="${izPy(IZ_STRIKE_CENTER_Y + 1.5)}" width="${3 * IZ_SCALE}" height="${3 * IZ_SCALE}" fill="none" stroke="#94a3b8" stroke-opacity="0.28" stroke-width="2" />
    <rect x="${izPx(IZ_STRIKE_LEFT)}" y="${izPy(IZ_STRIKE_TOP)}" width="${izPx(IZ_STRIKE_RIGHT) - izPx(IZ_STRIKE_LEFT)}" height="${izPy(IZ_STRIKE_BOTTOM) - izPy(IZ_STRIKE_TOP)}" fill="rgba(15,23,42,0.28)" stroke="${ZONE_STROKE}" stroke-width="3" />
    <line x1="${izPx(-1.5)}" y1="${izPy(IZ_STRIKE_CENTER_Y)}" x2="${izPx(1.5)}" y2="${izPy(IZ_STRIKE_CENTER_Y)}" stroke="rgba(148,163,184,0.2)" />
    <line x1="${izPx(0)}" y1="${izPy(IZ_STRIKE_CENTER_Y - 1.5)}" x2="${izPx(0)}" y2="${izPy(IZ_STRIKE_CENTER_Y + 1.5)}" stroke="rgba(148,163,184,0.2)" />
    ${grid}${pockets}
    ${hasActual ? `<line x1="${targetX}" y1="${targetY}" x2="${actualX}" y2="${actualY}" stroke="rgba(226,232,240,0.55)" stroke-width="1.5" stroke-dasharray="5 4" />` : ''}
    <circle cx="${targetX}" cy="${targetY}" r="${Math.max(5, pitch.targetRadiusFt * IZ_SCALE)}" fill="rgba(74,222,128,0.17)" stroke="#4ade80" stroke-width="2.3" stroke-dasharray="5 4" />
    <circle cx="${targetX}" cy="${targetY}" r="3" fill="#86efac" />
    ${hasActual ? `<circle cx="${actualX}" cy="${actualY}" r="8" fill="${dotColor}" stroke="${ZONE_STROKE}" stroke-width="2" />` : ''}
  `;
}

export { PANEL_WIDTH as PITCH_EXPORT_PANEL_WIDTH, HORIZONTAL_PANEL_HEIGHT as PITCH_EXPORT_HORIZONTAL_PANEL_HEIGHT };
