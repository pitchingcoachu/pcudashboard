'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import LEVEL_AVERAGES from './stuff2-level-averages.json';
import BASE_REFERENCES from './stuff2-base-references.json';

type PitchType = 'Fastball' | 'Sinker' | 'Cutter' | 'Slider' | 'Sweeper' | 'Curveball' | 'ChangeUp' | 'Splitter';
type Level = 'D1' | 'D2' | 'D3' | 'JUCO' | 'NAIA' | 'AAA' | 'MLB';
type Hand = 'Right' | 'Left';
type BatterHand = 'Right' | 'Left' | 'All';

const PITCH_TYPES: PitchType[] = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter'];
const OFFSPEED_TYPES = new Set<PitchType>(['Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter']);
const LEVELS: Level[] = ['D1', 'D2', 'D3', 'JUCO', 'NAIA', 'AAA', 'MLB'];

// Real level/pitch-type averages (right-handed pitchers), computed from the
// same training data Stuff+ 2.0 was trained on -- see
// dashboard_api/stuff2_training/. Used as the control panel's starting
// values so the grid opens centered on "an average pitch of this type at
// this level," which is what actually produces a full blue-to-red spread
// across the honeycomb -- an arbitrary round-number default (e.g. a flat
// 92mph fastball) is usually already above average and paints the whole
// grid one color.
type LevelAverageEntry = {
  relSpeed: number;
  ivb: number;
  hb: number;
  spinRate: number | null;
  extension: number | null;
  relHeight: number | null;
  relSide: number | null;
};
type BaseReferenceShape = { relSpeed: number; ivb: number; hb: number };
type BaseReferenceEntry = { fastball?: BaseReferenceShape; sinker?: BaseReferenceShape };

const LEVEL_AVERAGES_TYPED = LEVEL_AVERAGES as Record<PitchType, Record<Level, LevelAverageEntry>>;
const BASE_REFERENCES_TYPED = BASE_REFERENCES as Partial<Record<PitchType, Record<Level, BaseReferenceEntry>>>;

const IVB_MIN = -20;
const IVB_MAX = 25;
const HB_MIN = -25;
const HB_MAX = 25;

// Row/column counts for a TRUE offset hex tiling (odd rows shifted by half
// a column width, like real honeycomb/hexbin plots -- a plain rectangular
// lattice of hexes just looks like a grid, no matter how small the cells
// are). Chosen dense enough to read as a smooth blob rather than
// discrete tiles, while staying under the backend's cell cap.
const IVB_ROWS = 70;
const HB_COLS = 78;

function buildHexCenters(): { ivb: number; hb: number; row: number; col: number }[] {
  const centers: { ivb: number; hb: number; row: number; col: number }[] = [];
  const ivbStep = (IVB_MAX - IVB_MIN) / IVB_ROWS;
  const hbStep = (HB_MAX - HB_MIN) / HB_COLS;
  for (let row = 0; row <= IVB_ROWS; row++) {
    const rowOffset = row % 2 === 1 ? hbStep / 2 : 0;
    const colCount = row % 2 === 1 ? HB_COLS : HB_COLS + 1;
    for (let col = 0; col < colCount; col++) {
      const hb = HB_MIN + rowOffset + col * hbStep;
      if (hb < HB_MIN - 1e-9 || hb > HB_MAX + 1e-9) continue;
      const ivb = IVB_MIN + row * ivbStep;
      centers.push({ ivb: Math.round(ivb * 100) / 100, hb: Math.round(hb * 100) / 100, row, col });
    }
  }
  return centers;
}

const HEX_CENTERS = buildHexCenters();
const HEX_PAIRS = HEX_CENTERS.map((c) => [c.ivb, c.hb]);

type GridCell = { ivb: number; hb: number; stuff2: number | null };

// Diverging scale anchored at 100 (the "100 = average" convention used
// everywhere else in this codebase -- see comparison-tool-suite.tsx's
// Stuff+ 2.0 thresholds), poor=blue, average=white, great=red per the
// user's explicit color request (inverted from the usual red=bad).
function colorForScore(score: number | null): string {
  if (score === null) return 'rgba(255,255,255,0)';
  const poor = 90;
  const great = 110;
  if (score <= poor) return 'rgb(33, 90, 210)'; // blue
  if (score >= great) return 'rgb(196, 30, 30)'; // red
  if (score < 100) {
    const t = (score - poor) / (100 - poor); // 0..1, blue -> white
    return lerpColor([33, 90, 210], [255, 255, 255], t);
  }
  const t = (score - 100) / (great - 100); // 0..1, white -> red
  return lerpColor([255, 255, 255], [196, 30, 30], t);
}

function lerpColor(a: number[], b: number[], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bch = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r}, ${g}, ${bch})`;
}

function hexPoints(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30);
    pts.push(`${cx + r * Math.cos(angle)},${cy + r * Math.sin(angle)}`);
  }
  return pts.join(' ');
}

type FetchState = 'idle' | 'loading' | 'ready' | 'error';

const DEFAULT_PITCH_TYPE: PitchType = 'Fastball';
const DEFAULT_LEVEL: Level = 'D1';

export default function StuffPlusSuite() {
  const [pitchType, setPitchType] = useState<PitchType>(DEFAULT_PITCH_TYPE);
  const [level, setLevel] = useState<Level>(DEFAULT_LEVEL);
  const [pitcherHand, setPitcherHand] = useState<Hand>('Right');
  const [batterHand, setBatterHand] = useState<BatterHand>('All');

  const initialAvg = LEVEL_AVERAGES_TYPED[DEFAULT_PITCH_TYPE][DEFAULT_LEVEL];
  const [relSpeed, setRelSpeed] = useState(String(initialAvg.relSpeed));
  const [spinRate, setSpinRate] = useState(initialAvg.spinRate !== null ? String(initialAvg.spinRate) : '');
  const [extension, setExtension] = useState(initialAvg.extension !== null ? String(initialAvg.extension) : '');
  const [relHeight, setRelHeight] = useState(initialAvg.relHeight !== null ? String(initialAvg.relHeight) : '');
  const [relSide, setRelSide] = useState(initialAvg.relSide !== null ? String(initialAvg.relSide) : '');

  const [baseFbVelo, setBaseFbVelo] = useState('92');
  const [baseFbIvb, setBaseFbIvb] = useState('15');
  const [baseFbHb, setBaseFbHb] = useState('10');
  const [baseSiVelo, setBaseSiVelo] = useState('91');
  const [baseSiIvb, setBaseSiIvb] = useState('7');
  const [baseSiHb, setBaseSiHb] = useState('15');

  // Re-fill the pitch-shape inputs (and, for off-speed types, the
  // reference Fastball/Sinker base) from real level averages whenever
  // pitch type or level changes -- keeps the grid centered on "an average
  // pitch of this type/level" by default instead of carrying over a
  // shape that no longer matches the new selection.
  useEffect(() => {
    const avg = LEVEL_AVERAGES_TYPED[pitchType]?.[level];
    if (avg) {
      setRelSpeed(String(avg.relSpeed));
      setSpinRate(avg.spinRate !== null ? String(avg.spinRate) : '');
      setExtension(avg.extension !== null ? String(avg.extension) : '');
      setRelHeight(avg.relHeight !== null ? String(avg.relHeight) : '');
      setRelSide(avg.relSide !== null ? String(avg.relSide) : '');
    }
    const baseRef = BASE_REFERENCES_TYPED[pitchType]?.[level];
    if (baseRef?.fastball) {
      setBaseFbVelo(String(baseRef.fastball.relSpeed));
      setBaseFbIvb(String(baseRef.fastball.ivb));
      setBaseFbHb(String(baseRef.fastball.hb));
    }
    if (baseRef?.sinker) {
      setBaseSiVelo(String(baseRef.sinker.relSpeed));
      setBaseSiIvb(String(baseRef.sinker.ivb));
      setBaseSiHb(String(baseRef.sinker.hb));
    }
  }, [pitchType, level]);

  const [cells, setCells] = useState<GridCell[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [errorText, setErrorText] = useState('');
  const [hoverCell, setHoverCell] = useState<GridCell | null>(null);

  const isOffspeed = OFFSPEED_TYPES.has(pitchType);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestBody = useMemo(() => {
    const body: Record<string, unknown> = {
      pitch_type: pitchType,
      level,
      is_lefty: pitcherHand === 'Left',
      batter_hand: batterHand === 'All' ? null : batterHand,
      rel_speed: Number(relSpeed),
      spin_rate: spinRate ? Number(spinRate) : null,
      ext_value: extension ? Number(extension) : null,
      rel_height: relHeight ? Number(relHeight) : null,
      rel_side: relSide ? Number(relSide) : null,
      pairs: HEX_PAIRS,
    };
    if (isOffspeed) {
      body.base_fastball = {
        rel_speed: baseFbVelo ? Number(baseFbVelo) : null,
        ivb: baseFbIvb ? Number(baseFbIvb) : null,
        hb_adj: baseFbHb ? Number(baseFbHb) : null,
      };
      body.base_sinker = {
        rel_speed: baseSiVelo ? Number(baseSiVelo) : null,
        ivb: baseSiIvb ? Number(baseSiIvb) : null,
        hb_adj: baseSiHb ? Number(baseSiHb) : null,
      };
    }
    return body;
  }, [
    pitchType, level, pitcherHand, batterHand, relSpeed, spinRate, extension, relHeight, relSide,
    isOffspeed, baseFbVelo, baseFbIvb, baseFbHb, baseSiVelo, baseSiIvb, baseSiHb,
  ]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!Number.isFinite(Number(relSpeed)) || !relSpeed.trim()) return;
    debounceRef.current = setTimeout(() => {
      const controller = new AbortController();
      setFetchState('loading');
      setErrorText('');
      fetch('/api/dashboard/pitching/stuff2-grid', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      })
        .then(async (response) => {
          const payload = (await response.json().catch(() => ({}))) as { cells?: GridCell[]; error?: string };
          if (!response.ok) throw new Error(payload.error || 'Failed to compute grid.');
          setCells(Array.isArray(payload.cells) ? payload.cells : []);
          setFetchState('ready');
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setErrorText(error instanceof Error ? error.message : 'Failed to compute grid.');
          setFetchState('error');
        });
      return () => controller.abort();
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestBody]);

  const width = 720;
  const height = 620;
  const marginLeft = 60;
  const marginBottom = 50;
  const marginTop = 20;
  const marginRight = 20;
  const plotWidth = width - marginLeft - marginRight;
  const plotHeight = height - marginTop - marginBottom;
  // Hex sizing: fit HB_COLS across the width and IVB_ROWS down the height,
  // with a slight overlap factor (1.02) so adjacent hexes' edges touch/
  // slightly overlap rather than leaving visible gaps -- this is what
  // makes a dense offset tiling read as a smooth blob instead of a
  // speckled grid.
  const hexRadius = Math.min(plotWidth / HB_COLS, plotHeight / IVB_ROWS) * 0.66;

  function xForHb(hb: number): number {
    return marginLeft + ((hb - HB_MIN) / (HB_MAX - HB_MIN)) * plotWidth;
  }
  function yForIvb(ivb: number): number {
    // IVB increases upward.
    return marginTop + (1 - (ivb - IVB_MIN) / (IVB_MAX - IVB_MIN)) * plotHeight;
  }

  return (
    <section className="portal-panel portal-admin-panel" style={{ padding: '1rem' }}>
      <h3>Stuff+ Calculator</h3>
      <p className="portal-muted-text" style={{ marginTop: '-0.4rem' }}>
        Stuff+ honeycomb — set a pitch shape below, hover the grid to see what the score would be at each IVB/HB combination.
      </p>
      <div className="portal-admin-grid" style={{ gridTemplateColumns: 'minmax(320px, 380px) 1fr', gap: 16, alignItems: 'start' }}>
        <article className="portal-day-card">
          <h4 style={{ marginTop: 0 }}>Pitch Shape</h4>
          <div className="portal-form-grid" style={{ gridTemplateColumns: '1fr' }}>
            <label>
              Pitch Type
              <select value={pitchType} onChange={(event) => setPitchType(event.target.value as PitchType)}>
                {PITCH_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Level
              <select value={level} onChange={(event) => setLevel(event.target.value as Level)}>
                {LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Pitcher Hand
              <select value={pitcherHand} onChange={(event) => setPitcherHand(event.target.value === 'Left' ? 'Left' : 'Right')}>
                <option value="Right">Right</option>
                <option value="Left">Left</option>
              </select>
            </label>
            <label>
              Batter Hand
              <select value={batterHand} onChange={(event) => setBatterHand(event.target.value as BatterHand)}>
                <option value="All">All</option>
                <option value="Right">Right</option>
                <option value="Left">Left</option>
              </select>
            </label>
            <label>
              Velocity (mph)
              <input type="number" min={60} max={110} step={0.1} value={relSpeed} onChange={(event) => setRelSpeed(event.target.value)} />
            </label>
            <label>
              Spin Rate (rpm)
              <input type="number" min={0} max={4000} step={10} value={spinRate} onChange={(event) => setSpinRate(event.target.value)} />
            </label>
            <label>
              Extension (ft)
              <input type="number" min={4} max={8} step={0.1} value={extension} onChange={(event) => setExtension(event.target.value)} />
            </label>
            <label>
              Release Height (ft)
              <input type="number" min={3.5} max={7.5} step={0.1} value={relHeight} onChange={(event) => setRelHeight(event.target.value)} />
            </label>
            <label>
              Release Side (ft)
              <input type="number" min={-4} max={4} step={0.1} value={relSide} onChange={(event) => setRelSide(event.target.value)} />
            </label>
            {isOffspeed ? (
              <>
                <hr style={{ width: '100%', borderColor: 'rgba(255,255,255,0.16)', margin: '0.2rem 0' }} />
                <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>
                  Reference Fastball/Sinker (needed to score off-speed separation)
                </div>
                <label>
                  FB Velo (mph)
                  <input type="number" step={0.1} value={baseFbVelo} onChange={(event) => setBaseFbVelo(event.target.value)} />
                </label>
                <label>
                  FB IVB (in)
                  <input type="number" step={0.1} value={baseFbIvb} onChange={(event) => setBaseFbIvb(event.target.value)} />
                </label>
                <label>
                  FB HB (in)
                  <input type="number" step={0.1} value={baseFbHb} onChange={(event) => setBaseFbHb(event.target.value)} />
                </label>
                <label>
                  SI Velo (mph)
                  <input type="number" step={0.1} value={baseSiVelo} onChange={(event) => setBaseSiVelo(event.target.value)} />
                </label>
                <label>
                  SI IVB (in)
                  <input type="number" step={0.1} value={baseSiIvb} onChange={(event) => setBaseSiIvb(event.target.value)} />
                </label>
                <label>
                  SI HB (in)
                  <input type="number" step={0.1} value={baseSiHb} onChange={(event) => setBaseSiHb(event.target.value)} />
                </label>
              </>
            ) : null}
          </div>
          {hoverCell ? (
            <div style={{ marginTop: '0.8rem' }}>
              <h2 style={{ margin: 0 }}>Stuff+: {hoverCell.stuff2 !== null ? hoverCell.stuff2.toFixed(1) : '—'}</h2>
              <div className="portal-muted-text">IVB {hoverCell.ivb.toFixed(1)}&quot; &middot; HB {hoverCell.hb.toFixed(1)}&quot;</div>
            </div>
          ) : (
            <div className="portal-muted-text" style={{ marginTop: '0.8rem' }}>Hover the grid to see a score.</div>
          )}
          {fetchState === 'error' ? <div style={{ color: '#f87171', marginTop: '0.5rem' }}>{errorText}</div> : null}
        </article>

        <article className="portal-day-card" style={{ position: 'relative' }}>
          <h4 style={{ marginTop: 0 }}>Movement Plot</h4>
          {fetchState === 'loading' ? (
            <div className="portal-muted-text" style={{ position: 'absolute', top: 12, right: 16 }}>Updating…</div>
          ) : null}
          <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
            <defs>
              <clipPath id="stuff2-grid-clip">
                <rect x={marginLeft} y={marginTop} width={plotWidth} height={plotHeight} />
              </clipPath>
            </defs>

            {/* plot background so the hex fill has a defined frame, matching
                the bordered-panel look of a real movement plot instead of
                floating loose on the page background */}
            <rect x={marginLeft} y={marginTop} width={plotWidth} height={plotHeight} fill="rgba(255,255,255,0.03)" />

            {/* hex cells, clipped to the plot's rectangular frame so the
                jagged offset-tiling edge never pokes outside the axes */}
            <g clipPath="url(#stuff2-grid-clip)">
              {HEX_CENTERS.map((center, i) => {
                const cell = cells[i] ?? null;
                const cx = xForHb(center.hb);
                const cy = yForIvb(center.ivb);
                return (
                  <polygon
                    key={`${center.row}-${center.col}`}
                    points={hexPoints(cx, cy, hexRadius)}
                    fill={colorForScore(cell?.stuff2 ?? null)}
                    stroke="none"
                    onMouseEnter={() => setHoverCell(cell ?? { ivb: center.ivb, hb: center.hb, stuff2: null })}
                    onMouseLeave={() => setHoverCell(null)}
                  >
                    <title>
                      {`Stuff+: ${cell?.stuff2 !== null && cell?.stuff2 !== undefined ? cell.stuff2.toFixed(1) : '—'}\nIVB: ${center.ivb.toFixed(1)}"\nHB: ${center.hb.toFixed(1)}"`}
                    </title>
                  </polygon>
                );
              })}
            </g>

            {/* gridlines + zero-lines drawn ON TOP of the hex fill (the
                previous version drew them first and the opaque hexes
                painted right over them, so nothing was visible). A dark
                halo behind a light stroke keeps these readable against
                every hex color from deep blue through white to deep red. */}
            {[-20, -15, -10, -5, 5, 10, 15, 20].filter((v) => v >= IVB_MIN && v <= IVB_MAX).map((v) => (
              <line key={`ivb-line-${v}`} x1={marginLeft} x2={marginLeft + plotWidth} y1={yForIvb(v)} y2={yForIvb(v)} stroke="rgba(15,23,42,0.35)" strokeWidth={1} strokeDasharray="4 3" />
            ))}
            {[-20, -10, 10, 20].filter((v) => v >= HB_MIN && v <= HB_MAX).map((v) => (
              <line key={`hb-line-${v}`} y1={marginTop} y2={marginTop + plotHeight} x1={xForHb(v)} x2={xForHb(v)} stroke="rgba(15,23,42,0.35)" strokeWidth={1} strokeDasharray="4 3" />
            ))}
            <g>
              <line x1={xForHb(0)} x2={xForHb(0)} y1={marginTop} y2={marginTop + plotHeight} stroke="#0f172a" strokeWidth={3.2} strokeOpacity={0.55} />
              <line x1={xForHb(0)} x2={xForHb(0)} y1={marginTop} y2={marginTop + plotHeight} stroke="#f8fafc" strokeWidth={1.4} strokeDasharray="6 4" />
              <line x1={marginLeft} x2={marginLeft + plotWidth} y1={yForIvb(0)} y2={yForIvb(0)} stroke="#0f172a" strokeWidth={3.2} strokeOpacity={0.55} />
              <line x1={marginLeft} x2={marginLeft + plotWidth} y1={yForIvb(0)} y2={yForIvb(0)} stroke="#f8fafc" strokeWidth={1.4} strokeDasharray="6 4" />
            </g>

            {/* plot border frame */}
            <rect x={marginLeft} y={marginTop} width={plotWidth} height={plotHeight} fill="none" stroke="rgba(248,250,252,0.4)" strokeWidth={1.2} />

            {/* axis labels */}
            <text x={marginLeft + plotWidth / 2} y={height - 8} textAnchor="middle" fill="rgba(248,250,252,0.72)" fontSize={15} fontWeight={700} letterSpacing="0.06em">
              HORIZONTAL BREAK (IN)
            </text>
            <text x={20} y={marginTop + plotHeight / 2} textAnchor="middle" fill="rgba(248,250,252,0.72)" fontSize={15} fontWeight={700} letterSpacing="0.06em" transform={`rotate(-90, 20, ${marginTop + plotHeight / 2})`}>
              INDUCED VERTICAL BREAK (IN)
            </text>
            {[IVB_MIN, -10, 0, 10, IVB_MAX].filter((v) => v >= IVB_MIN && v <= IVB_MAX).map((v) => (
              <text key={`ivb-tick-${v}`} x={marginLeft - 10} y={yForIvb(v) + 4} textAnchor="end" fill="rgba(248,250,252,0.6)" fontSize={13}>
                {v}
              </text>
            ))}
            {[HB_MIN, -10, 0, 10, HB_MAX].filter((v) => v >= HB_MIN && v <= HB_MAX).map((v) => (
              <text key={`hb-tick-${v}`} x={xForHb(v)} y={marginTop + plotHeight + 20} textAnchor="middle" fill="rgba(248,250,252,0.6)" fontSize={13}>
                {v}
              </text>
            ))}
          </svg>
          <div style={{ marginTop: '0.9rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: 4 }}>
              <span className="portal-muted-text">Poor (≤90)</span>
              <span className="portal-muted-text">Average (100)</span>
              <span className="portal-muted-text">Great (≥110)</span>
            </div>
            <div style={{
              height: 12,
              borderRadius: 4,
              border: '1px solid rgba(255,255,255,0.25)',
              background: 'linear-gradient(90deg, rgb(33,90,210), rgb(255,255,255) 50%, rgb(196,30,30))',
            }} />
          </div>
        </article>
      </div>
    </section>
  );
}
