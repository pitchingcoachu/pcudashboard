'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pitchLocationLabel } from '../../../lib/pitch-location';
import { downloadContentPdf } from '../../../lib/leaderboard-pdf-export';
import { SaveReportToProfileButton } from '../components/save-report-to-profile';
import IntendedZoneStats, { DirectionHeatmap, emptyIntendedZoneDirectionBreakdown, type MissDirection } from './intended-zone-stats';
import IntendedZoneTargeting from './intended-zone-targeting';
import IntendedZonePitchLog from './intended-zone-pitch-log';
import LiveFlightReplay from './live-flight-replay';
import styles from './intended-zone-panel.module.css';

// Safari throws "The string did not match the expected pattern" from
// toLocaleDateString/toLocaleString on an Invalid Date (Chrome just returns
// "Invalid Date" silently) -- these validate first so a stray malformed
// timestamp can't crash the whole panel render.
function formatDateSafe(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}

function formatDateTimeSafe(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return date.toLocaleString();
  } catch {
    return '—';
  }
}

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

const PITCH_TYPE_ORDER = ['Fastball', 'Sinker', 'Cutter', 'Slider', 'Sweeper', 'Curveball', 'ChangeUp', 'Splitter', 'Knuckleball'];

function comparePitchTypes(a: string, b: string): number {
  const aIndex = PITCH_TYPE_ORDER.indexOf(a);
  const bIndex = PITCH_TYPE_ORDER.indexOf(b);
  if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
  if (aIndex === -1) return 1;
  if (bIndex === -1) return -1;
  return aIndex - bIndex;
}

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
  confirmedAt: string | null;
  isStrike: boolean | null;
  countAtPitch: string | null;
  atBatIndex: number | null;
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
const PLAYS_API_SYNC_EVERY_POLLS = 3;
const DATA_API_SYNC_EVERY_POLLS = 8;

export default function IntendedZonePanel({
  pitcherName,
  startDate,
  endDate,
  selectedPitchTypes,
  selectedBallTypes,
  siteLogoSrc,
  siteLogoAlt,
}: {
  pitcherName: string | null;
  startDate?: string;
  endDate?: string;
  selectedPitchTypes?: string[];
  selectedBallTypes?: string[];
  siteLogoSrc?: string | null;
  siteLogoAlt?: string;
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
  const [confirmingTarget, setConfirmingTarget] = useState(false);
  // Local, immediate source of truth for whether the CURRENT pendingTarget
  // has been confirmed -- deliberately not derived from polled server state
  // (lastQueuedPitch/pitches), which can lag a click by up to one poll
  // interval and would otherwise show/hide the Confirm button based on
  // stale data (e.g. still reporting the PREVIOUS target as confirmed right
  // after a brand-new, unconfirmed target was just placed).
  const [targetIsConfirmedLocally, setTargetIsConfirmedLocally] = useState(false);
  // Track Strikes & Count: chosen when starting a session, alongside the
  // Live/FTP Sync/Manual mode picker. currentCount/atBatIndex/callingPitchId
  // are local UI state driving the Ball/Strike prompt and live stat display;
  // the actual per-pitch calls are persisted via setIntendedZonePitchCount
  // (PATCH .../pitches, action 'set_count') as they're made, and aggregated
  // into the bullpen scripts log server-side when the session ends.
  const [trackCountEnabled, setTrackCountEnabled] = useState(false);
  const [currentCount, setCurrentCount] = useState({ balls: 0, strikes: 0 });
  const [atBatIndex, setAtBatIndex] = useState(0);
  // At-bat indices that reached a 2-strike count (0-2 or 1-2) within their
  // first 3 pitches -- tallied once per at-bat as pitches are called, per
  // the exact "2/3%" definition: don't count it twice for the same at-bat.
  const [twoThreeHits, setTwoThreeHits] = useState<Set<number>>(new Set());
  const [callingPitchId, setCallingPitchId] = useState<number | null>(null);
  // FTP Sync mode only: the pitch id just confirmed via Confirm Target,
  // awaiting a Ball/Strike call. FTP mode has no real TrackMan location data
  // at confirm-time (it only arrives once the next sync ingests it, often
  // hours later), so unlike Live/Manual mode -- which prompts off
  // lastMatchedPitch once a pitch actually lands -- FTP mode prompts right
  // after Confirm Target instead, using this id directly rather than
  // waiting for a "matched" pitch that may not exist yet.
  const [pendingFtpCountPitchId, setPendingFtpCountPitchId] = useState<number | null>(null);
  // Edit an already-landed/matched pitch's intended target -- an explicit
  // "Edit Target" button starts this (never a direct click, to avoid
  // accidentally moving history while just reviewing/tracking). editDraft
  // holds the new location while the coach is choosing it, kept separate
  // from pendingTarget/lastMatchedPitch so it never interferes with the
  // normal live-tracking click flow (handleZoneClick branches to this mode
  // first, before any of its usual pending-target logic).
  const [editingPitchId, setEditingPitchId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{ sideFt: number; heightFt: number } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollInFlightRef = useRef(false);
  const fallbackSyncInFlightRef = useRef(false);
  const pollCountRef = useRef(0);
  // Cursor for the GET route's sincePoll param -- bounds each poll's server-
  // side webhook buffer read to only rows touched since the LAST poll
  // started, instead of the whole session's history every time (previously
  // the direct cause of live tracking slowing down / dropping pitches as a
  // bullpen went on). null on the first poll after starting/resuming a
  // session, so that poll gets full history with nothing to bound against.
  // Captured as the timestamp BEFORE each request fires (not after it
  // resolves) so a webhook event landing during the round trip is still
  // covered by the NEXT poll's window rather than falling in the gap.
  const lastPollStartedAtRef = useRef<string | null>(null);
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
    const syncMetadata = pollCountRef.current % PLAYS_API_SYNC_EVERY_POLLS === 0;
    const syncFallback = pollCountRef.current % DATA_API_SYNC_EVERY_POLLS === 0;
    // Snapshot the placement version before the request goes out. If a tap
    // (placeOrMoveLiveTarget) happens while this poll is in flight, that
    // function bumps targetPlacementVersionRef synchronously -- this poll's
    // response reflects server state from BEFORE that tap, so it must not
    // hydrate/overwrite pendingTarget once it resolves, even if its own
    // snapshot still shows the old (possibly now-confirmed) target as the
    // only unmatched row. Without this, a poll that was already in flight
    // when the coach tapped a new spot briefly snaps the marker back to the
    // previous target for one poll interval before the next poll catches up.
    const placementVersionAtPollStart = targetPlacementVersionRef.current;
    const thisPollStartedAt = new Date().toISOString();
    try {
      const params = new URLSearchParams({ sessionId: String(sessionId) });
      if (lastPollStartedAtRef.current) params.set('sincePoll', lastPollStartedAtRef.current);
      const response = await fetch(`/api/dashboard/pitching/intended-zone/pitches?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to poll for pitches.');
      const nextPitches: IntendedZonePitch[] = Array.isArray(payload.pitches) ? payload.pitches : [];
      // Every unmatched (no trackman_play_id, no plate location) row here,
      // oldest first. In ftp_deferred mode a CONFIRMED row can sit unmatched
      // for a long time (until the next FTP sync runs), so once a target is
      // confirmed and a new one is placed, there are briefly/potentially for
      // a while TWO unmatched rows: the old confirmed one and the new
      // unconfirmed one. Picking queuedTargets[0] (oldest) would always
      // re-select the stale confirmed target and snap pendingTarget back to
      // it on every poll -- so the row to hydrate from is specifically the
      // newest UNCONFIRMED one (the one actually still being positioned);
      // an already-confirmed row is only used to seed targetIsConfirmedLocally
      // when reloading with no unconfirmed row at all (nothing left to move).
      const queuedTargets = nextPitches.filter((pitch) => !pitch.trackmanPlayId && pitch.plateLocSide === null && pitch.plateLocHeight === null);
      const unconfirmedQueuedTargets = queuedTargets.filter((pitch) => !pitch.confirmedAt);
      const nextQueuedTarget =
        unconfirmedQueuedTargets[unconfirmedQueuedTargets.length - 1]
        ?? (queuedTargets.length ? queuedTargets[queuedTargets.length - 1] : null);
      const previouslyActiveTargetId = activeQueuedTargetIdRef.current;
      // A tap that landed after this poll's request went out already knows
      // more than this response does -- e.g. it just created a brand-new
      // unconfirmed row this snapshot predates. Skip touching
      // pendingTarget/activeQueuedTargetIdRef/targetIsConfirmedLocally
      // entirely rather than act on stale data; the next poll (after the
      // tap's PUT has landed) will have a fresh, trustworthy snapshot.
      const pollSnapshotIsStale = targetPlacementVersionRef.current !== placementVersionAtPollStart;
      if (!pollSnapshotIsStale && nextQueuedTarget) {
        // Hydrate a pending target when resuming/reloading. While a local
        // move is already visible, don't let a slightly older poll snap it
        // back before the serialized PUT finishes -- but DO still refresh
        // targetIsConfirmedLocally even for the same row id, since Confirm
        // Target's PATCH doesn't change intendedSideFt/HeightFt (nothing for
        // this same-id branch to clobber) and this is how a second browser
        // tab, or this same tab after a dropped response, ever learns a
        // target was confirmed.
        if (previouslyActiveTargetId === null || previouslyActiveTargetId !== nextQueuedTarget.id) {
          setPendingTarget({ sideFt: nextQueuedTarget.intendedSideFt, heightFt: nextQueuedTarget.intendedHeightFt });
          setTargetRadiusFt(nextQueuedTarget.targetRadiusFt);
        }
        activeQueuedTargetIdRef.current = nextQueuedTarget.id;
        setTargetIsConfirmedLocally(Boolean(nextQueuedTarget.confirmedAt));
      } else if (!pollSnapshotIsStale && previouslyActiveTargetId !== null) {
        activeQueuedTargetIdRef.current = null;
        setPendingTarget(null);
        setTargetIsConfirmedLocally(false);
      }
      const matched = nextPitches.filter((p) => p.trackmanPlayId);
      const newest = matched.length ? matched[matched.length - 1] : null;
      if (newest && newest.id !== lastSeenPitchId.current) {
        lastSeenPitchId.current = newest.id;
        setJustLanded(true);
        setTimeout(() => setJustLanded(false), 550);
      }
      // The server only attaches flightData for pitches whose webhook rows
      // it actually re-read THIS poll (bounded by the sincePoll cursor, so
      // only new/recently-changed pitches -- see poll's params.set('sincePoll', ...)
      // below). Carry forward any earlier pitch's already-received
      // flightData rather than letting it silently disappear once that
      // pitch ages out of the cursor window; flight replay lets the coach
      // navigate back through the whole session's pitches, not just the
      // newest one.
      setPitches((current) => {
        const previousFlightById = new Map(current.map((p) => [p.id, p.flightData]));
        return nextPitches.map((p) => ({ ...p, flightData: p.flightData ?? previousFlightById.get(p.id) ?? null }));
      });
      setPollWarning(null);
      // Only advance the cursor on a SUCCESSFUL poll -- if this one failed
      // (caught below) or the server 404'd/500'd, the next poll should
      // retry against the same window rather than silently widen the gap
      // and risk missing whatever this attempt failed to pick up.
      lastPollStartedAtRef.current = thisPollStartedAt;

      // TrackMan's pull API is useful for classification enrichment and as a
      // delivery fallback, but it can take several seconds. Run it separately
      // so a slow upstream response never freezes the two-second webhook loop.
      if ((syncMetadata || syncFallback) && !fallbackSyncInFlightRef.current) {
        fallbackSyncInFlightRef.current = true;
        const fallbackParams = new URLSearchParams({ sessionId: String(sessionId), metadata: '1' });
        if (syncFallback) fallbackParams.set('fallback', '1');
        if (lastPollStartedAtRef.current) fallbackParams.set('sincePoll', lastPollStartedAtRef.current);
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
      lastPollStartedAtRef.current = null;
      setCurrentCount({ balls: 0, strikes: 0 });
      setAtBatIndex(0);
      setTwoThreeHits(new Set());
      setCallingPitchId(null);
      setPendingFtpCountPitchId(null);
      setEditingPitchId(null);
      setEditDraft(null);
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
      setEditingPitchId(null);
      setEditDraft(null);
      loadHistory();
    }
  }

  async function handleExportSessionPdf() {
    const wrapNode = sessionExportRef.current;
    if (!wrapNode || !activeSession) return;
    setIsExportingSessionPdf(true);
    setError(null);
    try {
      const dateLabel = formatDateSafe(activeSession.startedAt);
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
      lastPollStartedAtRef.current = null;
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
    setTargetIsConfirmedLocally(false);
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

  // FTP-deferred mode's "Confirm Target" button. Locks in the currently
  // placed target so the daily FTP reconciliation only ever matches a
  // target the coach explicitly confirmed (see confirmIntendedZoneTarget's
  // doc comment), instead of guessing off the timestamp of whichever tap
  // happened to place the target first. Clears the local pendingTarget so
  // the next tap starts a brand-new target rather than continuing to move
  // this now-locked one.
  async function confirmPendingTarget() {
    if (!activeSession || activeSession.mode !== 'ftp_deferred') return;
    setConfirmingTarget(true);
    setError(null);
    try {
      await targetWriteChainRef.current.catch(() => undefined);
      const response = await fetch('/api/dashboard/pitching/intended-zone/pitches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeSession.id }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to confirm target.');
      // pendingTarget stays visible on the zone -- it's now shown as the
      // locked-in confirmed target rather than cleared. targetIsConfirmedLocally
      // is the immediate, local signal the button/status text render off of;
      // it gets reset to false the moment the next tap calls
      // placeOrMoveLiveTarget, so a fresh target always starts unconfirmed
      // without waiting on a poll round-trip to catch up.
      setTargetIsConfirmedLocally(true);
      if (trackCountEnabled) {
        const confirmedPitchId = Number(payload.pitchId);
        if (Number.isFinite(confirmedPitchId) && confirmedPitchId > 0) setPendingFtpCountPitchId(confirmedPitchId);
      }
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : 'Failed to confirm target.');
    } finally {
      setConfirmingTarget(false);
    }
  }

  // Track Strikes & Count: the coach's manual Ball/Strike call for one
  // pitch. Manual (not derived from pitch location) because a bullpen has
  // no real batter/umpire -- see setIntendedZonePitchCount's doc comment.
  // Called two different ways depending on mode: Live/Manual call this
  // right after a pitch LANDS (lastMatchedPitch, has real TrackMan/tapped
  // location data already); FTP Sync mode has no location data yet at
  // that point (it only arrives once the next sync ingests it, often
  // hours later), so FTP calls this right after CONFIRMING the target
  // instead -- the pitch row already exists at that point even though
  // it's still unmatched, and the coach's ball/strike call doesn't need
  // real location data to be meaningful. Takes a bare pitchId (not a full
  // pitch object) so both call sites work identically. Advances the local
  // count/at-bat state the same way a real plate appearance would: a 4th
  // ball or 3rd strike auto-starts a fresh at-bat (an unambiguous boundary
  // even though "Next Batter" is otherwise a manual action), and a count
  // that reaches 2 strikes within the first 3 pitches of an at-bat credits
  // that at-bat's 2/3% exactly once.
  function callBallOrStrike(pitchId: number, isStrike: boolean) {
    if (!activeSession) return;
    const countAtPitch = `${currentCount.balls}-${currentCount.strikes}`;
    const pitchNumberInAtBat = pitches.filter((p) => p.atBatIndex === atBatIndex && p.isStrike !== null).length + 1;
    setCallingPitchId(pitchId);
    setError(null);

    let nextBalls = currentCount.balls;
    let nextStrikes = currentCount.strikes;
    if (isStrike) nextStrikes += 1;
    else nextBalls += 1;

    if (pitchNumberInAtBat <= 3 && nextStrikes >= 2) {
      setTwoThreeHits((current) => (current.has(atBatIndex) ? current : new Set(current).add(atBatIndex)));
    }

    const atBatEnded = nextBalls >= 4 || nextStrikes >= 3;
    const thisAtBatIndex = atBatIndex;

    // Optimistic: reflect the call immediately rather than waiting up to one
    // poll interval, so the Ball/Strike prompt clears and the live stats
    // (In Zone%/Comp%/Strike%/2-3%) update right away.
    setPitches((current) =>
      current.map((p) => (p.id === pitchId ? { ...p, isStrike, countAtPitch, atBatIndex: thisAtBatIndex } : p))
    );
    setPendingFtpCountPitchId((current) => (current === pitchId ? null : current));

    fetch('/api/dashboard/pitching/intended-zone/pitches', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_count', pitchId, isStrike, countAtPitch, atBatIndex: thisAtBatIndex }),
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error ?? 'Failed to record the call.');
      })
      .catch((callError) => {
        setError(callError instanceof Error ? callError.message : 'Failed to record the call.');
        // Roll back the optimistic call so the prompt reappears and the coach
        // can retry -- the server never persisted this one.
        setPitches((current) =>
          current.map((p) => (p.id === pitchId ? { ...p, isStrike: null, countAtPitch: null, atBatIndex: null } : p))
        );
      })
      .finally(() => {
        setCallingPitchId((current) => (current === pitchId ? null : current));
      });

    if (atBatEnded) {
      setCurrentCount({ balls: 0, strikes: 0 });
      setAtBatIndex((current) => current + 1);
    } else {
      setCurrentCount({ balls: nextBalls, strikes: nextStrikes });
    }
  }

  // Manual "start a new simulated at-bat" -- for when the coach wants a
  // fresh count without a real walk/strikeout having occurred.
  function handleNextBatter() {
    setCurrentCount({ balls: 0, strikes: 0 });
    setAtBatIndex((current) => current + 1);
  }

  function handleZoneClick(event: React.MouseEvent<SVGSVGElement>) {
    if (!activeSession) return;
    const svg = event.currentTarget;
    const rect = svg.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * ZONE_W;
    const py = ((event.clientY - rect.top) / rect.height) * ZONE_H;
    const sideFt = pxToFeetX(px);
    const heightFt = pxToFeetY(py);

    if (editingPitchId !== null) {
      setEditDraft({ sideFt, heightFt });
      return;
    }

    if (activeSession.mode === 'manual') {
      if (!pendingTarget) setPendingTarget({ sideFt, heightFt });
      else if (!manualActual) setManualActual({ sideFt, heightFt });
      return;
    }
    placeOrMoveLiveTarget({ sideFt, heightFt });
  }

  // Edit an already-landed/matched pitch's intended target (see editingPitchId's
  // doc comment). Seeds editDraft with the pitch's CURRENT intended location
  // so the marker doesn't jump anywhere until the coach actually taps a new
  // spot -- Cancel with no tap is then a true no-op.
  function startEditTarget(pitch: IntendedZonePitch) {
    setEditingPitchId(pitch.id);
    setEditDraft({ sideFt: pitch.intendedSideFt, heightFt: pitch.intendedHeightFt });
    setError(null);
  }

  function cancelEditTarget() {
    setEditingPitchId(null);
    setEditDraft(null);
  }

  async function saveEditTarget() {
    if (editingPitchId === null || !editDraft) return;
    setSavingEdit(true);
    setError(null);
    try {
      const response = await fetch('/api/dashboard/pitching/intended-zone/pitches', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'edit_target',
          pitchId: editingPitchId,
          intendedSideFt: editDraft.sideFt,
          intendedHeightFt: editDraft.heightFt,
          targetRadiusFt,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Failed to update the target.');
      // Optimistic: apply the corrected target/miss values immediately
      // rather than waiting for the next poll, since this pitch may no
      // longer be lastMatchedPitch by the time the poll response would
      // normally refresh it.
      const updated = payload.pitch as
        | { intendedSideFt: number; intendedHeightFt: number; targetRadiusFt: number; missDistanceFt: number | null; missDirection: string | null }
        | undefined;
      if (updated) {
        setPitches((current) =>
          current.map((p) =>
            p.id === editingPitchId
              ? { ...p, intendedSideFt: updated.intendedSideFt, intendedHeightFt: updated.intendedHeightFt, targetRadiusFt: updated.targetRadiusFt, missDistanceFt: updated.missDistanceFt, missDirection: updated.missDirection }
              : p
          )
        );
      }
      setEditingPitchId(null);
      setEditDraft(null);
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : 'Failed to update the target.');
    } finally {
      setSavingEdit(false);
    }
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
  // The pitch currently being edited (see editingPitchId's doc comment) --
  // can be ANY pitch in the session's Pitch Log table, not just the newest.
  const editingPitch = editingPitchId !== null ? pitches.find((p) => p.id === editingPitchId) ?? null : null;
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

  // The zone marker/pitch-counter should track the newest unconfirmed
  // target when one exists (the target actively being positioned), falling
  // back to the newest confirmed-but-unmatched one only when nothing
  // unconfirmed remains (e.g. right after Confirm, before the next tap) --
  // same rationale as poll()'s nextQueuedTarget selection above: an older
  // confirmed row can sit unmatched for a long time and must not keep
  // winning over a newer target that's still being placed.
  const lastQueuedPitch = useMemo(() => {
    const queued = pitches.filter((pitch) => !pitch.trackmanPlayId && pitch.plateLocSide === null && pitch.plateLocHeight === null);
    if (!queued.length) return null;
    const unconfirmed = queued.filter((pitch) => !pitch.confirmedAt);
    return unconfirmed.length ? unconfirmed[unconfirmed.length - 1] : queued[queued.length - 1];
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
      const missDistances = list.map((p) => p.missDistanceFt).filter((d): d is number => d !== null).sort((a, b) => a - b);
      const avgMissFt = missDistances.length ? missDistances.reduce((sum, d) => sum + d, 0) / missDistances.length : null;
      const medianMissFt = missDistances.length
        ? missDistances.length % 2 === 1
          ? missDistances[(missDistances.length - 1) / 2]
          : (missDistances[missDistances.length / 2 - 1] + missDistances[missDistances.length / 2]) / 2
        : null;
      return { inZoneN, competitiveN, total: list.length, avgMissFt, medianMissFt };
    }

    const byType = new Map<string, ReturnType<typeof tally>>();
    for (const p of matched) {
      const key = p.pitchType ?? 'Untagged';
      if (!byType.has(key)) byType.set(key, tally(matched.filter((m) => (m.pitchType ?? 'Untagged') === key)));
    }

    return { overall: tally(matched), byType };
  }, [pitches]);

  // Track Strikes & Count's live stat block -- scoped to only the pitches
  // the coach has actually called Ball/Strike on (not every matched pitch),
  // so In Zone%/Comp% here reads consistently alongside Strike%/2-3%, which
  // can only ever mean something for called pitches.
  const countStats = useMemo(() => {
    const called = pitches.filter((p) => p.isStrike !== null);
    if (!called.length) return null;
    // In FTP Sync mode a called pitch has no real landing location yet at
    // call-time -- it only arrives once the next FTP sync ingests it,
    // often hours later. Scoping In Zone%/Comp% to only the called pitches
    // that already have a real location (rather than all called pitches)
    // avoids showing a misleading 0% for pitches with no data yet; the UI
    // hides these two entirely when locatedCalled is empty.
    const locatedCalled = called.filter((p) => p.plateLocSide !== null && p.plateLocHeight !== null);
    let inZoneN = 0;
    let competitiveN = 0;
    let strikeN = 0;
    for (const p of locatedCalled) {
      const label = pitchLocationLabel(p.plateLocSide, p.plateLocHeight);
      if (label === 'Yes') inZoneN += 1;
      if (label === 'Yes' || label === 'Competitive') competitiveN += 1;
    }
    for (const p of called) {
      if (p.isStrike) strikeN += 1;
    }
    const atBatsWithCalls = new Set(called.map((p) => p.atBatIndex)).size;
    return {
      total: called.length,
      inZonePct: locatedCalled.length ? (inZoneN / locatedCalled.length) * 100 : null,
      compPct: locatedCalled.length ? (competitiveN / locatedCalled.length) * 100 : null,
      strikePct: (strikeN / called.length) * 100,
      twoThreePct: atBatsWithCalls ? (twoThreeHits.size / atBatsWithCalls) * 100 : null,
    };
  }, [pitches, twoThreeHits]);

  const liveDirectionBreakdownsByPitchType = useMemo(() => {
    const grouped = new Map<string, ReturnType<typeof emptyIntendedZoneDirectionBreakdown>>();
    for (const pitch of pitches) {
      if (!pitch.missDirection) continue;
      const pitchType = pitch.pitchType?.trim() || 'Untagged';
      const breakdown = grouped.get(pitchType) ?? emptyIntendedZoneDirectionBreakdown();
      breakdown[pitch.missDirection as MissDirection] += 1;
      grouped.set(pitchType, breakdown);
    }
    return Array.from(grouped.entries())
      .sort(([a], [b]) => comparePitchTypes(a, b))
      .map(([pitchType, breakdown]) => ({
        pitchType,
        breakdown,
        count: Object.values(breakdown).reduce((sum, value) => sum + value, 0),
      }));
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
          siteLogoSrc={siteLogoSrc}
          siteLogoAlt={siteLogoAlt}
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
              ) : activeSession.mode === 'ftp_deferred' && pendingTarget && !targetIsConfirmedLocally ? (
                <>
                  <span>Target ready · tap elsewhere to move it</span>
                  <button type="button" onClick={() => void confirmPendingTarget()} disabled={confirmingTarget}>
                    {confirmingTarget ? 'Confirming…' : 'Confirm Target'}
                  </button>
                </>
              ) : activeSession.mode === 'ftp_deferred' && pendingTarget && targetIsConfirmedLocally ? (
                <span>Target confirmed · tap the zone to set the next target</span>
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

          <div className={styles.field}>
            <label className={styles.fieldLabel} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={trackCountEnabled} onChange={(event) => setTrackCountEnabled(event.target.checked)} />
              Track Strikes &amp; Count
            </label>
            {trackCountEnabled ? (
              <p className={styles.zoneHint} style={{ textAlign: 'left', marginTop: 8 }}>
                After each pitch lands, call it a Ball or Strike yourself (no real batter to call it for you). In Zone%, Comp%, Strike%, 2/3%, and
                the active count will show live, and results save to this pitcher&apos;s bullpen scripts log when you end the session.
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
                    {formatDateTimeSafe(s.gameDateLocal)} ({s.sessionType}){s.location ? ` — ${s.location}` : ''}
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
                      {formatDateSafe(s.startedAt)} — {modeLabel(s.mode)}
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
              <SaveReportToProfileButton generate={handleExportSessionPdf} title={`Intended Target Session - ${pitcherName || 'Pitcher'}`} preferredPlayerName={pitcherName} disabled={isExportingSessionPdf} className={styles.deleteLink} />
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

                  {editingPitchId !== null && editDraft ? (
                    <IntendedTargetGlove xFt={editDraft.sideFt} yFt={editDraft.heightFt} radiusFt={targetRadiusFt} />
                  ) : pendingTarget ? (
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

                  {/* While editing, show the EDITED pitch's own actual
                      landing dot/connector (against the new draft target)
                      instead of always the most recent pitch's -- otherwise
                      editing an older pitch confusingly still showed the
                      newest pitch's actual location. */}
                  {(() => {
                    const displayPitch = editingPitchId !== null ? editingPitch : lastMatchedPitch;
                    const displayTargetSideFt = editingPitchId !== null && editDraft ? editDraft.sideFt : displayPitch?.intendedSideFt;
                    const displayTargetHeightFt = editingPitchId !== null && editDraft ? editDraft.heightFt : displayPitch?.intendedHeightFt;
                    if (
                      !displayPitch ||
                      displayTargetSideFt === undefined ||
                      displayTargetHeightFt === undefined ||
                      (editingPitchId === null && (!lastMatchedPitch || pendingTarget || lastQueuedPitch)) ||
                      activeSession.mode === 'manual' ||
                      displayPitch.plateLocSide === null ||
                      displayPitch.plateLocHeight === null
                    ) {
                      return null;
                    }
                    const displayColor = PITCH_COLORS[displayPitch.pitchType ?? 'Undefined'] ?? PITCH_COLORS.Undefined;
                    return (
                      <g>
                        <line
                          x1={zonePx(displayTargetSideFt)}
                          y1={zonePy(displayTargetHeightFt)}
                          x2={zonePx(displayPitch.plateLocSide)}
                          y2={zonePy(displayPitch.plateLocHeight)}
                          stroke="rgba(248, 250, 252, 0.35)"
                          strokeWidth="1.5"
                          strokeDasharray="3 3"
                        />
                        <circle
                          className={editingPitchId === null && justLanded ? styles.actualDot : undefined}
                          cx={zonePx(displayPitch.plateLocSide)}
                          cy={zonePy(displayPitch.plateLocHeight)}
                          r="9"
                          fill={displayColor}
                          stroke={ZONE_STROKE_STRONG}
                          strokeWidth="2"
                        />
                      </g>
                    );
                  })()}
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
              ) : activeSession.mode === 'ftp_deferred' && (pendingTarget || lastQueuedPitch) && !targetIsConfirmedLocally ? (
                <div className={styles.actionRow}>
                  <p className={styles.zoneHint} style={{ marginBottom: 0 }}>
                    Target ready — tap anywhere else to move it.
                  </p>
                  <button type="button" className={styles.confirmButton} onClick={() => void confirmPendingTarget()} disabled={confirmingTarget}>
                    {confirmingTarget ? 'Confirming…' : 'Confirm Target'}
                  </button>
                </div>
              ) : activeSession.mode === 'ftp_deferred' && targetIsConfirmedLocally ? (
                <p className={styles.zoneHint}>Target confirmed — tap the zone to set the next target.</p>
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

              {/* Correct an already-landed/matched pitch's intended target --
                  started from that pitch's row in the Pitch Log table below
                  (Edit Target button per row, not just the most recent
                  pitch), never a direct zone click, to avoid accidentally
                  moving history while just reviewing/tracking -- see
                  editingPitchId's doc comment. This block is just the
                  save/cancel controls once editing is active; editingPitch
                  looks up which row that is (could be any pitch in the
                  session, not only the newest one). */}
              {editingPitchId !== null ? (
                <div className={styles.actionRow} style={{ marginTop: 8 }}>
                  <p className={styles.zoneHint} style={{ marginBottom: 0 }}>
                    Tap the zone for pitch #{editingPitch?.pitchIndex ?? editingPitchId}&apos;s corrected target.
                  </p>
                  <button type="button" className={styles.confirmButton} onClick={() => void saveEditTarget()} disabled={savingEdit}>
                    {savingEdit ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className={styles.resetButton} onClick={cancelEditTarget} disabled={savingEdit}>
                    Cancel
                  </button>
                </div>
              ) : null}

              {trackCountEnabled && activeSession.mode !== 'ftp_deferred' && lastMatchedPitch && lastMatchedPitch.isStrike === null ? (
                <div className={styles.actionRow} style={{ marginTop: 8 }}>
                  <p className={styles.zoneHint} style={{ marginBottom: 0 }}>
                    Was that a ball or a strike?
                  </p>
                  <button
                    type="button"
                    className={styles.confirmButton}
                    onClick={() => callBallOrStrike(lastMatchedPitch.id, true)}
                    disabled={callingPitchId === lastMatchedPitch.id}
                  >
                    Strike
                  </button>
                  <button
                    type="button"
                    className={styles.resetButton}
                    onClick={() => callBallOrStrike(lastMatchedPitch.id, false)}
                    disabled={callingPitchId === lastMatchedPitch.id}
                  >
                    Ball
                  </button>
                </div>
              ) : null}

              {trackCountEnabled && activeSession.mode === 'ftp_deferred' && pendingFtpCountPitchId !== null ? (
                <div className={styles.actionRow} style={{ marginTop: 8 }}>
                  <p className={styles.zoneHint} style={{ marginBottom: 0 }}>
                    Was that a ball or a strike?
                  </p>
                  <button
                    type="button"
                    className={styles.confirmButton}
                    onClick={() => callBallOrStrike(pendingFtpCountPitchId, true)}
                    disabled={callingPitchId === pendingFtpCountPitchId}
                  >
                    Strike
                  </button>
                  <button
                    type="button"
                    className={styles.resetButton}
                    onClick={() => callBallOrStrike(pendingFtpCountPitchId, false)}
                    disabled={callingPitchId === pendingFtpCountPitchId}
                  >
                    Ball
                  </button>
                </div>
              ) : null}

              {trackCountEnabled ? (
                <div className={styles.actionRow} style={{ marginTop: 8, flexWrap: 'wrap', gap: 16 }}>
                  <span className={styles.zoneHint} style={{ marginBottom: 0 }}>
                    Count: <strong>{currentCount.balls}-{currentCount.strikes}</strong>
                  </span>
                  {countStats ? (
                    <>
                      {/* In Zone%/Comp% need real landing location data, which
                          in FTP Sync mode doesn't exist yet at call-time --
                          hidden entirely (not shown as 0%/pending) until at
                          least one called pitch actually has it, same as
                          everywhere else location-dependent already defers
                          to FTP data arriving later. */}
                      {countStats.inZonePct !== null ? (
                        <span className={styles.zoneHint} style={{ marginBottom: 0 }}>In Zone {countStats.inZonePct.toFixed(0)}%</span>
                      ) : null}
                      {countStats.compPct !== null ? (
                        <span className={styles.zoneHint} style={{ marginBottom: 0 }}>Comp {countStats.compPct.toFixed(0)}%</span>
                      ) : null}
                      <span className={styles.zoneHint} style={{ marginBottom: 0 }}>Strike {countStats.strikePct.toFixed(0)}%</span>
                      <span className={styles.zoneHint} style={{ marginBottom: 0 }}>
                        2/3 {countStats.twoThreePct === null ? '—' : `${countStats.twoThreePct.toFixed(0)}%`}
                      </span>
                    </>
                  ) : null}
                  <button type="button" className={styles.resetButton} onClick={handleNextBatter}>
                    Next Batter
                  </button>
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
                          <th>Avg Miss</th>
                          <th>Median Miss</th>
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
                          <td>{zoneTallies.overall.avgMissFt !== null ? `${(zoneTallies.overall.avgMissFt * 12).toFixed(1)}"` : '—'}</td>
                          <td>{zoneTallies.overall.medianMissFt !== null ? `${(zoneTallies.overall.medianMissFt * 12).toFixed(1)}"` : '—'}</td>
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
                            <td>{tally.avgMissFt !== null ? `${(tally.avgMissFt * 12).toFixed(1)}"` : '—'}</td>
                            <td>{tally.medianMissFt !== null ? `${(tally.medianMissFt * 12).toFixed(1)}"` : '—'}</td>
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
                  <div className={styles.liveHeatmapGrid}>
                    {liveDirectionBreakdownsByPitchType.map(({ pitchType, breakdown, count }) => (
                      <section key={pitchType} className={styles.liveHeatmapCard}>
                        <div className={styles.liveHeatmapHeader}>
                          <span className={styles.logPitchType}>
                            <span className={styles.logPitchDot} style={{ background: PITCH_COLORS[pitchType] ?? PITCH_COLORS.Undefined }} />
                            {pitchType}
                          </span>
                          <span>{count}</span>
                        </div>
                        <DirectionHeatmap breakdown={breakdown} throwsLeft={liveThrowsLeft} />
                      </section>
                    ))}
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
                            {p.trackmanPlayId && activeSession.mode !== 'manual' ? (
                              <button
                                type="button"
                                className={styles.deleteLink}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  if (editingPitchId === p.id) cancelEditTarget();
                                  else startEditTarget(p);
                                }}
                              >
                                {editingPitchId === p.id ? 'Editing…' : 'Edit Target'}
                              </button>
                            ) : null}
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
