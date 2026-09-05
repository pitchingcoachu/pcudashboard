'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pitchLocationLabel } from '../../../lib/pitch-location';
import { downloadContentPdf } from '../../../lib/leaderboard-pdf-export';
import IntendedZoneStats, { DirectionHeatmap, emptyIntendedZoneDirectionBreakdown, type MissDirection } from './intended-zone-stats';
import IntendedZoneTargeting from './intended-zone-targeting';
import IntendedZonePitchLog from './intended-zone-pitch-log';
import LiveFlightReplay from './live-flight-replay';
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

// Fixed target-size presets (diameter in inches -> radius in feet) --
// replaced the old free-form slider so every session only ever uses one of
// these sizes, matching the fixed set mobile offers and keeping the
// stats page's "N" Target Hit%" columns limited to exactly these sizes.
const TARGET_SIZE_PRESETS: { label: string; radiusFt: number }[] = [
  { label: '4"', radiusFt: 2 / 12 },
  { label: '8"', radiusFt: 4 / 12 },
  { label: '12"', radiusFt: 6 / 12 },
  { label: '16"', radiusFt: 8 / 12 },
  { label: '20"', radiusFt: 10 / 12 },
];
const TARGET_RADIUS_DEFAULT_FT = TARGET_SIZE_PRESETS[1].radiusFt;

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
  pitcherThrows: string | null;
  flightData: {
    position: { x: number; y: number; z: number };
    velocity: { x: number; y: number; z: number };
    acceleration: { x: number; y: number; z: number };
    releaseSideFt: number | null;
    releaseHeightFt: number | null;
    releaseExtensionFt: number | null;
  } | null;
};

type IntendedZoneSessionMode = 'live' | 'ftp_deferred' | 'manual';

type IntendedZoneSession = {
  id: number;
  organizationId: number;
  pitcherName: string | null;
  trackmanSessionId: string | null;
  targetRadiusFt: number;
  startedAt: string;
  endedAt: string | null;
  mode: IntendedZoneSessionMode;
};

function modeLabel(mode: IntendedZoneSessionMode): string {
  if (mode === 'ftp_deferred') return 'FTP Sync';
  if (mode === 'manual') return 'Manual';
  return 'Live';
}

type TrackmanDiscoveredSession = {
  sessionId: string;
  gameDateLocal: string;
  sessionType: string;
  location?: string | null;
  state?: string | null;
};

const POLL_INTERVAL_MS = 2000;
const DATA_API_SYNC_EVERY_POLLS = 8;

export default function IntendedZonePanel({
  pitcherName,
  startDate,
  endDate,
  selectedPitchTypes,
  selectedBallTypes,
}: {
  pitcherName: string | null;
  startDate?: string;
  endDate?: string;
  selectedPitchTypes?: string[];
  selectedBallTypes?: string[];
}) {
  const [page, setPage] = useState<'live' | 'stats' | 'targeting' | 'pitchLog' | 'strikeZoneTest'>('live');
  const [mode, setMode] = useState<IntendedZoneSessionMode>('live');
  const [activeSession, setActiveSession] = useState<IntendedZoneSession | null>(null);
  const [discoveredSessions, setDiscoveredSessions] = useState<TrackmanDiscoveredSession[]>([]);
  const [selectedTrackmanSessionId, setSelectedTrackmanSessionId] = useState('');
  const [targetRadiusFt, setTargetRadiusFt] = useState(TARGET_RADIUS_DEFAULT_FT);
  const [pitches, setPitches] = useState<IntendedZonePitch[]>([]);
  const [pendingTarget, setPendingTarget] = useState<{ sideFt: number; heightFt: number } | null>(null);
  const [manualActual, setManualActual] = useState<{ sideFt: number; heightFt: number } | null>(null);
  const [manualPitchType, setManualPitchType] = useState('');
  const [lastManualPitchId, setLastManualPitchId] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const [checkingFtp, setCheckingFtp] = useState(false);
  const [resettingMatches, setResettingMatches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollWarning, setPollWarning] = useState<string | null>(null);
  const [discoveryWarning, setDiscoveryWarning] = useState<string | null>(null);
  const [history, setHistory] = useState<IntendedZoneSession[]>([]);
  const [deletingSessionId, setDeletingSessionId] = useState<number | null>(null);
  const [resumingSessionId, setResumingSessionId] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const fallbackSyncInFlightRef = useRef(false);
  const pollCountRef = useRef(0);
  const sessionExportRef = useRef<HTMLDivElement | null>(null);
  const [isExportingSessionPdf, setIsExportingSessionPdf] = useState(false);
  const lastSeenPitchId = useRef<number | null>(null);
  const [justLanded, setJustLanded] = useState(false);
  const activeQueuedTargetIdRef = useRef<number | null>(null);
  const targetPlacementVersionRef = useRef(0);
  const targetWriteChainRef = useRef<Promise<void>>(Promise.resolve());
  const projectorRef = useRef<HTMLDivElement | null>(null);
  const [projectorFullscreen, setProjectorFullscreen] = useState(false);
  const [showFlightReplay, setShowFlightReplay] = useState(true);
  // null means follow the newest pitch as live data arrives. Selecting an
  // older pitch pauses that auto-follow behavior until navigation returns to
  // the newest pitch.
  const [selectedFlightPitchId, setSelectedFlightPitchId] = useState<number | null>(null);

  useEffect(() => {
    const updateFullscreenState = () => setProjectorFullscreen(document.fullscreenElement === projectorRef.current);
    document.addEventListener('fullscreenchange', updateFullscreenState);
    return () => document.removeEventListener('fullscreenchange', updateFullscreenState);
  }, []);

  const loadDiscoveredSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/dashboard/pitching/intended-zone/sessions?discover=1');
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to load TrackMan sessions.');
      setDiscoveredSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
      setDiscoveryWarning(null);
    } catch {
      // Session discovery is optional: coaches can start unlinked and attach
      // later. A brief TrackMan/browser failure must not poison the entire
      // Intended Zones page with a raw DOMException.
      setDiscoveryWarning('Live TrackMan sessions are temporarily unavailable. You can still start unlinked or try again.');
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
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    pollCountRef.current += 1;
    const syncFallback = pollCountRef.current % DATA_API_SYNC_EVERY_POLLS === 0;
    try {
      const params = new URLSearchParams({ sessionId: String(sessionId) });
      const response = await fetch(`/api/dashboard/pitching/intended-zone/pitches?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to poll for pitches.');
      const nextPitches: IntendedZonePitch[] = Array.isArray(payload.pitches) ? payload.pitches : [];
      const queuedTargets = nextPitches.filter((pitch) => !pitch.trackmanPlayId && pitch.plateLocSide === null && pitch.plateLocHeight === null);
      const nextQueuedTarget = queuedTargets.length ? queuedTargets[0] : null;
      const previouslyActiveTargetId = activeQueuedTargetIdRef.current;
      if (nextQueuedTarget) {
        activeQueuedTargetIdRef.current = nextQueuedTarget.id;
        // Hydrate a pending target when resuming/reloading. While a local
        // move is already visible, don't let a slightly older poll snap it
        // back before the serialized PUT finishes.
        if (previouslyActiveTargetId === null || previouslyActiveTargetId !== nextQueuedTarget.id) {
          setPendingTarget({ sideFt: nextQueuedTarget.intendedSideFt, heightFt: nextQueuedTarget.intendedHeightFt });
          setTargetRadiusFt(nextQueuedTarget.targetRadiusFt);
        }
      } else if (previouslyActiveTargetId !== null) {
        activeQueuedTargetIdRef.current = null;
        setPendingTarget(null);
      }
      const matched = nextPitches.filter((p) => p.trackmanPlayId);
      const newest = matched.length ? matched[matched.length - 1] : null;
      if (newest && newest.id !== lastSeenPitchId.current) {
        lastSeenPitchId.current = newest.id;
        setJustLanded(true);
        setTimeout(() => setJustLanded(false), 550);
      }
      setPitches(nextPitches);
      setPollWarning(null);

      // TrackMan's pull API is useful for classification enrichment and as a
      // delivery fallback, but it can take several seconds. Run it separately
      // so a slow upstream response never freezes the two-second webhook loop.
      if (syncFallback && !fallbackSyncInFlightRef.current) {
        fallbackSyncInFlightRef.current = true;
        const fallbackParams = new URLSearchParams({ sessionId: String(sessionId), fallback: '1' });
        void fetch(`/api/dashboard/pitching/intended-zone/pitches?${fallbackParams.toString()}`, { cache: 'no-store' })
          .catch(() => undefined)
          .finally(() => {
            fallbackSyncInFlightRef.current = false;
          });
      }
    } catch {
      // Keep the existing data visible and
      // clear this notice automatically as soon as the next poll succeeds.
      setPollWarning('Live pitch refresh was briefly interrupted. Retrying automatically…');
    } finally {
      pollInFlightRef.current = false;
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
          trackmanSessionId: mode === 'live' ? selectedTrackmanSessionId || null : null,
          targetRadiusFt,
          mode,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to start session.');
      setActiveSession(payload.session);
      setPitches([]);
      setPendingTarget(null);
      setManualActual(null);
      setLastManualPitchId(null);
      setSelectedFlightPitchId(null);
      lastSeenPitchId.current = null;
      activeQueuedTargetIdRef.current = null;
      pollCountRef.current = 0;
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
      setSelectedFlightPitchId(null);
      activeQueuedTargetIdRef.current = null;
      loadHistory();
    }
  }

  async function handleExportSessionPdf() {
    const wrapNode = sessionExportRef.current;
    if (!wrapNode || !activeSession) return;
    setIsExportingSessionPdf(true);
    setError(null);
    try {
      const dateLabel = new Date(activeSession.startedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const safeName = (pitcherName || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await downloadContentPdf({
        node: wrapNode,
        titleText: `Intended Target Session — ${pitcherName ?? 'Unknown Pitcher'}`,
        subtitleText: [modeLabel(activeSession.mode), dateLabel].filter(Boolean).join('  ·  '),
        fileName: `intended-zone-session-${safeName}.pdf`,
        // Also embedded in a narrower sidebar column (Bullpen Scripts page) --
        // force the same wide desktop layout regardless of where it's rendered.
        forceWidth: 1100,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export session PDF.');
    } finally {
      setIsExportingSessionPdf(false);
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
        setSelectedFlightPitchId(null);
        activeQueuedTargetIdRef.current = null;
      }
      setHistory((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete session.');
    } finally {
      setDeletingSessionId(null);
    }
  }

  async function handleResumeSession(target: IntendedZoneSession) {
    setResumingSessionId(target.id);
    setError(null);
    try {
      let sessionToOpen = target;
      if (target.endedAt) {
        // Completed sessions are frozen server-side (ended_at set) -- clear
        // it first so the pitch log becomes editable again (delete a bad
        // pitch, etc.). Re-ending it when done is the coach's own next step,
        // same "End Session" button as any other open session.
        const response = await fetch('/api/dashboard/pitching/intended-zone/sessions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: target.id, action: 'reopen' }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Failed to reopen session.');
        sessionToOpen = { ...target, endedAt: null };
        setHistory((prev) => prev.map((s) => (s.id === target.id ? { ...s, endedAt: null } : s)));
      }
      setActiveSession(sessionToOpen);
      setPendingTarget(null);
      setManualActual(null);
      setLastManualPitchId(null);
      setSelectedFlightPitchId(null);
      lastSeenPitchId.current = null;
      activeQueuedTargetIdRef.current = null;
      pollCountRef.current = 0;
      await poll(target.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resume session.');
    } finally {
      setResumingSessionId(null);
    }
  }

  function placeOrMoveLiveTarget(target: { sideFt: number; heightFt: number }) {
    if (!activeSession || activeSession.mode === 'manual') return;
    const sessionId = activeSession.id;
    const placementVersion = targetPlacementVersionRef.current + 1;
    targetPlacementVersionRef.current = placementVersion;
    setPendingTarget(target);
    setError(null);
    targetWriteChainRef.current = targetWriteChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const response = await fetch('/api/dashboard/pitching/intended-zone/pitches', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            intendedSideFt: target.sideFt,
            intendedHeightFt: target.heightFt,
            targetRadiusFt,
          }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error ?? 'Failed to place target.');
        activeQueuedTargetIdRef.current = Number(payload.pitchId) || null;
      })
      .catch((placementError) => {
        if (targetPlacementVersionRef.current === placementVersion) setPendingTarget(null);
        setError(placementError instanceof Error ? placementError.message : 'Failed to place target.');
      });
  }

  function handleZoneClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!activeSession) return;
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * ZONE_W;
    const py = ((event.clientY - rect.top) / rect.height) * ZONE_H;
    const sideFt = pxToFeetX(px);
    const heightFt = pxToFeetY(py);

    if (activeSession.mode === 'manual') {
      if (!pendingTarget) setPendingTarget({ sideFt, heightFt });
      else if (!manualActual) setManualActual({ sideFt, heightFt });
      return;
    }
    placeOrMoveLiveTarget({ sideFt, heightFt });
  }

  async function handleConfirmManualPitch() {
    if (!activeSession || !pendingTarget || !manualActual) return;
    try {
      const response = await fetch('/api/dashboard/pitching/intended-zone/pitches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.id,
          intendedSideFt: pendingTarget.sideFt,
          intendedHeightFt: pendingTarget.heightFt,
          targetRadiusFt,
          manual: true,
          actualSideFt: manualActual.sideFt,
          actualHeightFt: manualActual.heightFt,
          pitchType: manualPitchType || null,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to record pitch.');
      setLastManualPitchId(payload.pitch?.id ?? null);
      setPendingTarget(null);
      setManualActual(null);
      setManualPitchType('');
      await poll(activeSession.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record pitch.');
    }
  }

  async function handleUndoLastManualPitch() {
    if (!activeSession || !lastManualPitchId) return;
    try {
      await fetch(`/api/dashboard/pitching/intended-zone/pitches?pitchId=${lastManualPitchId}`, { method: 'DELETE' });
      setLastManualPitchId(null);
      await poll(activeSession.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to undo pitch.');
    }
  }

  async function handleDeletePitch(pitchId: number) {
    if (!activeSession) return;
    if (!window.confirm('Delete this pitch? This cannot be undone.')) return;
    try {
      await fetch(`/api/dashboard/pitching/intended-zone/pitches?pitchId=${pitchId}`, { method: 'DELETE' });
      setPitches((prev) => prev.filter((p) => p.id !== pitchId));
      setSelectedFlightPitchId((selectedId) => selectedId === pitchId ? null : selectedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete pitch.');
    }
  }

  async function handleCheckFtpMatch() {
    if (!activeSession) return;
    setCheckingFtp(true);
    setError(null);
    try {
      const response = await fetch('/api/dashboard/pitching/intended-zone/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.id, action: 'check_ftp_match' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to check for matches.');
      window.alert(payload.matched > 0 ? `Matched ${payload.matched} pitch${payload.matched === 1 ? '' : 'es'}.` : 'No new matches yet — try again after the next FTP sync.');
      await poll(activeSession.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check for matches.');
    } finally {
      setCheckingFtp(false);
    }
  }

  // Clears already-matched pitches back to pending so "Check for Matches"
  // can redo them -- for when a session was matched before a matching-logic
  // fix, or against data that later turned out to be wrong/incomplete.
  async function handleResetMatches() {
    if (!activeSession) return;
    if (!window.confirm('Clear all matched results for this session and re-match from scratch? This cannot be undone.')) return;
    setResettingMatches(true);
    setError(null);
    try {
      const response = await fetch('/api/dashboard/pitching/intended-zone/sessions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.id, action: 'reset_matches' }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to reset matches.');
      await poll(activeSession.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset matches.');
    } finally {
      setResettingMatches(false);
    }
  }

  const matchedPitches = useMemo(() => {
    return pitches
      .filter((pitch) => pitch.trackmanPlayId)
      .sort((a, b) => a.pitchIndex - b.pitchIndex || a.id - b.id);
  }, [pitches]);

  const lastMatchedPitch = matchedPitches.length ? matchedPitches[matchedPitches.length - 1] : null;
  const selectedFlightPitchIndex = selectedFlightPitchId === null
    ? matchedPitches.length - 1
    : matchedPitches.findIndex((pitch) => pitch.id === selectedFlightPitchId);
  const normalizedFlightPitchIndex = selectedFlightPitchIndex >= 0 ? selectedFlightPitchIndex : matchedPitches.length - 1;
  const viewedFlightPitch = normalizedFlightPitchIndex >= 0 ? matchedPitches[normalizedFlightPitchIndex] : null;
  const followingLiveFlight = selectedFlightPitchId === null || normalizedFlightPitchIndex === matchedPitches.length - 1;

  const viewPreviousFlight = useCallback(() => {
    if (normalizedFlightPitchIndex <= 0) return;
    setSelectedFlightPitchId(matchedPitches[normalizedFlightPitchIndex - 1].id);
  }, [matchedPitches, normalizedFlightPitchIndex]);

  const viewNextFlight = useCallback(() => {
    if (normalizedFlightPitchIndex < 0 || normalizedFlightPitchIndex >= matchedPitches.length - 1) return;
    const nextIndex = normalizedFlightPitchIndex + 1;
    setSelectedFlightPitchId(nextIndex === matchedPitches.length - 1 ? null : matchedPitches[nextIndex].id);
  }, [matchedPitches, normalizedFlightPitchIndex]);

  const lastQueuedPitch = useMemo(() => {
    const queued = pitches.filter((pitch) => !pitch.trackmanPlayId && pitch.plateLocSide === null && pitch.plateLocHeight === null);
    return queued.length ? queued[0] : null;
  }, [pitches]);

  const sessionAverages = useMemo(() => {
    const matched = pitches.filter((p) => p.missDistanceFt !== null);
    if (!matched.length) return null;
    const avgMiss = matched.reduce((sum, p) => sum + (p.missDistanceFt ?? 0), 0) / matched.length;
    const onTarget = matched.filter((p) => p.missDirection === 'on-target').length;
    return { avgMiss, onTargetPct: (onTarget / matched.length) * 100, count: matched.length };
  }, [pitches]);

  // Running in-zone / competitive-zone tallies, overall and per pitch type --
  // uses the same canonical strike-zone bounds as everywhere else in the
  // dashboard (lib/pitch-location.ts), not the visual target circle, so
  // these numbers mean the same thing as "InZone%" anywhere else in the app.
  const zoneTallies = useMemo(() => {
    const matched = pitches.filter((p) => p.trackmanPlayId);
    if (!matched.length) return null;

    function tally(list: typeof matched) {
      let inZoneN = 0;
      let competitiveN = 0;
      for (const p of list) {
        const label = pitchLocationLabel(p.plateLocSide, p.plateLocHeight);
        if (label === 'Yes') inZoneN += 1;
        if (label === 'Yes' || label === 'Competitive') competitiveN += 1;
      }
      return { inZoneN, competitiveN, total: list.length };
    }

    const byType = new Map<string, ReturnType<typeof tally>>();
    for (const p of matched) {
      const key = p.pitchType ?? 'Untagged';
      if (!byType.has(key)) byType.set(key, tally(matched.filter((m) => (m.pitchType ?? 'Untagged') === key)));
    }

    return { overall: tally(matched), byType };
  }, [pitches]);

  const liveDirectionBreakdown = useMemo(() => {
    const breakdown = emptyIntendedZoneDirectionBreakdown();
    for (const p of pitches) {
      if (p.missDirection) breakdown[p.missDirection as MissDirection] += 1;
    }
    return breakdown;
  }, [pitches]);

  // Drives which screen side (left/right) the live direction heatmap
  // renders "glove" vs "arm" in -- majority vote across this session's
  // pitches (virtually always unanimous, one session = one pitcher).
  const liveThrowsLeft = useMemo(() => {
    if (!pitches.length) return false;
    const leftN = pitches.filter((p) => String(p.pitcherThrows ?? '').trim().toLowerCase().startsWith('l')).length;
    return leftN * 2 > pitches.length;
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
  const viewedMissSeverity = viewedFlightPitch ? missSeverity(viewedFlightPitch.missDistanceFt) : null;

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
      <button
        type="button"
        className={styles.resetButton}
        style={page === 'targeting' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
        onClick={() => setPage('targeting')}
      >
        Targeting
      </button>
      <button
        type="button"
        className={styles.resetButton}
        style={page === 'pitchLog' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
        onClick={() => setPage('pitchLog')}
      >
        Pitch Log
      </button>
      <button
        type="button"
        className={styles.resetButton}
        style={page === 'strikeZoneTest' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
        onClick={() => setPage('strikeZoneTest')}
      >
        Strike Zone Test
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
          sidebarBallTypes={selectedBallTypes ?? ['Baseball']}
        />
      </div>
    );
  }

  if (page === 'targeting') {
    return (
      <div>
        {pageSwitcher}
        <IntendedZoneTargeting
          pitcherName={pitcherName}
          startDate={startDate ?? ''}
          endDate={endDate ?? ''}
          selectedPitchTypes={selectedPitchTypes ?? ['All']}
          selectedBallTypes={selectedBallTypes ?? ['Baseball']}
        />
      </div>
    );
  }

  if (page === 'pitchLog') {
    return (
      <div>
        {pageSwitcher}
        <IntendedZonePitchLog
          pitcherName={pitcherName}
          startDate={startDate ?? ''}
          endDate={endDate ?? ''}
          selectedPitchTypes={selectedPitchTypes ?? ['All']}
          selectedBallTypes={selectedBallTypes ?? ['Baseball']}
        />
      </div>
    );
  }

  if (page === 'strikeZoneTest') {
    const projectedTarget = pendingTarget
      ?? (lastQueuedPitch ? { sideFt: lastQueuedPitch.intendedSideFt, heightFt: lastQueuedPitch.intendedHeightFt, radiusFt: lastQueuedPitch.targetRadiusFt } : null)
      ?? (lastMatchedPitch ? { sideFt: lastMatchedPitch.intendedSideFt, heightFt: lastMatchedPitch.intendedHeightFt, radiusFt: lastMatchedPitch.targetRadiusFt } : null);
    const projectedRadius = projectedTarget && 'radiusFt' in projectedTarget ? projectedTarget.radiusFt : targetRadiusFt;
    const showActual = Boolean(
      !pendingTarget
      && !lastQueuedPitch
      && lastMatchedPitch
      && lastMatchedPitch.plateLocSide !== null
      && lastMatchedPitch.plateLocHeight !== null,
    );

    const toggleProjectorFullscreen = async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await projectorRef.current?.requestFullscreen();
      } catch (fullscreenError) {
        setError(fullscreenError instanceof Error ? fullscreenError.message : 'Unable to enter full screen.');
      }
    };

    return (
      <div ref={projectorRef} className={styles.projectorShell}>
        <div className={styles.projectorUtilityDock}>
          <button type="button" onClick={() => void toggleProjectorFullscreen()}>
            {projectorFullscreen ? 'Exit Full Screen' : 'Full Screen'}
          </button>
          <button type="button" onClick={() => setPage('live')}>Exit Test</button>
        </div>

        {!activeSession ? (
          <div className={styles.projectorEmpty}>
            <div className={styles.projectorEmptyZone} aria-hidden="true" />
            <strong>Start or resume a session first</strong>
            <span>Select Live Webhook, FTP Sync, or Manual in Live Tracking, then return here.</span>
            <button type="button" onClick={() => setPage('live')}>Open Live Tracking</button>
          </div>
        ) : (
          <div className={styles.projectorStage}>
            <svg
              viewBox={`0 0 ${ZONE_W} ${ZONE_H}`}
              className={styles.projectorZoneSvg}
              onClick={handleZoneClick}
              role="img"
              aria-label="Projected strike zone target"
            >
              <rect x={zonePx(COMP_LEFT)} y={zonePy(COMP_TOP)} width={zonePx(COMP_RIGHT) - zonePx(COMP_LEFT)} height={zonePy(COMP_BOTTOM) - zonePy(COMP_TOP)} fill="none" stroke="var(--projector-zone-stroke)" strokeWidth="4.5" />
              <line x1={zonePx(COMP_LEFT)} y1={zonePy(STRIKE_CENTER_Y)} x2={zonePx(STRIKE_LEFT)} y2={zonePy(STRIKE_CENTER_Y)} stroke="var(--projector-zone-stroke)" strokeWidth="3.5" />
              <line x1={zonePx(STRIKE_RIGHT)} y1={zonePy(STRIKE_CENTER_Y)} x2={zonePx(COMP_RIGHT)} y2={zonePy(STRIKE_CENTER_Y)} stroke="var(--projector-zone-stroke)" strokeWidth="3.5" />
              <line x1={zonePx(STRIKE_CENTER_X)} y1={zonePy(COMP_BOTTOM)} x2={zonePx(STRIKE_CENTER_X)} y2={zonePy(STRIKE_BOTTOM)} stroke="var(--projector-zone-stroke)" strokeWidth="3.5" />
              <line x1={zonePx(STRIKE_CENTER_X)} y1={zonePy(STRIKE_TOP)} x2={zonePx(STRIKE_CENTER_X)} y2={zonePy(COMP_TOP)} stroke="var(--projector-zone-stroke)" strokeWidth="3.5" />
              <rect x={zonePx(STRIKE_LEFT)} y={zonePy(STRIKE_TOP)} width={zonePx(STRIKE_RIGHT) - zonePx(STRIKE_LEFT)} height={zonePy(STRIKE_BOTTOM) - zonePy(STRIKE_TOP)} fill="var(--projector-zone-fill)" stroke="var(--projector-zone-strong)" strokeWidth="7" />
              <line x1={zonePx(STRIKE_LEFT + (STRIKE_RIGHT - STRIKE_LEFT) / 3)} y1={zonePy(STRIKE_BOTTOM)} x2={zonePx(STRIKE_LEFT + (STRIKE_RIGHT - STRIKE_LEFT) / 3)} y2={zonePy(STRIKE_TOP)} stroke="var(--projector-zone-stroke)" strokeWidth="3" />
              <line x1={zonePx(STRIKE_LEFT + ((STRIKE_RIGHT - STRIKE_LEFT) * 2) / 3)} y1={zonePy(STRIKE_BOTTOM)} x2={zonePx(STRIKE_LEFT + ((STRIKE_RIGHT - STRIKE_LEFT) * 2) / 3)} y2={zonePy(STRIKE_TOP)} stroke="var(--projector-zone-stroke)" strokeWidth="3" />
              <line x1={zonePx(STRIKE_LEFT)} y1={zonePy(STRIKE_BOTTOM + (STRIKE_TOP - STRIKE_BOTTOM) / 3)} x2={zonePx(STRIKE_RIGHT)} y2={zonePy(STRIKE_BOTTOM + (STRIKE_TOP - STRIKE_BOTTOM) / 3)} stroke="var(--projector-zone-stroke)" strokeWidth="3" />
              <line x1={zonePx(STRIKE_LEFT)} y1={zonePy(STRIKE_BOTTOM + ((STRIKE_TOP - STRIKE_BOTTOM) * 2) / 3)} x2={zonePx(STRIKE_RIGHT)} y2={zonePy(STRIKE_BOTTOM + ((STRIKE_TOP - STRIKE_BOTTOM) * 2) / 3)} stroke="var(--projector-zone-stroke)" strokeWidth="3" />
              {Array.from({ length: 9 }, (_, index) => {
                const column = index % 3;
                const row = Math.floor(index / 3);
                const x = STRIKE_LEFT + ((STRIKE_RIGHT - STRIKE_LEFT) / 3) * (column + 0.5);
                const y = STRIKE_TOP - ((STRIKE_TOP - STRIKE_BOTTOM) / 3) * (row + 0.5);
                return <text key={index + 1} x={zonePx(x)} y={zonePy(y)} className={styles.projectorPocketNumber}>{index + 1}</text>;
              })}
              <text x={zonePx(-1.19)} y={zonePy(3.825)} className={styles.projectorPocketNumber}>10</text>
              <text x={zonePx(1.19)} y={zonePy(3.825)} className={styles.projectorPocketNumber}>11</text>
              <text x={zonePx(-1.19)} y={zonePy(1.275)} className={styles.projectorPocketNumber}>12</text>
              <text x={zonePx(1.19)} y={zonePy(1.275)} className={styles.projectorPocketNumber}>13</text>

              {projectedTarget ? <IntendedTargetGlove xFt={projectedTarget.sideFt} yFt={projectedTarget.heightFt} radiusFt={projectedRadius} /> : null}
              {activeSession.mode === 'manual' && manualActual ? (
                <circle cx={zonePx(manualActual.sideFt)} cy={zonePy(manualActual.heightFt)} r="12" fill={PITCH_COLORS[manualPitchType] ?? PITCH_COLORS.Undefined} stroke="var(--projector-zone-strong)" strokeWidth="3.5" />
              ) : null}
              {showActual && lastMatchedPitch && lastMatchedPitch.plateLocSide !== null && lastMatchedPitch.plateLocHeight !== null ? (
                <>
                  <line x1={zonePx(lastMatchedPitch.intendedSideFt)} y1={zonePy(lastMatchedPitch.intendedHeightFt)} x2={zonePx(lastMatchedPitch.plateLocSide)} y2={zonePy(lastMatchedPitch.plateLocHeight)} stroke="var(--projector-zone-connector)" strokeWidth="3" strokeDasharray="6 4" />
                  <circle className={justLanded ? styles.actualDot : undefined} cx={zonePx(lastMatchedPitch.plateLocSide)} cy={zonePy(lastMatchedPitch.plateLocHeight)} r="12" fill={lastPitchColor ?? PITCH_COLORS.Undefined} stroke="var(--projector-zone-strong)" strokeWidth="3.5" />
                </>
              ) : null}
            </svg>

            <div className={`${styles.projectorControlDock} ${activeSession.mode === 'manual' && pendingTarget ? styles.projectorControlDockActive : ''}`}>
              {activeSession.mode === 'manual' && pendingTarget && manualActual ? (
                <>
                  <select value={manualPitchType} onChange={(event) => setManualPitchType(event.target.value)} aria-label="Pitch type">
                    <option value="">Pitch type…</option>
                    {Object.keys(PITCH_COLORS).filter((type) => type !== 'Undefined').map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                  <button type="button" onClick={handleConfirmManualPitch}>Save Pitch</button>
                  <button type="button" onClick={() => { setPendingTarget(null); setManualActual(null); setManualPitchType(''); }}>Reset</button>
                </>
              ) : activeSession.mode === 'manual' && pendingTarget ? (
                <><span>Tap actual location</span><button type="button" onClick={() => setPendingTarget(null)}>Reset</button></>
              ) : activeSession.mode !== 'manual' && pendingTarget ? (
                <span>Target ready · tap elsewhere to move it</span>
              ) : (
                <span>Tap anywhere to place the next target</span>
              )}
            </div>
          </div>
        )}
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
          <h3 className={styles.title}>Intended Target{pitcherName ? ` — ${pitcherName}` : ''}</h3>
          <p className={styles.subtitle}>Tap where the pitcher is aiming before each pitch — TrackMan fills in where it actually went.</p>
        </div>
        {activeSession ? (
          <span className={styles.liveBadge}>
            <span className={styles.liveDot} />
            {modeLabel(activeSession.mode)}
          </span>
        ) : null}
      </div>

      {error ? <p className={styles.errorBanner}>{error}</p> : null}
      {!error && pollWarning ? <p className={styles.errorBanner}>{pollWarning}</p> : null}

      {!pitcherName ? (
        <p className={styles.noPitcher}>Select a single pitcher above (Split By Pitcher, one selected) to start a live session.</p>
      ) : !activeSession ? (
        <div className={styles.setupGrid}>
          <div className={styles.field}>
            <label className={styles.fieldLabel}>Tracking Mode</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                className={styles.resetButton}
                style={mode === 'live' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
                onClick={() => setMode('live')}
              >
                Live (TrackMan webhook)
              </button>
              <button
                type="button"
                className={styles.resetButton}
                style={mode === 'ftp_deferred' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
                onClick={() => setMode('ftp_deferred')}
              >
                FTP Sync (fills in later)
              </button>
              <button
                type="button"
                className={styles.resetButton}
                style={mode === 'manual' ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
                onClick={() => setMode('manual')}
              >
                Manual (no TrackMan)
              </button>
            </div>
            {mode === 'ftp_deferred' ? (
              <p className={styles.zoneHint} style={{ textAlign: 'left', marginTop: 8 }}>
                No live TrackMan feed needed. Queue targets now; results fill in automatically once your next FTP/CSV sync ingests this bullpen&apos;s
                data.
              </p>
            ) : null}
            {mode === 'manual' ? (
              <p className={styles.zoneHint} style={{ textAlign: 'left', marginTop: 8 }}>
                No TrackMan at all. Click the intended target, then click again where the pitch actually landed.
              </p>
            ) : null}
          </div>

          {mode === 'live' ? (
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
                    {new Date(s.gameDateLocal).toLocaleString()} ({s.sessionType}){s.location ? ` — ${s.location}` : ''}
                  </option>
                ))}
              </select>
              {discoveryWarning ? (
                <p className={styles.zoneHint} style={{ textAlign: 'left', marginTop: 8 }}>
                  {discoveryWarning}{' '}
                  <button type="button" className={styles.inlineButton} onClick={loadDiscoveredSessions}>Try again</button>
                </p>
              ) : null}
            </div>
          ) : null}

          <div className={styles.field}>
            <label className={styles.fieldLabel}>Target Size</label>
            <div style={{ display: 'flex', gap: 8 }}>
              {TARGET_SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  className={styles.resetButton}
                  style={targetRadiusFt === preset.radiusFt ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
                  onClick={() => setTargetRadiusFt(preset.radiusFt)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <button type="button" className={styles.startButton} onClick={handleStartSession} disabled={starting}>
            {starting ? 'Starting…' : 'Start Session'}
          </button>

          {history.length ? (
            <div className={styles.historySection}>
              <p className={styles.historyTitle}>Past Sessions</p>
              <div style={{ display: 'grid', gap: 6 }}>
                {history.map((s) => (
                  <div key={s.id} className={styles.historyRow}>
                    <span
                      style={resumingSessionId === s.id ? undefined : { cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={resumingSessionId === s.id ? undefined : () => handleResumeSession(s)}
                    >
                      {new Date(s.startedAt).toLocaleDateString()} — {modeLabel(s.mode)}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <span className={styles.historyStatus}>
                        {resumingSessionId === s.id
                          ? s.endedAt ? 'Reopening…' : 'Resuming…'
                          : s.endedAt ? 'Completed — click to edit' : 'In progress — click to resume'}
                      </span>
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
        <div className={styles.liveLayout} ref={sessionExportRef}>
          <div className={styles.liveHeader}>
            <p className={styles.pitchCounter}>
              Pitch <strong>#{lastQueuedPitch?.pitchIndex ?? pitches.length + (pendingTarget ? 1 : 0)}</strong>
              {lastMatchedPitch ? (
                <span className={styles.pitchTypeChip} style={{ color: lastPitchColor ?? undefined, borderColor: lastPitchColor ?? undefined }}>
                  {lastMatchedPitch.pitchType ?? 'Untagged'}
                </span>
              ) : null}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {activeSession.mode === 'live' ? (
                <button type="button" className={styles.deleteLink} onClick={() => setShowFlightReplay((visible) => !visible)}>
                  {showFlightReplay ? 'Hide Flight' : 'Show Flight'}
                </button>
              ) : null}
              <button type="button" className={styles.deleteLink} onClick={handleExportSessionPdf} disabled={isExportingSessionPdf}>
                {isExportingSessionPdf ? 'Exporting…' : 'Export PDF'}
              </button>
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
              <strong>Pitcher mismatch:</strong> TrackMan&apos;s data is tagged for{' '}
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
              <div style={{ display: 'flex', gap: 8 }}>
                {TARGET_SIZE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className={styles.resetButton}
                    style={targetRadiusFt === preset.radiusFt ? { borderColor: 'rgb(var(--portal-accent-rgb, 200, 16, 46))', color: '#f8fafc' } : undefined}
                    onClick={() => setTargetRadiusFt(preset.radiusFt)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <div className={styles.zoneFrame}>
                <svg
                  viewBox={`0 0 ${ZONE_W} ${ZONE_H}`}
                  className={styles.zoneSvg}
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
                  {Array.from({ length: 9 }, (_, index) => {
                    const column = index % 3;
                    const row = Math.floor(index / 3);
                    const x = STRIKE_LEFT + ((STRIKE_RIGHT - STRIKE_LEFT) / 3) * (column + 0.5);
                    const y = STRIKE_TOP - ((STRIKE_TOP - STRIKE_BOTTOM) / 3) * (row + 0.5);
                    return <text key={index + 1} x={zonePx(x)} y={zonePy(y)} className={styles.zonePocketNumber}>{index + 1}</text>;
                  })}
                  <text x={zonePx(-1.19)} y={zonePy(3.825)} className={styles.zonePocketNumber}>10</text>
                  <text x={zonePx(1.19)} y={zonePy(3.825)} className={styles.zonePocketNumber}>11</text>
                  <text x={zonePx(-1.19)} y={zonePy(1.275)} className={styles.zonePocketNumber}>12</text>
                  <text x={zonePx(1.19)} y={zonePy(1.275)} className={styles.zonePocketNumber}>13</text>

                  {pendingTarget ? (
                    <IntendedTargetGlove xFt={pendingTarget.sideFt} yFt={pendingTarget.heightFt} radiusFt={targetRadiusFt} />
                  ) : activeSession.mode !== 'manual' && lastQueuedPitch ? (
                    <IntendedTargetGlove xFt={lastQueuedPitch.intendedSideFt} yFt={lastQueuedPitch.intendedHeightFt} radiusFt={lastQueuedPitch.targetRadiusFt} />
                  ) : activeSession.mode !== 'manual' && lastMatchedPitch ? (
                    <IntendedTargetGlove xFt={lastMatchedPitch.intendedSideFt} yFt={lastMatchedPitch.intendedHeightFt} radiusFt={lastMatchedPitch.targetRadiusFt} />
                  ) : null}

                  {activeSession.mode === 'manual' && manualActual ? (
                    <circle
                      cx={zonePx(manualActual.sideFt)}
                      cy={zonePy(manualActual.heightFt)}
                      r="9"
                      fill={PITCH_COLORS[manualPitchType] ?? PITCH_COLORS.Undefined}
                      stroke={ZONE_STROKE_STRONG}
                      strokeWidth="2"
                    />
                  ) : null}

                  {lastMatchedPitch && !pendingTarget && !lastQueuedPitch && activeSession.mode !== 'manual' && lastMatchedPitch.plateLocSide !== null && lastMatchedPitch.plateLocHeight !== null ? (
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

              {activeSession.mode === 'manual' ? (
                pendingTarget && manualActual ? (
                  <div style={{ display: 'grid', gap: 10, justifyItems: 'center' }}>
                    <div className={styles.field} style={{ width: 200 }}>
                      <label className={styles.fieldLabel} htmlFor="iz-manual-pitch-type">
                        Pitch Type
                      </label>
                      <select
                        id="iz-manual-pitch-type"
                        className={styles.select}
                        value={manualPitchType}
                        onChange={(event) => setManualPitchType(event.target.value)}
                      >
                        <option value="">Select pitch type…</option>
                        {Object.keys(PITCH_COLORS)
                          .filter((type) => type !== 'Undefined')
                          .map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                      </select>
                    </div>
                    <div className={styles.actionRow}>
                      <button type="button" className={styles.confirmButton} onClick={handleConfirmManualPitch}>
                        Confirm Pitch
                      </button>
                      <button
                        type="button"
                        className={styles.resetButton}
                        onClick={() => {
                          setPendingTarget(null);
                          setManualActual(null);
                          setManualPitchType('');
                        }}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                ) : pendingTarget || manualActual ? (
                  <div className={styles.actionRow}>
                    <p className={styles.zoneHint} style={{ marginBottom: 0 }}>
                      Now click where the pitch actually landed.
                    </p>
                    <button
                      type="button"
                      className={styles.resetButton}
                      onClick={() => {
                        setPendingTarget(null);
                        setManualActual(null);
                        setManualPitchType('');
                      }}
                    >
                      Reset
                    </button>
                  </div>
                ) : (
                  <div className={styles.actionRow}>
                    <p className={styles.zoneHint} style={{ marginBottom: 0 }}>
                      Click the intended target.
                    </p>
                    {lastManualPitchId ? (
                      <button type="button" className={styles.resetButton} onClick={handleUndoLastManualPitch}>
                        Undo Last Pitch
                      </button>
                    ) : null}
                  </div>
                )
              ) : pendingTarget || lastQueuedPitch ? (
                <p className={styles.zoneHint}>Target ready — tap anywhere else to move it.</p>
              ) : (
                <p className={styles.zoneHint}>
                  {activeSession.trackmanSessionId ? 'Tap the zone to set the next target.' : 'No TrackMan session linked — data will not auto-populate.'}
                </p>
              )}

              {activeSession.mode === 'ftp_deferred' ? (
                <div className={styles.actionRow} style={{ marginTop: 8 }}>
                  <button type="button" className={styles.confirmButton} onClick={handleCheckFtpMatch} disabled={checkingFtp}>
                    {checkingFtp ? 'Checking…' : 'Check for Results'}
                  </button>
                  {pitches.some((p) => p.trackmanPlayId) ? (
                    <button type="button" className={styles.resetButton} onClick={handleResetMatches} disabled={resettingMatches}>
                      {resettingMatches ? 'Resetting…' : 'Reset Matches'}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div style={{ display: 'grid', gap: 14 }}>
              {activeSession.mode === 'live' && showFlightReplay ? (
                <LiveFlightReplay
                  pitch={viewedFlightPitch}
                  currentPitchNumber={normalizedFlightPitchIndex + 1}
                  totalPitches={matchedPitches.length}
                  hasPrevious={normalizedFlightPitchIndex > 0}
                  hasNext={normalizedFlightPitchIndex >= 0 && normalizedFlightPitchIndex < matchedPitches.length - 1}
                  followingLive={followingLiveFlight}
                  onPrevious={viewPreviousFlight}
                  onNext={viewNextFlight}
                />
              ) : null}
              {viewedFlightPitch ? (
                <div className={styles.statGrid}>
                  <StatTile label="Velocity" value={viewedFlightPitch.relSpeed !== null ? `${viewedFlightPitch.relSpeed.toFixed(1)}` : '—'} suffix="mph" />
                  <StatTile label="IVB" value={viewedFlightPitch.inducedVertBreak !== null ? viewedFlightPitch.inducedVertBreak.toFixed(1) : '—'} suffix='"' />
                  <StatTile label="HB" value={viewedFlightPitch.horzBreak !== null ? viewedFlightPitch.horzBreak.toFixed(1) : '—'} suffix='"' />
                  <StatTile
                    label="Miss Distance"
                    value={viewedFlightPitch.missDistanceFt !== null ? (viewedFlightPitch.missDistanceFt * 12).toFixed(1) : '—'}
                    suffix='"'
                    severity={viewedMissSeverity}
                  />
                  <StatTile
                    label="Miss Direction"
                    value={viewedFlightPitch.missDirection ? MISS_DIRECTION_LABELS[viewedFlightPitch.missDirection] ?? viewedFlightPitch.missDirection : '—'}
                    small
                  />
                  <StatTile label="Target Size" value={(viewedFlightPitch.targetRadiusFt * 12).toFixed(0)} suffix='" radius' />
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
                      Avg miss: <strong>{(sessionAverages.avgMiss * 12).toFixed(1)}&quot;</strong>
                    </span>
                    <span className={styles.summaryStat}>
                      On target: <strong>{sessionAverages.onTargetPct.toFixed(0)}%</strong>
                    </span>
                    {zoneTallies ? (
                      <>
                        <span className={styles.summaryStat}>
                          In Zone: <strong>{zoneTallies.overall.inZoneN}/{zoneTallies.overall.total}</strong>
                        </span>
                        <span className={styles.summaryStat}>
                          Competitive: <strong>{zoneTallies.overall.competitiveN}/{zoneTallies.overall.total}</strong>
                        </span>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {zoneTallies && zoneTallies.byType.size > 1 ? (
                <div className={styles.logSection}>
                  <p className={styles.logTitle}>In Zone / Competitive by Pitch Type</p>
                  <div className={styles.logScroll}>
                    <table className={styles.logTable}>
                      <thead>
                        <tr>
                          <th>Pitch Type</th>
                          <th>Pitches</th>
                          <th>In Zone</th>
                          <th>Competitive</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr style={{ fontWeight: 700, background: 'rgba(148, 163, 184, 0.06)' }}>
                          <td>
                            <span className={styles.logPitchType}>All</span>
                          </td>
                          <td>{zoneTallies.overall.total}</td>
                          <td>
                            {zoneTallies.overall.inZoneN}/{zoneTallies.overall.total} ({((zoneTallies.overall.inZoneN / zoneTallies.overall.total) * 100).toFixed(0)}%)
                          </td>
                          <td>
                            {zoneTallies.overall.competitiveN}/{zoneTallies.overall.total} ({((zoneTallies.overall.competitiveN / zoneTallies.overall.total) * 100).toFixed(0)}%)
                          </td>
                        </tr>
                        {Array.from(zoneTallies.byType.entries()).map(([pitchType, tally]) => (
                          <tr key={pitchType}>
                            <td>
                              <span className={styles.logPitchType}>
                                <span className={styles.logPitchDot} style={{ background: PITCH_COLORS[pitchType] ?? PITCH_COLORS.Undefined }} />
                                {pitchType}
                              </span>
                            </td>
                            <td>{tally.total}</td>
                            <td>
                              {tally.inZoneN}/{tally.total} ({((tally.inZoneN / tally.total) * 100).toFixed(0)}%)
                            </td>
                            <td>
                              {tally.competitiveN}/{tally.total} ({((tally.competitiveN / tally.total) * 100).toFixed(0)}%)
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}

              {sessionAverages ? (
                <div className={styles.zoneCard} style={{ marginTop: 4 }}>
                  <p className={styles.historyTitle} style={{ alignSelf: 'flex-start' }}>
                    Live Miss Direction
                  </p>
                  <p className={styles.zoneHint} style={{ textAlign: 'left', alignSelf: 'flex-start', marginBottom: 8 }}>
                    Where misses land relative to the target — glove/arm side is from the pitcher&apos;s own throwing-hand perspective.
                  </p>
                  <DirectionHeatmap breakdown={liveDirectionBreakdown} throwsLeft={liveThrowsLeft} />
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
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {[...pitches].reverse().map((p) => {
                      const severity = missSeverity(p.missDistanceFt);
                      const color = PITCH_COLORS[p.pitchType ?? 'Undefined'] ?? PITCH_COLORS.Undefined;
                      return (
                        <tr
                          key={p.id}
                          className={p.trackmanPlayId ? styles.selectableLogRow : undefined}
                          data-selected={viewedFlightPitch?.id === p.id ? 'true' : undefined}
                          tabIndex={p.trackmanPlayId ? 0 : undefined}
                          aria-label={p.trackmanPlayId ? `View flight for pitch ${p.pitchIndex}` : undefined}
                          onClick={p.trackmanPlayId ? () => {
                            setSelectedFlightPitchId(p.id === lastMatchedPitch?.id ? null : p.id);
                            setShowFlightReplay(true);
                          } : undefined}
                          onKeyDown={p.trackmanPlayId ? (event) => {
                            if (event.key !== 'Enter' && event.key !== ' ') return;
                            event.preventDefault();
                            setSelectedFlightPitchId(p.id === lastMatchedPitch?.id ? null : p.id);
                            setShowFlightReplay(true);
                          } : undefined}
                        >
                          <td>{p.pitchIndex}</td>
                          <td>
                            <span className={styles.logPitchType}>
                              <span className={styles.logPitchDot} style={{ background: color }} />
                              {p.pitchType ?? 'Untagged'}
                            </span>
                          </td>
                          <td>{p.relSpeed !== null ? p.relSpeed.toFixed(1) : '—'}</td>
                          <td>{p.inducedVertBreak !== null ? p.inducedVertBreak.toFixed(1) : '—'}</td>
                          <td>{p.horzBreak !== null ? p.horzBreak.toFixed(1) : '—'}</td>
                          <td className={severity ? `${styles.logMissDistance} ${styles[severity]}` : undefined}>
                            {p.missDistanceFt !== null ? `${(p.missDistanceFt * 12).toFixed(1)}"` : '—'}
                          </td>
                          <td>{p.missDirection ? MISS_DIRECTION_LABELS[p.missDirection] ?? p.missDirection : '—'}</td>
                          <td>
                            <button type="button" className={styles.deleteLink} onClick={(event) => { event.stopPropagation(); void handleDeletePitch(p.id); }}>
                              Delete
                            </button>
                          </td>
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
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="rgba(74, 222, 128, 0.18)"
        stroke="#4ade80"
        strokeWidth="2"
        strokeDasharray="5 4"
      />
      <circle cx={cx} cy={cy} r="3" fill="#4ade80" />
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
