'use client';

import { useEffect, useRef, useState } from 'react';

type TooltipState = {
  x: number;
  y: number;
  title: string;
  definition: string;
};

const STAT_DEFINITIONS: Record<string, string> = {
  '#': 'Total pitches in the current row group.',
  usage: 'Percent of all selected pitches represented by this row.',
  overall: 'Same as Usage, overall share of selected pitches.',
  bf: 'Batters faced.',
  velo: 'Average pitch velocity in mph.',
  max: 'Maximum pitch velocity in mph.',
  ivb: 'Average induced vertical break in inches.',
  hb: 'Average horizontal break in inches.',
  spin: 'Average spin rate in rpm.',
  rtilt: 'Average release tilt clock.',
  btilt: 'Average break tilt clock.',
  spineff: 'Spin efficiency percent.',
  magangle: 'Magnus line angle from horizontal. A horizontal line is 0° and a vertical line is 90°.',
  height: 'Average release height in feet.',
  side: 'Average release side in feet.',
  ext: 'Average extension in feet.',
  vaa: 'Average vertical approach angle.',
  haa: 'Average horizontal approach angle.',
  'strike%': 'Strikes per pitch.',
  'swing%': 'Swings per pitch.',
  'fps%': 'First pitch strike percentage.',
  'fps(fb)%': 'First pitch strike percentage on fastballs.',
  'fps(os)%': 'First pitch strike percentage on off-speed pitches.',
  'called-s%': 'Called strikes per pitch.',
  'take%': 'Takes per pitch.',
  'chase%': 'Out of zone swing percentage.',
  'gozonesw%': 'Swing percentage on pitches within 7 inches of center of strike zone, green square.',
  'izswing%': 'In zone swing percentage.',
  'edgeswing%': 'Swing percentage on edge pitches.',
  'possd%': 'Positive swing decision percentage.',
  'early%': 'BIP on 0-0, 1-0, 1-1, and 0-1 counts.',
  'ahead%': '0-2 or 1-2 count achieved.',
  'e+a%': 'Early% and Ahead% combined.',
  '1-1w%': 'Strike percentage on 1-1 counts.',
  'inzone%': 'Pitches in the strike zone.',
  'comp%': 'Pitches within 18 inches of center of strike zone.',
  'qp%': 'Quality pitch percentage.',
  'whiff%': 'Whiffs per swing.',
  'k%': 'Strikeouts per batter faced.',
  'bb%': 'Walks per batter faced.',
  'hr%': 'Home runs per batter faced.',
  'gb%': 'Ground ball percentage on balls in play.',
  'barrel%': 'Percentage of balls in play at 95 mph or higher and between 10 to 35 degrees.',
  'csw%': 'Called strikes plus whiffs per pitch.',
  ev: 'Average exit velocity in mph.',
  la: 'Average launch angle in degrees.',
  'stuff+': 'Proprietary pitch quality score.',
  'ctrl+': 'Proprietary command score.',
  'qp+': 'Proprietary quality of process score.',
  'pitching+': 'Composite pitching model score.',
  'rv/100': 'Run value per 100 pitches.',
  'pv/100': 'Pitch value per 100 pitches.',
  ip: 'Innings pitched.',
  p: 'Total pitches thrown.',
  'p/ip': 'Pitches per inning pitched.',
  'p/bf': 'Pitches per batter faced.',
  h: 'Hits.',
  '1b': 'Singles.',
  '2b': 'Doubles.',
  '3b': 'Triples.',
  hr: 'Home runs.',
  xbh: 'Extra base hits.',
  barrels: 'Barrel count.',
  bb: 'Walk count.',
  hbp: 'Hit by pitch count.',
  k: 'Strikeout count.',
  whiffs: 'Whiff count.',
  era: 'Earned run average.',
  fip: 'Fielding independent pitching.',
  xfip: 'Expected fielding independent pitching.',
  '0-0': 'Usage share in 0-0 counts.',
  behind: 'Usage share when behind in count.',
  even: 'Usage share in even counts.',
  ahead: 'Usage share when ahead in count.',
  '<2k': 'Usage share with fewer than two strikes.',
  '2k': 'Usage share with two strikes.',
  pa: 'Plate appearances.',
  ab: 'At bats.',
  avg: 'Batting average.',
  slg: 'Slugging percentage.',
  obp: 'On base percentage.',
  ops: 'On base plus slugging.',
  woba: 'Weighted on base average.',
  xwoba: 'Expected weighted on base average.',
  iso: 'Isolated power.',
  xiso: 'Expected isolated power.',
  babip: 'Batting average on balls in play.',
  swings: 'Swing count.',
  takes: 'Take count.',
  'called-s': 'Called strike count.',
  chases: 'Chase swing count.',
  izswings: 'In zone swing count.',
  fps: 'First pitch strike count.',
  edgeswings: 'Edge swing count.',
  possd: 'Positive swing decision points.',
  gozonesw: 'Go zone swing count.',
};

function normalizeHeaderLabel(value: string): string {
  return String(value ?? '')
    .replace(/[↑↓↕]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function keyForLabel(value: string): string {
  return normalizeHeaderLabel(value).toLowerCase().replace(/\s+/g, '');
}

function extractHeaderLabel(cell: HTMLElement): string {
  return normalizeHeaderLabel(cell.textContent ?? '');
}

export default function StatDefinitionTooltips() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const hoverCellRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const hideTooltip = () => {
      hoverCellRef.current = null;
      setTooltip(null);
    };

    const onMouseMove = (event: MouseEvent) => {
      const target = event.target as Element | null;
      const cell = target?.closest('th');
      if (!(cell instanceof HTMLElement)) {
        if (hoverCellRef.current) hideTooltip();
        return;
      }

      const label = extractHeaderLabel(cell);
      const definition = STAT_DEFINITIONS[keyForLabel(label)];
      if (!definition) {
        if (hoverCellRef.current) hideTooltip();
        return;
      }

      const nextX = event.clientX + 14;
      const nextY = event.clientY + 16;

      if (hoverCellRef.current !== cell) {
        hoverCellRef.current = cell;
        setTooltip({
          x: nextX,
          y: nextY,
          title: label,
          definition,
        });
        return;
      }

      if (tooltip) {
        setTooltip((current) => (current ? { ...current, x: nextX, y: nextY } : current));
      }
    };

    const onMouseDown = () => hideTooltip();
    const onScroll = () => hideTooltip();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hideTooltip();
    };

    document.addEventListener('mousemove', onMouseMove, { passive: true });
    document.addEventListener('mousedown', onMouseDown, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [tooltip]);

  if (!tooltip) return null;

  return (
    <div
      className="stat-definition-tooltip"
      style={{ left: tooltip.x, top: tooltip.y }}
      role="status"
      aria-live="polite"
    >
      <div className="stat-definition-tooltip-title">{tooltip.title}</div>
      <div>{tooltip.definition}</div>
    </div>
  );
}
