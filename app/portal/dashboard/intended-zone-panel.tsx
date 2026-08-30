'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import IntendedZoneStats from './intended-zone-stats';
import styles from './intended-zone-panel.module.css';

// Mirrors pitching-suite.tsx's single-pitch "action zone" SVG geometry
// exactly (same constants, same plate/box drawing order) so this looks
// pixel-identical to the zone graphic used everywhere else in the
// dashboard. See that file's actionZone*/actionStrike*/actionComp*
// constants -- kept in sync manually since neither file imports the other.
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
const pxToFeetX = (px: number) => ZONE_X_MIN + (px - ZONE_LEFT_PAD) / ZONE_SCALE;
const pxToFeetY = (py: number) => ZONE_Y_MAX - (py - ZONE_TOP_PAD) / ZONE_SCALE;

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

const ZONE_STROKE = 'rgba(226, 232, 240, 0.55)';
const ZONE_STROKE_STRONG = '#e2e8f0';

// Kept identical to the PITCH_COLORS constant duplicated across
// pitching-suite.tsx, spin-visual-panel.tsx, ball-flight-panel.tsx, etc. --
// same raw color keywords, not hex approximations, so a pitch type reads as
// the same color everywhere in the dashboard.
const PITCH_COLORS: Record<string, string> = {
  Fastball: 'var(--portal-fastball-color)',
  Sinker: 'orange',
  Cutter: 'brown',
  Slider: 'red',
  Sweeper: 'purple',
  Curveball: 'blue',
  ChangeUp: 'darkgreen',
  Splitter: 'turquoise',
  Knuckleball: 'darkblue',
  Undefined: '#9ca3af',
};

const TARGET_RADIUS_MIN_FT = 0.15;
const TARGET_RADIUS_MAX_FT = 0.75;
const TARGET_RADIUS_DEFAULT_FT = 0.35;

const MISS_DIRECTION_LABELS: Record<string, string> = {
  'up-arm': 'Up, Arm Side',
  'up-middle': 'Up, Middle',
  'up-glove': 'Up, Glove Side',
  'middle-arm': 'Middle, Arm Side',
  'on-target': 'On Target',
  'middle-glove': 'Middle, Glove Side',
  'down-arm': 'Down, Arm Side',
  'down-middle': 'Down, Middle',
  'down-glove': 'Down, Glove Side',
};

function missSeverity(missDistanceFt: number | null): 'good' | 'warn' | 'bad' | null {
  if (missDistanceFt === null) return null;
  const inches = missDistanceFt * 12;
  if (inches <= 6) return 'good';
  if (inches <= 14) return 'warn';
  return 'bad';
}

// Same logic as pitching-suite.tsx's formatNameFirstLast/normalizePersonName
// (not exported from that file, so replicated here) -- the dashboard
// displays pitchers as "First Last" while TrackMan tags them "Last, First",
// so a naive string comparison between the two flags every real match as a
// "mismatch." Converting both to one canonical form first is required.
function formatNameFirstLast(name: string): string {
  const normalized = (name || '').trim();
  if (!normalized) return '';
  const parts = normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
  if (parts.length >= 2) return `${parts.slice(1).join(' ')} ${parts[0]}`.replace(/\s+/g, ' ').trim();
  return normalized;
}

function normalizePersonName(value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const firstLast = formatNameFirstLast(raw);
  return firstLast
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

type IntendedZonePitch = {
  id: number;
  sessionId: number;
  pitchIndex: number;
  trackmanPlayId: string | null;
  intendedSideFt: number;
  intendedHeightFt: number;
  targetRadiusFt: number;
  plateLocSide: number | null;
  plateLocHeight: number | null;
  missDistanceFt: number | null;
  missDirection: string | null;
  pitchType: string | null;
  relSpeed: number | null;
  inducedVertBreak: number | null;
  horzBreak: number | null;
  thrownAt: string | null;
  taggedPitcherName: string | null;
};

type IntendedZoneSession = {
  id: number;
  organizationId: number;
  pitcherName: string | null;
  trackmanSessionId: string | null;
  targetRadiusFt: number;
  startedAt: string;
  endedAt: string | null;
};

type TrackmanDiscoveredSession = {
  sessionId: string;
  gameDateLocal: string;
  sessionType: string;
};

const POLL_INTERVAL_MS = 4000;

export default function IntendedZonePanel({
  pitcherName,
  startDate,
  endDate,
  selectedPitchTypes,
}: {
  pitcherName: string | null;
  startDate?: string;
  endDate?: string;
  selectedPitchTypes?: string[];
}) {
  const [page, setPage] = useState<'live' | 'stats'>('live');
  const [activeSession, setActiveSession] = useState<IntendedZoneSession | null>(null);
  const [discoveredSessions, setDiscoveredSessions] = useState<TrackmanDiscoveredSession[]>([]);
  const [selectedTrackmanSessionId, setSelectedTrackmanSessionId] = useState('');
  const [targetRadiusFt, setTargetRadiusFt] = useState(TARGET_RADIUS_DEFAULT_FT);
  const [pitches, setPitches] = useState<IntendedZonePitch[]>([]);
  const [pendingTarget, setPendingTarget] = useState<{ sideFt: number; heightFt: number } | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<IntendedZoneSession[]>([]);
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSeenPitchId = useRef<number | null>(null);
  const [justLanded, setJustLanded] = useState(false);

  const loadDiscoveredSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/pitching/intended-zone/sessions?discover=1');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load TrackMan sessions.');
      setDiscoveredSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load TrackMan sessions.');
    }
  }, []);

  const loadHistory = useCallback(async () => {
    if (!pitcherName) return;
    try {
      const response = await fetch(`/api/dashboard/pitching/intended-zone/sessions?pitcherName=${encodeURIComponent(pitcherName)}`);
      const payload = await response.json();
      if (response.ok) setHistory(Array.isArray(payload.sessions) ? payload.sessions : []);
    } catch {
      // Best-effort -- history list isn't critical to the live-tracking flow.
    }
  }, [pitcherName]);

  useEffect(() => {
    loadDiscoveredSessions();
    loadHistory();
  }, [loadDiscoveredSessions, loadHistory]);

  const poll = useCallback(async (sessionId: number) => {
    try {
      const response = await fetch(`/api/dashboard/pitching/intended-zone/pitches?sessionId=${sessionId}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to poll for pitches.');
      const nextPitches: IntendedZonePitch[] = Array.isArray(payload.pitches) ? payload.pitches : [];
      const matched = nextPitches.filter((p) => p.trackmanPlayId);
      const newest = matched.length ? matched[matched.length - 1] : null;
      if (newest && newest.id !== lastSeenPitchId.current) {
        lastSeenPitchId.current = newest.id;
        setJustLanded(true);
        setTimeout(() => setJustLanded(false), 550);
      }
      setPitches(nextPitches);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to poll for pitches.');
    }
  }, []);

  useEffect(() => {
    if (!activeSession) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }
    poll(activeSession.id);
    pollRef.current = setInterval(() => poll(activeSession.id), POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [activeSession, poll]);

  async function handleStartSession() {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch('/api/dashboard/pitching/intended-zone/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pitcherName,
          trackmanSessionId: selectedTrackmanSessionId || null,
          targetRadiusFt,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to start session.');
      setActiveSession(payload.session);
      setPitches([]);
      setPendingTarget(null);
      lastSeenPitchId.current = null;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session.');
    } finally {
      setStarting(false);
    }
  }

  async function handleEndSession() {
    if (!activeSession) return;
    try {
      await fetch('/api/dashboard/pitching/intended-zone/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.id, action: 'end' }),
      });
    } catch {
      // Best-effort -- the session still stops polling locally regardless.
    } finally {
      setActiveSession(null);
      setPendingTarget(null);
      loadHistory();
    }
  }

  async function handleDeleteSession(sessionId: number) {
    if (!window.confirm('Delete this session and all of its recorded pitches? This cannot be undone.')) return;
    setDeletingSessionId(sessionId);
    setError(null);
    try {
      const response = await fetch(`/api/dashboard/pitching/intended-zone/sessions?sessionId=${sessionId}`, { method: 'DELETE' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to delete session.');
      if (activeSession?.id === sessionId) {
        setActiveSession(null);
        setPitches([]);
        setPendingTarget(null);
      }
      setHistory((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session.');
    } finally {
      setDeletingSessionId(null);
    }
  }

  function handleZoneClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!activeSession || pendingTarget) return;
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * ZONE_W;
    const py = ((event.clientY - rect.top) / rect.height) * ZONE_H;
    setPendingTarget({ sideFt: pxToFeetX(px), heightFt: pxToFeetY(py) });
  }

  async function handleConfirmTarget() {
    if (!activeSession || !pendingTarget) return;
    try {
      await fetch('/api/dashboard/pitching/intended-zone/pitches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.id,
          intendedSideFt: pendingTarget.sideFt,
          intendedHeightFt: pendingTarget.heightFt,
          targetRadiusFt,
        }),
      });
      setPendingTarget(null);
      poll(activeSession.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to queue target.');
    }
  }

  const lastMatchedPitch = useMemo(() => {
    const matched = pitches.filter((p) => p.trackmanPlayId);
    return matched.length ? matched[matched.length - 1] : null;
  }, [pitches]);

  const sessionAverages = useMemo(() => {
    const matched = pitches.filter((p) => p.missDistanceFt !== null);
    if (!matched.length) return null;
    const avgMiss = matched.reduce((sum, p) => sum + (p.missDistanceFt ?? 0), 0) / matched.length;
    const onTarget = matched.filter((p) => p.missDirection === 'on-target').length;
    return { avgMiss, onTargetPct: (onTarget / matched.length) * 100, count: matched.length };
  }, [pitches]);

  // Compares the pitcher tagged on the TrackMan iPad to who was selected
  // here -- catches the "wrong session picked, or wrong player tagged on
  // the iPad" mistake before a coach builds up a whole session of data
  // silently attributed to the wrong pitcher. Warn, don't block: a
  // legitimate formatting/nickname difference shouldn't halt tracking.
  const pitcherMismatch = useMemo(() => {
    if (!pitcherName) return null;
    const expected = normalizePersonName(pitcherName);
    const taggedNames = Array.from(new Set(pitches.map((p) => p.taggedPitcherName).filter((name): name is string => Boolean(name))));
    const mismatched = taggedNames.filter((name) => normalizePersonName(name) !== expected);
    return mismatched.length ? mismatched : null;
  }, [pitcherName, pitches]);

  const lastPitchColor = lastMatchedPitch ? PITCH_COLORS[lastMatchedPitch.pitchType ?? 'Undefined'] ?? PITCH_COLORS.Undefined : null;
  const lastMissSeverity = lastMatchedPitch ? missSeverity(lastMatchedPitch.missDistanceFt) : null;

  const pageSwitcher = (
    <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
      <button
        type="button"
        className={styles.resetButton}
        style={page === 'live' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
        onClick={() => setPage('live')}
      >
        Live Tracking
      </button>
      <button
        type="button"
        className={styles.resetButton}
        style={page === 'stats' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
        onClick={() => setPage('stats')}
      >
        Stats
      </button>
    </div>
  );

  if (page === 'stats') {
    return (
      <div>
        {pageSwitcher}
        <IntendedZoneStats
          pitcherName={pitcherName}
          organizationHasMultiplePitchers
          sidebarStartDate={startDate ?? ''}
          sidebarEndDate={endDate ?? ''}
          sidebarPitchTypes={selectedPitchTypes ?? ['All']}
        />
      </div>
    );
  }

  return (
    <div>
      {pageSwitcher}
      <div className={styles.card}>
      <div className={styles.headerRow}>
        <div>
          <p className={styles.eyebrow}>Live Tracking</p>
          <h3 className={styles.title}>Intended Zones{pitcherName ? ` — ${pitcherName}` : ''}</h3>
          <p className={styles.subtitle}>Tap where the pitcher is aiming before each pitch — TrackMan fills in where it actually went.</p>
        </div>
        {activeSession ? (
          <span className={styles.liveBadge}>
            <span className={styles.liveDot} />
            Live
          </span>
        ) : null}
      </div>

      {error ? <p className={styles.errorBanner}>{error}</p> : null}

      {!pitcherName ? (
        <p className={styles.noPitcher}>Select a single pitcher above (Split By Pitcher, one selected) to start a live session.</p>
      ) : !activeSession ? (
        <div className={styles.setupGrid}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="iz-session">
              TrackMan Session (optional — link now, or start untracked and link later)
            </label>
            <select
              id="iz-session"
              className={styles.select}
              value={selectedTrackmanSessionId}
              onChange={(event) => setSelectedTrackmanSessionId(event.target.value)}
            >
              <option value="">No session selected</option>
              {discoveredSessions.map((s) => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.gameDateLocal} ({s.sessionType})
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor="iz-radius">
              Target Size
            </label>
            <div className={styles.sliderRow}>
              <input
                id="iz-radius"
                className={styles.slider}
                type="range"
                min={TARGET_RADIUS_MIN_FT}
                max={TARGET_RADIUS_MAX_FT}
                step={0.05}
                value={targetRadiusFt}
                onChange={(event) => setTargetRadiusFt(Number(event.target.value))}
              />
              <span className={styles.sliderValue}>{(targetRadiusFt * 12).toFixed(0)}"</span>
            </div>
          </div>

          <button type="button" className={styles.startButton} onClick={handleStartSession} disabled={starting}>
            {starting ? 'Starting…' : 'Start Live Session'}
          </button>

          {history.length ? (
            <div className={styles.historySection}>
              <p className={styles.historyTitle}>Past Sessions</p>
              <div style={{ display: 'grid', gap: 6 }}>
                {history.map((s) => (
                  <div key={s.id} className={styles.historyRow}>
                    <span>{new Date(s.startedAt).toLocaleDateString()}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className={styles.historyStatus}>{s.endedAt ? 'Completed' : 'In progress'}</span>
                      <button
                        type="button"
                        className={styles.deleteLink}
                        onClick={() => handleDeleteSession(s.id)}
                        disabled={deletingSessionId === s.id}
                      >
                        {deletingSessionId === s.id ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className={styles.liveLayout}>
          <div className={styles.liveHeader}>
            <p className={styles.pitchCounter}>
              Pitch <strong>#{pitches.length + (pendingTarget ? 1 : 0)}</strong>
              {lastMatchedPitch?.pitchType ? (
                <span className={styles.pitchTypeChip} style={{ color: lastPitchColor ?? undefined, borderColor: lastPitchColor ?? undefined }}>
                  {lastMatchedPitch.pitchType}
                </span>
              ) : null}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={styles.deleteLink}
                onClick={() => handleDeleteSession(activeSession.id)}
                disabled={deletingSessionId === activeSession.id}
              >
                {deletingSessionId === activeSession.id ? 'Deleting…' : 'Delete Session'}
              </button>
              <button type="button" className={styles.endButton} onClick={handleEndSession}>
                End Session
              </button>
            </div>
          </div>

          {pitcherMismatch ? (
            <div className={styles.mismatchBanner}>
              <strong>Pitcher mismatch:</strong> TrackMan's data is tagged for{' '}
              {pitcherMismatch.map((name, i) => (
                <span key={name}>
                  {i > 0 ? ', ' : ''}
                  <strong>{name}</strong>
                </span>
              ))}
              , not <strong>{pitcherName}</strong>. Double-check you picked the right TrackMan session before trusting this data.
            </div>
          ) : null}

          <div className={styles.contentGrid}>
            <div className={styles.zoneCard}>
              <div className={styles.zoneFrame}>
                <svg
                  viewBox={`0 0 ${ZONE_W} ${ZONE_H}`}
                  className={`${styles.zoneSvg} ${pendingTarget ? styles.locked : ''}`}
                  onClick={handleZoneClick}
                >
                  <polygon
                    points={`${zonePx(-0.75)},${zonePy(0.55)} ${zonePx(0.75)},${zonePy(0.55)} ${zonePx(0.75)},${zonePy(0.65)} ${zonePx(0)},${zonePy(0.75)} ${zonePx(-0.75)},${zonePy(0.65)}`}
                    fill="none"
                    stroke={ZONE_STROKE_STRONG}
                    strokeWidth="4"
                  />
                  <rect
                    x={zonePx(COMP_LEFT)}
                    y={zonePy(COMP_TOP)}
                    width={zonePx(COMP_RIGHT) - zonePx(COMP_LEFT)}
                    height={zonePy(COMP_BOTTOM) - zonePy(COMP_TOP)}
                    fill="none"
                    stroke={ZONE_STROKE}
                    strokeWidth="3"
                  />
                  <line x1={zonePx(COMP_LEFT)} y1={zonePy(STRIKE_CENTER_Y)} x2={zonePx(STRIKE_LEFT)} y2={zonePy(STRIKE_CENTER_Y)} stroke={ZONE_STROKE} strokeWidth="2.5" />
                  <line x1={zonePx(STRIKE_RIGHT)} y1={zonePy(STRIKE_CENTER_Y)} x2={zonePx(COMP_RIGHT)} y2={zonePy(STRIKE_CENTER_Y)} stroke={ZONE_STROKE} strokeWidth="2.5" />
                  <line x1={zonePx(STRIKE_CENTER_X)} y1={zonePy(COMP_BOTTOM)} x2={zonePx(STRIKE_CENTER_X)} y2={zonePy(STRIKE_BOTTOM)} stroke={ZONE_STROKE} strokeWidth="2.5" />
                  <line x1={zonePx(STRIKE_CENTER_X)} y1={zonePy(STRIKE_TOP)} x2={zonePx(STRIKE_CENTER_X)} y2={zonePy(COMP_TOP)} stroke={ZONE_STROKE} strokeWidth="2.5" />
                  <rect
                    x={zonePx(STRIKE_LEFT)}
                    y={zonePy(STRIKE_TOP)}
                    width={zonePx(STRIKE_RIGHT) - zonePx(STRIKE_LEFT)}
                    height={zonePy(STRIKE_BOTTOM) - zonePy(STRIKE_TOP)}
                    fill="none"
                    stroke={ZONE_STROKE_STRONG}
                    strokeWidth="5"
                  />
                  <line x1={zonePx(STRIKE_LEFT + (STRIKE_RIGHT - STRIKE_LEFT) / 3)} y1={zonePy(STRIKE_BOTTOM)} x2={zonePx(STRIKE_LEFT + (STRIKE_RIGHT - STRIKE_LEFT) / 3)} y2={zonePy(STRIKE_TOP)} stroke={ZONE_STROKE} strokeWidth="2" />
                  <line x1={zonePx(STRIKE_LEFT + ((STRIKE_RIGHT - STRIKE_LEFT) * 2) / 3)} y1={zonePy(STRIKE_BOTTOM)} x2={zonePx(STRIKE_LEFT + ((STRIKE_RIGHT - STRIKE_LEFT) * 2) / 3)} y2={zonePy(STRIKE_TOP)} stroke={ZONE_STROKE} strokeWidth="2" />
                  <line x1={zonePx(STRIKE_LEFT)} y1={zonePy(STRIKE_BOTTOM + (STRIKE_TOP - STRIKE_BOTTOM) / 3)} x2={zonePx(STRIKE_RIGHT)} y2={zonePy(STRIKE_BOTTOM + (STRIKE_TOP - STRIKE_BOTTOM) / 3)} stroke={ZONE_STROKE} strokeWidth="2" />
                  <line x1={zonePx(STRIKE_LEFT)} y1={zonePy(STRIKE_BOTTOM + ((STRIKE_TOP - STRIKE_BOTTOM) * 2) / 3)} x2={zonePx(STRIKE_RIGHT)} y2={zonePy(STRIKE_BOTTOM + ((STRIKE_TOP - STRIKE_BOTTOM) * 2) / 3)} stroke={ZONE_STROKE} strokeWidth="2" />

                  {pendingTarget ? (
                    <IntendedTargetGlove xFt={pendingTarget.sideFt} yFt={pendingTarget.heightFt} radiusFt={targetRadiusFt} />
                  ) : lastMatchedPitch ? (
                    <IntendedTargetGlove xFt={lastMatchedPitch.intendedSideFt} yFt={lastMatchedPitch.intendedHeightFt} radiusFt={lastMatchedPitch.targetRadiusFt} />
                  ) : null}

                  {lastMatchedPitch && !pendingTarget && lastMatchedPitch.plateLocSide !== null && lastMatchedPitch.plateLocHeight !== null ? (
                    <>
                      <line
                        x1={zonePx(lastMatchedPitch.intendedSideFt)}
                        y1={zonePy(lastMatchedPitch.intendedHeightFt)}
                        x2={zonePx(lastMatchedPitch.plateLocSide)}
                        y2={zonePy(lastMatchedPitch.plateLocHeight)}
                        stroke="rgba(248, 250, 252, 0.35)"
                        strokeWidth="1.5"
                        strokeDasharray="3 3"
                      />
                      <circle
                        key={lastMatchedPitch.id}
                        className={justLanded ? styles.actualDot : undefined}
                        cx={zonePx(lastMatchedPitch.plateLocSide)}
                        cy={zonePy(lastMatchedPitch.plateLocHeight)}
                        r="9"
                        fill={lastPitchColor ?? PITCH_COLORS.Undefined}
                        stroke={ZONE_STROKE_STRONG}
                        strokeWidth="2"
                      />
                    </>
                  ) : null}
                </svg>
              </div>

              {pendingTarget ? (
                <div className={styles.actionRow}>
                  <button type="button" className={styles.confirmButton} onClick={handleConfirmTarget}>
                    Confirm Target — Ready for Pitch
                  </button>
                  <button type="button" className={styles.resetButton} onClick={() => setPendingTarget(null)}>
                    Reset
                  </button>
                </div>
              ) : (
                <p className={styles.zoneHint}>
                  {activeSession.trackmanSessionId ? 'Tap the zone to set the next target.' : 'No TrackMan session linked — data will not auto-populate.'}
                </p>
              )}
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              {lastMatchedPitch ? (
                <div className={styles.statGrid}>
                  <StatTile label="Velocity" value={lastMatchedPitch.relSpeed !== null ? `${lastMatchedPitch.relSpeed.toFixed(1)}` : '—'} suffix="mph" />
                  <StatTile label="IVB" value={lastMatchedPitch.inducedVertBreak !== null ? lastMatchedPitch.inducedVertBreak.toFixed(1) : '—'} suffix='"' />
                  <StatTile label="HB" value={lastMatchedPitch.horzBreak !== null ? lastMatchedPitch.horzBreak.toFixed(1) : '—'} suffix='"' />
                  <StatTile
                    label="Miss Distance"
                    value={lastMatchedPitch.missDistanceFt !== null ? (lastMatchedPitch.missDistanceFt * 12).toFixed(1) : '—'}
                    suffix='"'
                    severity={lastMissSeverity}
                  />
                  <StatTile
                    label="Miss Direction"
                    value={lastMatchedPitch.missDirection ? MISS_DIRECTION_LABELS[lastMatchedPitch.missDirection] ?? lastMatchedPitch.missDirection : '—'}
                    small
                  />
                  <StatTile label="Target Size" value={(lastMatchedPitch.targetRadiusFt * 12).toFixed(0)} suffix='" radius' />
                </div>
              ) : (
                <div className={styles.waitingCard}>
                  <span className={styles.spinner} />
                  Waiting for the first pitch…
                </div>
              )}

              {sessionAverages ? (
                <div className={styles.summaryCard}>
                  <p className={styles.summaryTitle}>Session So Far — {sessionAverages.count} Pitches</p>
                  <div className={styles.summaryStats}>
                    <span className={styles.summaryStat}>
                      Avg miss: <strong>{(sessionAverages.avgMiss * 12).toFixed(1)}"</strong>
                    </span>
                    <span className={styles.summaryStat}>
                      On target: <strong>{sessionAverages.onTargetPct.toFixed(0)}%</strong>
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {pitches.length ? (
            <div className={styles.logSection}>
              <p className={styles.logTitle}>Pitch Log</p>
              <div className={styles.logScroll}>
                <table className={styles.logTable}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Type</th>
                      <th>Velo</th>
                      <th>IVB</th>
                      <th>HB</th>
                      <th>Miss</th>
                      <th>Direction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...pitches].reverse().map((p) => {
                      const severity = missSeverity(p.missDistanceFt);
                      const color = PITCH_COLORS[p.pitchType ?? 'Undefined'] ?? PITCH_COLORS.Undefined;
                      return (
                        <tr key={p.id}>
                          <td>{p.pitchIndex}</td>
                          <td>
                            <span className={styles.logPitchType}>
                              <span className={styles.logPitchDot} style={{ background: color }} />
                              {p.pitchType ?? '—'}
                            </span>
                          </td>
                          <td>{p.relSpeed !== null ? p.relSpeed.toFixed(1) : '—'}</td>
                          <td>{p.inducedVertBreak !== null ? p.inducedVertBreak.toFixed(1) : '—'}</td>
                          <td>{p.horzBreak !== null ? p.horzBreak.toFixed(1) : '—'}</td>
                          <td className={severity ? `${styles.logMissDistance} ${styles[severity]}` : undefined}>
                            {p.missDistanceFt !== null ? `${(p.missDistanceFt * 12).toFixed(1)}"` : '—'}
                          </td>
                          <td>{p.missDirection ? MISS_DIRECTION_LABELS[p.missDirection] ?? p.missDirection : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      )}
      </div>
    </div>
  );
}

function IntendedTargetGlove({ xFt, yFt, radiusFt }: { xFt: number; yFt: number; radiusFt: number }) {
  const cx = zonePx(xFt);
  const cy = zonePy(yFt);
  const r = radiusFt * ZONE_SCALE;

  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="rgba(74, 222, 128, 0.18)" stroke="#4ade80" strokeWidth={2} strokeDasharray="5 4" />
      <circle cx={cx} cy={cy} r={3} fill="#4ade80" />
    </g>
  );
}

function StatTile({
  label,
  value,
  suffix,
  severity,
  small,
}: {
  label: string;
  value: string;
  suffix?: string;
  severity?: 'good' | 'warn' | 'bad' | null;
  small?: boolean;
}) {
  return (
    <div className={styles.statTile}>
      <p className={`${styles.statValue} ${severity ? styles[severity] : ''}`} style={small ? { fontSize: '1rem' } : undefined}>
        {value}
        {suffix ? <span style={{ fontSize: '0.9rem', fontWeight: 600, opacity: 0.7, marginLeft: 2 }}>{suffix}</span> : null}
      </p>
      <p className={styles.statLabel}>{label}</p>
    </div>
  );
}
