'use client';

import { useMemo, useState } from 'react';

type StuffCalcHand = 'Right' | 'Left';
type StuffCalcLevel = 'High School' | 'College' | 'Pro';
type StuffCalcBaseType = 'Fastball' | 'Sinker';
type StuffCalcPitchType = 'Fastball' | 'Sinker' | 'Cutter' | 'Slider' | 'Sweeper' | 'Curveball' | 'ChangeUp' | 'Splitter';

type StuffCalcInput = {
  hand: StuffCalcHand;
  pitch: StuffCalcPitchType;
  level: StuffCalcLevel;
  vel: number;
  ivb: number;
  hb: number;
  relHeight: number;
  baseType: StuffCalcBaseType;
  baseVel: number;
  baseIvb: number;
  baseHb: number;
};

type StuffWeight = { wVel: number; wIvb: number; wHb: number; wExt: number; wRawVel: number };
type StuffBreakingVeloTarget = { poor: number; avg: number; great: number };

const STUFF_CALC_PITCH_TYPES: StuffCalcPitchType[] = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter'];
const STUFF_CALC_LEVELS: StuffCalcLevel[] = ['High School', 'College', 'Pro'];
const STUFF_CALC_BASE_TYPES: StuffCalcBaseType[] = ['Fastball', 'Sinker'];

const STUFF_WEIGHTS_FB: Record<StuffCalcPitchType, StuffWeight> = {
  Fastball: { wVel: 0.6, wIvb: 0.3, wHb: 0.1, wExt: 0.05, wRawVel: 0 },
  Sinker: { wVel: 0.5, wIvb: 0.3, wHb: 0.2, wExt: 0.05, wRawVel: 0 },
  Cutter: { wVel: 0.44, wIvb: 0.2, wHb: 0.3, wExt: 0.05, wRawVel: 0.1 },
  Slider: { wVel: 0.34, wIvb: 0.4, wHb: 0.2, wExt: 0.05, wRawVel: 0.1 },
  Sweeper: { wVel: 0.23, wIvb: 0.1, wHb: 0.6, wExt: 0.04, wRawVel: 0.1 },
  Curveball: { wVel: 0.43, wIvb: 0.5, wHb: 0, wExt: 0.04, wRawVel: 0.1 },
  ChangeUp: { wVel: 0.2, wIvb: 0.6, wHb: 0.2, wExt: 0.03, wRawVel: 0 },
  Splitter: { wVel: 0.1, wIvb: 0.85, wHb: 0.05, wExt: 0.03, wRawVel: 0 },
};

const STUFF_WEIGHTS_SI: Record<StuffCalcPitchType, StuffWeight> = {
  Fastball: { wVel: 0.6, wIvb: 0.3, wHb: 0.1, wExt: 0.05, wRawVel: 0 },
  Sinker: { wVel: 0.5, wIvb: 0.3, wHb: 0.2, wExt: 0.05, wRawVel: 0 },
  Cutter: { wVel: 0.44, wIvb: 0.2, wHb: 0.3, wExt: 0.05, wRawVel: 0.1 },
  Slider: { wVel: 0.34, wIvb: 0.4, wHb: 0.2, wExt: 0.05, wRawVel: 0.1 },
  Sweeper: { wVel: 0.23, wIvb: 0.1, wHb: 0.6, wExt: 0.04, wRawVel: 0.1 },
  Curveball: { wVel: 0.43, wIvb: 0.5, wHb: 0, wExt: 0.04, wRawVel: 0.1 },
  ChangeUp: { wVel: 0.2, wIvb: 0.7, wHb: 0.1, wExt: 0.03, wRawVel: 0 },
  Splitter: { wVel: 0.1, wIvb: 0.85, wHb: 0.05, wExt: 0.03, wRawVel: 0 },
};

const STUFF_BREAKING_VELO_TARGETS: Partial<Record<StuffCalcPitchType, StuffBreakingVeloTarget>> = {
  Cutter: { poor: 82, avg: 85, great: 88 },
  Slider: { poor: 80, avg: 82, great: 84 },
  Sweeper: { poor: 75, avg: 77, great: 80 },
  Curveball: { poor: 75, avg: 77, great: 80 },
};

const STUFF_OFF_SPEED_VELO_OFFSETS: Record<Exclude<StuffCalcPitchType, 'Fastball' | 'Sinker'>, number> = {
  Cutter: 5,
  Slider: 8,
  Sweeper: 12,
  Curveball: 14,
  ChangeUp: 8,
  Splitter: 7,
};

const STUFF_SEP_FB: Record<Exclude<StuffCalcPitchType, 'Fastball' | 'Sinker'>, { ivb: number; hb: number }> = {
  Cutter: { ivb: -7, hb: 10 },
  Slider: { ivb: -15, hb: 12 },
  Sweeper: { ivb: -16, hb: 22 },
  Curveball: { ivb: -27, hb: 18 },
  ChangeUp: { ivb: -12, hb: -7 },
  Splitter: { ivb: -13, hb: -4 },
};

const STUFF_SEP_SI: Record<Exclude<StuffCalcPitchType, 'Fastball' | 'Sinker'>, { ivb: number; hb: number }> = {
  Cutter: { ivb: 2, hb: 18 },
  Slider: { ivb: -6, hb: 20 },
  Sweeper: { ivb: -7, hb: 30 },
  Curveball: { ivb: -18, hb: 25 },
  ChangeUp: { ivb: -4, hb: 1 },
  Splitter: { ivb: -5, hb: 2 },
};

function stuffHbAdj(hand: StuffCalcHand, hb: number): number {
  return hand === 'Left' ? hb : -hb;
}

function stuffStdIvb(pitch: StuffCalcPitchType, relHeight: number): number | null {
  if (pitch === 'Fastball') {
    if (relHeight >= 6.2) return 17;
    if (relHeight >= 5.8) return 15.5;
    if (relHeight >= 5.4) return 15;
    if (relHeight >= 5.0) return 12.5;
    if (relHeight >= 4.5) return 11;
    return 10;
  }
  if (pitch === 'Sinker') {
    if (relHeight >= 6.2) return 10;
    if (relHeight >= 5.8) return 7;
    if (relHeight >= 5.4) return 6;
    if (relHeight >= 5.0) return 4;
    if (relHeight >= 4.5) return 3;
    return 3;
  }
  return null;
}

function stuffStdHbRight(pitch: StuffCalcPitchType, relHeight: number): number | null {
  if (pitch === 'Fastball') {
    if (relHeight >= 6.2) return 9;
    if (relHeight >= 5.8) return 10;
    if (relHeight >= 5.4) return 11;
    if (relHeight >= 5.0) return 12;
    if (relHeight >= 4.5) return 13;
    return 11;
  }
  if (pitch === 'Sinker') {
    if (relHeight >= 6.2) return 15;
    if (relHeight >= 5.8) return 15.5;
    if (relHeight >= 5.4) return 16.7;
    if (relHeight >= 5.0) return 17;
    if (relHeight >= 4.5) return 17;
    return 17.5;
  }
  return null;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function computeStuffCalculatorValue(input: StuffCalcInput): number | null {
  const weights = (input.baseType === 'Fastball' ? STUFF_WEIGHTS_FB : STUFF_WEIGHTS_SI)[input.pitch];
  const breakingVeloTargets = STUFF_BREAKING_VELO_TARGETS[input.pitch];
  const velAvg = ({ Pro: 94, College: 89, 'High School': 82 } as const)[input.level];
  const hbAdj = stuffHbAdj(input.hand, input.hb);
  const baseHbAdj = stuffHbAdj(input.hand, input.baseHb);
  const stdIvb = stuffStdIvb(input.pitch, input.relHeight);
  const stdHbRight = stuffStdHbRight(input.pitch, input.relHeight);
  const stdHb = stdHbRight === null ? null : (input.hand === 'Left' ? -stdHbRight : stdHbRight);
  const seps = input.baseType === 'Fastball' ? STUFF_SEP_FB : STUFF_SEP_SI;

  let rVel: number;
  if (input.pitch === 'Fastball' || input.pitch === 'Sinker') {
    rVel = input.vel / velAvg;
  } else {
    const offset = STUFF_OFF_SPEED_VELO_OFFSETS[input.pitch];
    rVel = input.vel / Math.max(1e-6, input.baseVel - offset);
  }
  rVel = rVel < 1 ? rVel ** 4 : rVel ** 2;
  if (input.pitch === 'ChangeUp' || input.pitch === 'Splitter') rVel = 1 / Math.max(rVel, 1e-6);

  let rIvb: number;
  if (input.pitch === 'Fastball' && stdIvb !== null) {
    rIvb = input.ivb / stdIvb;
  } else if (input.pitch === 'Sinker' && stdIvb !== null) {
    rIvb = input.ivb > 0 ? stdIvb / input.ivb : 1;
  } else if (input.baseType === 'Sinker' && (input.pitch === 'Cutter' || input.pitch === 'Sweeper')) {
    const endpoint = input.baseIvb + seps[input.pitch].ivb;
    rIvb = Math.abs(input.ivb - endpoint) / endpoint;
  } else if (input.baseType === 'Fastball' && input.pitch === 'Sweeper') {
    const endpoint = input.baseIvb + STUFF_SEP_FB.Sweeper.ivb;
    rIvb = Math.abs(input.ivb - endpoint) / Math.abs(endpoint);
  } else if (input.pitch !== 'Fastball' && input.pitch !== 'Sinker') {
    rIvb = (input.baseIvb - input.ivb) / Math.abs(seps[input.pitch].ivb);
  } else {
    rIvb = 1;
  }

  let rHb: number;
  if (input.pitch === 'Fastball' && stdHb !== null) {
    const hbMag = Math.abs(hbAdj);
    const stdMag = Math.abs(stdHb);
    rHb = Math.max(hbMag / stdMag, stdMag / Math.max(hbMag, 1e-6));
    if (Math.abs(hbMag - stdMag) < 2) rHb = 1;
  } else if (input.pitch === 'Sinker' && stdHb !== null) {
    rHb = Math.abs(hbAdj / stdHb);
  } else if (input.pitch === 'Curveball') {
    rHb = Math.abs(input.hb - baseHbAdj) / Math.abs(seps.Curveball.hb);
  } else if (input.baseType === 'Sinker' && (input.pitch === 'Sweeper' || input.pitch === 'Cutter')) {
    const endpoint = baseHbAdj + seps[input.pitch].hb;
    rHb = Math.abs(hbAdj) / Math.abs(endpoint);
  } else if (input.baseType === 'Sinker' && (input.pitch === 'ChangeUp' || input.pitch === 'Splitter')) {
    rHb = (baseHbAdj - hbAdj) / seps[input.pitch].hb;
  } else if (input.pitch !== 'Fastball' && input.pitch !== 'Sinker') {
    rHb = (hbAdj - baseHbAdj) / seps[input.pitch].hb;
  } else {
    rHb = 1;
  }

  rIvb = Math.min(rIvb, 2);
  rHb = Math.min(rHb, 2);
  const rExt = 1;

  const velNorm = breakingVeloTargets
    ? (input.vel - breakingVeloTargets.avg) / Math.max(1, breakingVeloTargets.great - breakingVeloTargets.poor)
    : 0;
  const rRawVel = Math.min(1.2, Math.max(0.8, 1 + 0.25 * velNorm));

  const baseScale = Math.max(1 - (weights.wExt + weights.wRawVel), 0.01);
  const raw = (weights.wVel * baseScale) * rVel
    + (weights.wIvb * baseScale) * rIvb
    + (weights.wHb * baseScale) * rHb
    + weights.wExt * rExt
    + weights.wRawVel * rRawVel;
  const stuff = raw * 100;
  if (!Number.isFinite(stuff)) return null;
  return round1(stuff);
}

function CalcCard({
  title,
  hand,
  setHand,
  pitch,
  setPitch,
  level,
  setLevel,
  vel,
  setVel,
  ivb,
  setIvb,
  hb,
  setHb,
  relHeight,
  setRelHeight,
  baseType,
  setBaseType,
  baseVel,
  setBaseVel,
  baseIvb,
  setBaseIvb,
  baseHb,
  setBaseHb,
  hbAdj,
  stuff,
}: {
  title: string;
  hand: StuffCalcHand;
  setHand: (next: StuffCalcHand) => void;
  pitch: StuffCalcPitchType;
  setPitch: (next: StuffCalcPitchType) => void;
  level: StuffCalcLevel;
  setLevel: (next: StuffCalcLevel) => void;
  vel: string;
  setVel: (next: string) => void;
  ivb: string;
  setIvb: (next: string) => void;
  hb: string;
  setHb: (next: string) => void;
  relHeight: string;
  setRelHeight: (next: string) => void;
  baseType: StuffCalcBaseType;
  setBaseType: (next: StuffCalcBaseType) => void;
  baseVel: string;
  setBaseVel: (next: string) => void;
  baseIvb: string;
  setBaseIvb: (next: string) => void;
  baseHb: string;
  setBaseHb: (next: string) => void;
  hbAdj: string;
  stuff: number | null;
}) {
  return (
    <article className="portal-day-card">
      <h4 style={{ marginTop: 0 }}>{title}</h4>
      <div className="portal-form-grid" style={{ gridTemplateColumns: '1fr' }}>
        <label>
          Pitcher Hand
          <select value={hand} onChange={(event) => setHand(event.target.value === 'Left' ? 'Left' : 'Right')}>
            <option value="Right">Right</option>
            <option value="Left">Left</option>
          </select>
        </label>
        <label>
          Pitch Type
          <select value={pitch} onChange={(event) => setPitch((STUFF_CALC_PITCH_TYPES.includes(event.target.value as StuffCalcPitchType) ? event.target.value : 'Fastball') as StuffCalcPitchType)}>
            {STUFF_CALC_PITCH_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Level
          <select value={level} onChange={(event) => setLevel((STUFF_CALC_LEVELS.includes(event.target.value as StuffCalcLevel) ? event.target.value : 'College') as StuffCalcLevel)}>
            {STUFF_CALC_LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          Velocity (mph)
          <input type="number" min={60} max={110} step={0.1} value={vel} onChange={(event) => setVel(event.target.value)} />
        </label>
        <label>
          IVB (in)
          <input type="number" min={-40} max={40} step={0.1} value={ivb} onChange={(event) => setIvb(event.target.value)} />
        </label>
        <label>
          HB (in)
          <input type="number" min={-40} max={40} step={0.1} value={hb} onChange={(event) => setHb(event.target.value)} />
        </label>
        <label>
          RelHeight (ft)
          <input type="number" min={3.5} max={7.5} step={0.1} value={relHeight} onChange={(event) => setRelHeight(event.target.value)} />
        </label>
        {!(pitch === 'Fastball' || pitch === 'Sinker') ? (
          <>
            <hr style={{ width: '100%', borderColor: 'rgba(255,255,255,0.16)', margin: '0.2rem 0' }} />
            <div style={{ fontWeight: 700, fontSize: '0.86rem' }}>Base pitch for off-speed context</div>
            <label>
              Base Type
              <select value={baseType} onChange={(event) => setBaseType(event.target.value === 'Sinker' ? 'Sinker' : 'Fastball')}>
                {STUFF_CALC_BASE_TYPES.map((value) => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>
            <label>
              Base Velo (mph)
              <input type="number" min={60} max={110} step={0.1} value={baseVel} onChange={(event) => setBaseVel(event.target.value)} />
            </label>
            <label>
              Base IVB (in)
              <input type="number" min={-40} max={40} step={0.1} value={baseIvb} onChange={(event) => setBaseIvb(event.target.value)} />
            </label>
            <label>
              Base HB (in)
              <input type="number" min={-40} max={40} step={0.1} value={baseHb} onChange={(event) => setBaseHb(event.target.value)} />
            </label>
          </>
        ) : null}
        <div className="portal-muted-text">HB_adj (hand-agnostic): <strong>{hbAdj}</strong></div>
      </div>
      <h2 style={{ marginBottom: 0 }}>Stuff+: {stuff !== null ? stuff.toFixed(1) : '—'}</h2>
    </article>
  );
}

export default function StuffCalculatorSuite() {
  const [calc1Hand, setCalc1Hand] = useState<StuffCalcHand>('Right');
  const [calc1Pitch, setCalc1Pitch] = useState<StuffCalcPitchType>('Fastball');
  const [calc1Level, setCalc1Level] = useState<StuffCalcLevel>('College');
  const [calc1Vel, setCalc1Vel] = useState('92');
  const [calc1Ivb, setCalc1Ivb] = useState('15');
  const [calc1Hb, setCalc1Hb] = useState('10');
  const [calc1RelHeight, setCalc1RelHeight] = useState('5.8');
  const [calc1BaseType, setCalc1BaseType] = useState<StuffCalcBaseType>('Fastball');
  const [calc1BaseVel, setCalc1BaseVel] = useState('92');
  const [calc1BaseIvb, setCalc1BaseIvb] = useState('15');
  const [calc1BaseHb, setCalc1BaseHb] = useState('10');

  const [calc2Hand, setCalc2Hand] = useState<StuffCalcHand>('Right');
  const [calc2Pitch, setCalc2Pitch] = useState<StuffCalcPitchType>('Slider');
  const [calc2Level, setCalc2Level] = useState<StuffCalcLevel>('College');
  const [calc2Vel, setCalc2Vel] = useState('83');
  const [calc2Ivb, setCalc2Ivb] = useState('-2');
  const [calc2Hb, setCalc2Hb] = useState('6');
  const [calc2RelHeight, setCalc2RelHeight] = useState('5.8');
  const [calc2BaseType, setCalc2BaseType] = useState<StuffCalcBaseType>('Fastball');
  const [calc2BaseVel, setCalc2BaseVel] = useState('92');
  const [calc2BaseIvb, setCalc2BaseIvb] = useState('15');
  const [calc2BaseHb, setCalc2BaseHb] = useState('10');

  const calc1HbAdj = useMemo(() => {
    const hb = Number(calc1Hb);
    if (!Number.isFinite(hb)) return '';
    return stuffHbAdj(calc1Hand, hb).toFixed(1);
  }, [calc1Hand, calc1Hb]);

  const calc2HbAdj = useMemo(() => {
    const hb = Number(calc2Hb);
    if (!Number.isFinite(hb)) return '';
    return stuffHbAdj(calc2Hand, hb).toFixed(1);
  }, [calc2Hand, calc2Hb]);

  const calc1Stuff = useMemo(
    () =>
      computeStuffCalculatorValue({
        hand: calc1Hand,
        pitch: calc1Pitch,
        level: calc1Level,
        vel: Number(calc1Vel),
        ivb: Number(calc1Ivb),
        hb: Number(calc1Hb),
        relHeight: Number(calc1RelHeight),
        baseType: calc1BaseType,
        baseVel: Number(calc1BaseVel) || Number(calc1Vel),
        baseIvb: Number(calc1BaseIvb) || Number(calc1Ivb),
        baseHb: Number(calc1BaseHb) || Number(calc1Hb),
      }),
    [calc1BaseHb, calc1BaseIvb, calc1BaseType, calc1BaseVel, calc1Hand, calc1Hb, calc1Ivb, calc1Level, calc1Pitch, calc1RelHeight, calc1Vel]
  );

  const calc2Stuff = useMemo(
    () =>
      computeStuffCalculatorValue({
        hand: calc2Hand,
        pitch: calc2Pitch,
        level: calc2Level,
        vel: Number(calc2Vel),
        ivb: Number(calc2Ivb),
        hb: Number(calc2Hb),
        relHeight: Number(calc2RelHeight),
        baseType: calc2BaseType,
        baseVel: Number(calc2BaseVel) || Number(calc2Vel),
        baseIvb: Number(calc2BaseIvb) || Number(calc2Ivb),
        baseHb: Number(calc2BaseHb) || Number(calc2Hb),
      }),
    [calc2BaseHb, calc2BaseIvb, calc2BaseType, calc2BaseVel, calc2Hand, calc2Hb, calc2Ivb, calc2Level, calc2Pitch, calc2RelHeight, calc2Vel]
  );

  return (
    <section className="portal-panel portal-admin-panel" style={{ padding: '1rem' }}>
      <h3>Stuff+ Calculator</h3>
      <div className="portal-admin-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(340px, 1fr))', gap: 12 }}>
        <CalcCard
          title="Pitch A"
          hand={calc1Hand}
          setHand={setCalc1Hand}
          pitch={calc1Pitch}
          setPitch={setCalc1Pitch}
          level={calc1Level}
          setLevel={setCalc1Level}
          vel={calc1Vel}
          setVel={setCalc1Vel}
          ivb={calc1Ivb}
          setIvb={setCalc1Ivb}
          hb={calc1Hb}
          setHb={setCalc1Hb}
          relHeight={calc1RelHeight}
          setRelHeight={setCalc1RelHeight}
          baseType={calc1BaseType}
          setBaseType={setCalc1BaseType}
          baseVel={calc1BaseVel}
          setBaseVel={setCalc1BaseVel}
          baseIvb={calc1BaseIvb}
          setBaseIvb={setCalc1BaseIvb}
          baseHb={calc1BaseHb}
          setBaseHb={setCalc1BaseHb}
          hbAdj={calc1HbAdj}
          stuff={calc1Stuff}
        />
        <CalcCard
          title="Pitch B"
          hand={calc2Hand}
          setHand={setCalc2Hand}
          pitch={calc2Pitch}
          setPitch={setCalc2Pitch}
          level={calc2Level}
          setLevel={setCalc2Level}
          vel={calc2Vel}
          setVel={setCalc2Vel}
          ivb={calc2Ivb}
          setIvb={setCalc2Ivb}
          hb={calc2Hb}
          setHb={setCalc2Hb}
          relHeight={calc2RelHeight}
          setRelHeight={setCalc2RelHeight}
          baseType={calc2BaseType}
          setBaseType={setCalc2BaseType}
          baseVel={calc2BaseVel}
          setBaseVel={setCalc2BaseVel}
          baseIvb={calc2BaseIvb}
          setBaseIvb={setCalc2BaseIvb}
          baseHb={calc2BaseHb}
          setBaseHb={setCalc2BaseHb}
          hbAdj={calc2HbAdj}
          stuff={calc2Stuff}
        />
      </div>
    </section>
  );
}

