'use client';

import { useEffect, useMemo, useState } from 'react';
import { getProTeamLogoUrl } from './pro-team-logos';

type Candidate = {
  type: 'player' | 'team';
  value: string;
  suite: 'Pitching' | 'Hitting';
  team_code?: string;
};

type SearchPayload = {
  school_code: string;
  date_window: {
    startDate: string;
    endDate: string;
  };
  candidates: Candidate[];
  suggestions: Candidate[];
  selected: Candidate | null;
};

type AlertMetricPair = { season: number | null; recent: number | null };
type AlertRow = { name: string; sample: number; metrics: Record<string, AlertMetricPair> };
type PitchingAlertMetric = 'Velo' | 'K%' | 'BB%' | 'E+A%';
type HittingAlertMetric = 'xWOBA' | 'Barrel%' | 'GoZoneSw%';
type SortMode = 'improvement' | 'struggle';
type AlertsPayload = {
  school_code: string;
  season_start: string;
  season_end: string;
  recent_start: string;
  recent_end: string;
  pitching: AlertRow[];
  hitting: AlertRow[];
};

type HomeSuiteProps = {
  role: 'admin' | 'coach' | 'player';
  selectedSchoolCode: string;
  activeSuite: string;
  suiteOptions: string[];
  onOpenSuite: (suite: string) => void;
  onNavigate: (input: {
    suite: 'Pitching' | 'Hitting';
    targetType: 'player' | 'team';
    targetValue: string;
    startDate: string;
    endDate: string;
    page?: 'Summary' | 'Leaderboard' | 'Game Log';
    navigationSource?: 'search' | 'home_leaderboard';
  }) => void;
};

function toFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',');
  const first = rest.join(' ').trim();
  const combined = `${first} ${last}`.replace(/\s+/g, ' ').trim();
  return combined || raw;
}

function candidateLabel(candidate: Candidate): string {
  return toFirstLast(candidate.value);
}

function resolveCandidateLogoUrl(candidate: Candidate): string {
  const seed = candidate.type === 'team' ? candidate.value : candidate.team_code;
  const raw = getProTeamLogoUrl(seed);
  return String(raw ?? '').trim();
}

function resolveTypedCandidate(raw: string, candidates: Candidate[]): Candidate | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const splitIndex = text.indexOf(':');
  if (splitIndex > 0) {
    const typeRaw = text.slice(0, splitIndex).trim().toLowerCase();
    const value = text.slice(splitIndex + 1).trim();
    const typed = typeRaw === 'player' || typeRaw === 'team' ? typeRaw : '';
    if (typed && value) {
      const match = candidates.find(
        (entry) =>
          entry.type === typed &&
          (entry.value.toLowerCase() === value.toLowerCase() || toFirstLast(entry.value).toLowerCase() === value.toLowerCase())
      );
      if (match) return match;
    }
  }
  const exact = candidates.find(
    (entry) => entry.value.toLowerCase() === text.toLowerCase() || toFirstLast(entry.value).toLowerCase() === text.toLowerCase()
  );
  if (exact) return exact;
  return (
    candidates.find(
      (entry) =>
        entry.value.toLowerCase().includes(text.toLowerCase()) ||
        toFirstLast(entry.value).toLowerCase().includes(text.toLowerCase())
    ) ?? null
  );
}

async function fetchHomePayload(query = '', signal?: AbortSignal): Promise<SearchPayload> {
  const url = query ? `/api/dashboard/home/search?${query}` : '/api/dashboard/home/search';
  const response = await fetch(url, { cache: 'no-store', signal });
  const payload = (await response.json()) as SearchPayload & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error || 'Failed to load dashboard home data.');
  }
  return payload;
}

function suiteDescription(name: string): string {
  const key = String(name ?? '').trim().toLowerCase();
  if (key === 'pitching') return 'Velocity, movement, locations, trends, and game-by-game pitch insights.';
  if (key === 'hitting') return 'Approach, contact quality, outcomes, and hitter performance splits.';
  if (key === 'catching') return 'Pop time, exchange, throwing, and receiving performance snapshots.';
  if (key === 'custom reports') return 'Open saved report views built for your staff workflows.';
  if (key === 'comparison tool') return 'Compare players, groups, and profiles side by side.';
  if (key === 'player plans') return 'Review and manage plan progress for athletes.';
  if (key === 'player notes') return 'Staff notes and communication history in one place.';
  if (key === 'stuff+ calculator') return 'Model and evaluate pitch quality metrics quickly.';
  return 'Open this dashboard suite.';
}

async function fetchAlertsPayload(signal?: AbortSignal): Promise<AlertsPayload> {
  const response = await fetch('/api/dashboard/home/alerts', { cache: 'no-store', signal });
  const payload = (await response.json()) as AlertsPayload & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Failed to load alerts.');
  return payload;
}

function formatMetricValue(metric: string, value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '-';
  const key = metric.toLowerCase();
  if (key.includes('%')) return `${value.toFixed(1)}%`;
  if (key === 'xwoba') return value.toFixed(3);
  if (key === 'velo') return value.toFixed(1);
  return value.toFixed(2);
}

function metricDelta(season: number | null, recent: number | null): number | null {
  if (season === null || recent === null) return null;
  if (!Number.isFinite(season) || !Number.isFinite(recent)) return null;
  return recent - season;
}

function metricImprovementScore(metric: string, season: number | null, recent: number | null): number | null {
  const delta = metricDelta(season, recent);
  if (delta === null) return null;
  if (metric === 'BB%') return -delta;
  return delta;
}

function todayYmd(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function HomeSuite({ role, selectedSchoolCode, activeSuite, suiteOptions, onOpenSuite, onNavigate }: HomeSuiteProps) {
  const [basePayload, setBasePayload] = useState<SearchPayload | null>(null);
  const [alertsPayload, setAlertsPayload] = useState<AlertsPayload | null>(null);
  const [query, setQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loadingBase, setLoadingBase] = useState(true);
  const [loadingAlerts, setLoadingAlerts] = useState(false);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pitchingSort, setPitchingSort] = useState<{ metric: PitchingAlertMetric | null; mode: SortMode }>({
    metric: null,
    mode: 'improvement',
  });
  const [hittingSort, setHittingSort] = useState<{ metric: HittingAlertMetric | null; mode: SortMode }>({
    metric: null,
    mode: 'improvement',
  });
  const [pitchingPage, setPitchingPage] = useState(1);
  const [hittingPage, setHittingPage] = useState(1);
  const pageSize = 25;
  const isProSchool = String(selectedSchoolCode ?? '').trim().toUpperCase() === 'PRO';
  const isLeagueSchool = String(selectedSchoolCode ?? '').trim().toUpperCase() === 'LEAGUE';
  const isHeavySchool = isProSchool || isLeagueSchool;
  const shouldLoadAlerts = !isHeavySchool && role !== 'player';
  const homeSearchBorder = isProSchool
    ? '1px solid rgba(88, 132, 198, 0.62)'
    : '1px solid rgba(var(--portal-accent-rgb, 200, 16, 46), 0.45)';
  const homeSearchBackground = isProSchool
    ? 'linear-gradient(145deg, rgba(6, 17, 38, 0.95), rgba(7, 23, 50, 0.92))'
    : 'rgba(3, 3, 3, 0.72)';
  const homeSearchDropdownBorder = isProSchool
    ? '1px solid rgba(88, 132, 198, 0.58)'
    : '1px solid rgba(var(--portal-accent-rgb, 200, 16, 46), 0.45)';
  const homeSearchDropdownBackground = isProSchool
    ? 'linear-gradient(150deg, rgba(6, 16, 35, 0.98), rgba(7, 25, 54, 0.96))'
    : 'rgba(var(--portal-accent-rgb, 200, 16, 46), 0.12)';
  const homePanelBorder = isProSchool
    ? '1px solid rgba(88, 132, 198, 0.62)'
    : '1px solid rgba(var(--portal-accent-rgb, 200, 16, 46), 0.55)';
  const homePanelBackground = isProSchool
    ? 'linear-gradient(155deg, rgba(11, 38, 84, 0.34), rgba(5, 11, 24, 0.86))'
    : 'linear-gradient(155deg, rgba(var(--portal-accent-rgb, 200, 16, 46), 0.24), rgba(4, 4, 4, 0.62))';
  const homePanelShadow = isProSchool
    ? '0 16px 32px rgba(2, 8, 23, 0.44), 0 0 0 1px rgba(59, 92, 150, 0.2)'
    : '0 14px 28px rgba(2, 6, 23, 0.28)';

  useEffect(() => {
    let isMounted = true;
    fetchHomePayload('')
      .then((payload) => {
        if (!isMounted) return;
        setBasePayload(payload);
        setError(null);
      })
      .catch((err) => {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : 'Failed to load dashboard home data.';
        setError(message);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoadingBase(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);
  useEffect(() => {
    if (!shouldLoadAlerts) {
      setLoadingAlerts(false);
      setAlertsPayload(null);
      setAlertsError(null);
      return () => {};
    }
    let isMounted = true;
    setLoadingAlerts(true);
    fetchAlertsPayload()
      .then((payload) => {
        if (!isMounted) return;
        setAlertsPayload(payload);
        setAlertsError(null);
      })
      .catch((err) => {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : 'Failed to load alerts.';
        setAlertsError(message);
      })
      .finally(() => {
        if (!isMounted) return;
        setLoadingAlerts(false);
      });
    return () => {
      isMounted = false;
    };
  }, [shouldLoadAlerts]);

  const matchingCandidates = useMemo(() => {
    const source = basePayload?.candidates ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return [];
    return source.filter(
      (candidate) =>
        candidate.value.toLowerCase().includes(needle) ||
        toFirstLast(candidate.value).toLowerCase().includes(needle)
    );
  }, [basePayload?.candidates, query]);
  const filteredCandidates = useMemo(() => matchingCandidates.slice(0, 12), [matchingCandidates]);
  const quickPanels = useMemo(
    () =>
      suiteOptions
        .filter((suite) => suite !== 'Home')
        .map((suite) => ({
          suite,
          title: suite,
        })),
    [suiteOptions]
  );
  const orderedQuickPanels = useMemo(() => {
    if (!isHeavySchool) return quickPanels;
    const pitchingPanel = quickPanels.find((panel) => panel.suite === 'Pitching');
    const hittingPanel = quickPanels.find((panel) => panel.suite === 'Hitting');
    const remaining = quickPanels.filter((panel) => panel.suite !== 'Pitching' && panel.suite !== 'Hitting');
    return [pitchingPanel, hittingPanel, ...remaining].filter((panel): panel is { suite: string; title: string } => Boolean(panel));
  }, [quickPanels, isHeavySchool]);
  const leadingQuickPanels = useMemo(
    () => (isHeavySchool ? orderedQuickPanels.slice(0, 2) : orderedQuickPanels),
    [isHeavySchool, orderedQuickPanels]
  );
  const trailingQuickPanels = useMemo(
    () => (isHeavySchool ? orderedQuickPanels.slice(2) : []),
    [isHeavySchool, orderedQuickPanels]
  );
  const schoolPanelsWithoutStuff = useMemo(() => {
    if (isHeavySchool) return [] as Array<{ suite: string; title: string }>;
    const panels = orderedQuickPanels.filter((panel) => panel.suite !== 'Stuff+ Calculator');
    const comparisonIndex = panels.findIndex((panel) => panel.suite === 'Comparison Tool');
    const gameLogPanel = { suite: '__game_log__', title: 'Game Log' };
    if (comparisonIndex >= 0) {
      return [...panels.slice(0, comparisonIndex + 1), gameLogPanel, ...panels.slice(comparisonIndex + 1)];
    }
    return [...panels, gameLogPanel];
  }, [isHeavySchool, orderedQuickPanels]);
  const hasSchoolStuffPanel = useMemo(
    () => !isHeavySchool && orderedQuickPanels.some((panel) => panel.suite === 'Stuff+ Calculator'),
    [isHeavySchool, orderedQuickPanels]
  );
  const sortedPitchingAlerts = useMemo(() => {
    const rows = [...(alertsPayload?.pitching ?? [])];
    const metric = pitchingSort.metric;
    if (!metric) return rows;
    rows.sort((a, b) => {
      const aPair = a.metrics[metric];
      const bPair = b.metrics[metric];
      const aScore = metricImprovementScore(metric, aPair?.season ?? null, aPair?.recent ?? null);
      const bScore = metricImprovementScore(metric, bPair?.season ?? null, bPair?.recent ?? null);
      if (aScore === null && bScore === null) return 0;
      if (aScore === null) return 1;
      if (bScore === null) return -1;
      return pitchingSort.mode === 'improvement' ? bScore - aScore : aScore - bScore;
    });
    return rows;
  }, [alertsPayload?.pitching, pitchingSort]);
  const sortedHittingAlerts = useMemo(() => {
    const rows = [...(alertsPayload?.hitting ?? [])];
    const metric = hittingSort.metric;
    if (!metric) return rows;
    rows.sort((a, b) => {
      const aPair = a.metrics[metric];
      const bPair = b.metrics[metric];
      const aScore = metricImprovementScore(metric, aPair?.season ?? null, aPair?.recent ?? null);
      const bScore = metricImprovementScore(metric, bPair?.season ?? null, bPair?.recent ?? null);
      if (aScore === null && bScore === null) return 0;
      if (aScore === null) return 1;
      if (bScore === null) return -1;
      return hittingSort.mode === 'improvement' ? bScore - aScore : aScore - bScore;
    });
    return rows;
  }, [alertsPayload?.hitting, hittingSort]);
  const pitchingPageCount = useMemo(
    () => Math.max(1, Math.ceil(sortedPitchingAlerts.length / pageSize)),
    [sortedPitchingAlerts.length]
  );
  const hittingPageCount = useMemo(
    () => Math.max(1, Math.ceil(sortedHittingAlerts.length / pageSize)),
    [sortedHittingAlerts.length]
  );
  const effectivePitchingPage = Math.min(pitchingPage, pitchingPageCount);
  const effectiveHittingPage = Math.min(hittingPage, hittingPageCount);
  const pagedPitchingAlerts = useMemo(() => {
    const start = (effectivePitchingPage - 1) * pageSize;
    return sortedPitchingAlerts.slice(start, start + pageSize);
  }, [sortedPitchingAlerts, effectivePitchingPage]);
  const pagedHittingAlerts = useMemo(() => {
    const start = (effectiveHittingPage - 1) * pageSize;
    return sortedHittingAlerts.slice(start, start + pageSize);
  }, [sortedHittingAlerts, effectiveHittingPage]);

  function navigateToCandidate(candidate: Candidate) {
    const window = basePayload?.date_window;
    if (!window) {
      setError('Date window is not loaded yet. Try again in a second.');
      return;
    }
    onNavigate({
      suite: candidate.suite,
      targetType: candidate.type,
      targetValue: candidate.value,
      startDate: window.startDate,
      endDate: window.endDate,
      navigationSource: 'search',
    });
  }

  function navigateFromInput() {
    const parsed = resolveTypedCandidate(searchInput, matchingCandidates);
    if (parsed) {
      navigateToCandidate(parsed);
      return;
    }
    if (matchingCandidates.length > 0) {
      navigateToCandidate(matchingCandidates[0]);
      return;
    }
    setError('No matching player or team found.');
  }
  function openPitchingAlertPlayer(playerName: string) {
    const candidates = (basePayload?.candidates ?? []).filter(
      (candidate) => candidate.type === 'player' && candidate.suite === 'Pitching'
    );
    const normalizedTarget = playerName.trim().toLowerCase();
    const matched =
      candidates.find((candidate) => toFirstLast(candidate.value).trim().toLowerCase() === normalizedTarget) ??
      candidates.find((candidate) => candidate.value.trim().toLowerCase() === normalizedTarget) ??
      null;
    const startDate = alertsPayload?.season_start ?? '2026-02-13';
    const endDate = alertsPayload?.season_end ?? todayYmd();
    onNavigate({
      suite: 'Pitching',
      targetType: 'player',
      targetValue: matched?.value ?? playerName,
      startDate,
      endDate,
    });
  }
  function openHittingAlertPlayer(playerName: string) {
    const candidates = (basePayload?.candidates ?? []).filter(
      (candidate) => candidate.type === 'player' && candidate.suite === 'Hitting'
    );
    const normalizedTarget = playerName.trim().toLowerCase();
    const matched =
      candidates.find((candidate) => toFirstLast(candidate.value).trim().toLowerCase() === normalizedTarget) ??
      candidates.find((candidate) => candidate.value.trim().toLowerCase() === normalizedTarget) ??
      null;
    const startDate = alertsPayload?.season_start ?? '2026-02-13';
    const endDate = alertsPayload?.season_end ?? todayYmd();
    onNavigate({
      suite: 'Hitting',
      targetType: 'player',
      targetValue: matched?.value ?? playerName,
      startDate,
      endDate,
    });
  }
  function resolveHeavyLeaderboardWindow(): { startDate: string; endDate: string } {
    const endDate = todayYmd();
    if (isProSchool) return { startDate: '2026-03-25', endDate };
    return { startDate: '2026-02-13', endDate };
  }
  function resolveGameLogTargetTeam(): string {
    const teamCandidates = (basePayload?.candidates ?? []).filter(
      (candidate) => candidate.type === 'team' && candidate.suite === 'Pitching'
    );
    const nonAllTeam = teamCandidates.find((candidate) => String(candidate.value ?? '').trim().toLowerCase() !== 'all');
    if (isHeavySchool) {
      return nonAllTeam?.value ?? 'All';
    }
    const schoolCode = String(selectedSchoolCode ?? '').trim();
    if (!schoolCode) return nonAllTeam?.value ?? 'All';
    const exactSchoolTeam =
      teamCandidates.find((candidate) => String(candidate.value ?? '').trim().toUpperCase() === schoolCode.toUpperCase()) ??
      teamCandidates.find((candidate) => String(candidate.value ?? '').trim().toLowerCase() === schoolCode.toLowerCase());
    return exactSchoolTeam?.value ?? nonAllTeam?.value ?? schoolCode;
  }
  function openHomeGameLog() {
    const window = basePayload?.date_window;
    const fallbackWindow = resolveHeavyLeaderboardWindow();
    const targetTeam = resolveGameLogTargetTeam();
    onNavigate({
      suite: 'Pitching',
      targetType: 'team',
      targetValue: targetTeam,
      startDate: window?.startDate ?? fallbackWindow.startDate,
      endDate: window?.endDate ?? fallbackWindow.endDate,
      page: 'Game Log',
    });
  }
  function togglePitchingSort(metric: PitchingAlertMetric) {
    setPitchingPage(1);
    setPitchingSort((current) => {
      if (current.metric !== metric) return { metric, mode: 'improvement' };
      return { metric, mode: current.mode === 'improvement' ? 'struggle' : 'improvement' };
    });
  }
  function toggleHittingSort(metric: HittingAlertMetric) {
    setHittingPage(1);
    setHittingSort((current) => {
      if (current.metric !== metric) return { metric, mode: 'improvement' };
      return { metric, mode: current.mode === 'improvement' ? 'struggle' : 'improvement' };
    });
  }
  function headerIndicator(activeMetric: string | null, metric: string, mode: SortMode): string {
    if (activeMetric !== metric) return '';
    return mode === 'improvement' ? ' ▲' : ' ▼';
  }

  return (
    <section className="portal-panel">
      <div style={{ display: 'grid', placeItems: 'center', gap: 14 }}>
        <div style={{ width: 'min(760px, 100%)', display: 'grid', gap: 10 }}>
          <input
            className="portal-search"
            placeholder="Search player or team"
            value={searchInput}
            onChange={(event) => {
              setSearchInput(event.target.value);
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              navigateFromInput();
            }}
            style={{
              width: '100%',
              padding: '16px 18px',
              fontSize: 18,
              borderRadius: 14,
              border: homeSearchBorder,
              background: homeSearchBackground,
              color: '#f8fafc',
            }}
          />
          <div
            style={{
              display: filteredCandidates.length ? 'grid' : 'none',
              gap: 6,
              maxHeight: 320,
              overflowY: 'auto',
              padding: 8,
              borderRadius: 12,
              border: homeSearchDropdownBorder,
              background: homeSearchDropdownBackground,
            }}
          >
            {filteredCandidates.map((candidate) => {
              const logoUrl = isProSchool ? resolveCandidateLogoUrl(candidate) : '';
              return (
                <button
                  key={`${candidate.type}:${candidate.value}:${candidate.suite}`}
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => navigateToCandidate(candidate)}
                  style={{
                    textAlign: 'left',
                    justifyContent: 'flex-start',
                    width: '100%',
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt={candidate.type === 'team' ? candidate.value : (candidate.team_code ?? '')}
                        style={{ width: 16, height: 16, objectFit: 'contain' }}
                      />
                    ) : null}
                    <span>{candidateLabel(candidate)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        {error ? <p style={{ margin: 0, color: '#ef4444' }}>{error}</p> : null}
        {!error && loadingBase ? <p style={{ margin: 0 }}>Loading data...</p> : null}
      </div>

      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 24, marginBottom: 16 }}>
        {isHeavySchool ? (
          <>
            {leadingQuickPanels.map((panel) => (
              <button
                key={panel.suite}
                type="button"
                className="home-suite-panel-card"
                onClick={() => onOpenSuite(panel.suite)}
                style={{
                  textAlign: 'center',
                  borderRadius: 14,
                  border: homePanelBorder,
                  background: homePanelBackground,
                  padding: '14px 14px 13px',
                  cursor: 'pointer',
                  color: '#f8fafc',
                  boxShadow: homePanelShadow,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: panel.suite === activeSuite ? 0.9 : 1,
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.01em' }}>{panel.title}</span>
              </button>
            ))}
          <>
            <button
              key="heavy-pitching-leaderboard"
              type="button"
              className="home-suite-panel-card"
              onClick={() => {
                const window = resolveHeavyLeaderboardWindow();
                onNavigate({
                  suite: 'Pitching',
                  targetType: 'team',
                  targetValue: 'All',
                  startDate: window.startDate,
                  endDate: window.endDate,
                  page: 'Leaderboard',
                  navigationSource: 'home_leaderboard',
                });
              }}
              style={{
                textAlign: 'center',
                borderRadius: 14,
                border: homePanelBorder,
                background: homePanelBackground,
                padding: '14px 14px 13px',
                cursor: 'pointer',
                color: '#f8fafc',
                boxShadow: homePanelShadow,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.01em' }}>Pitching Leaderboard</span>
            </button>
            <button
              key="heavy-hitting-leaderboard"
              type="button"
              className="home-suite-panel-card"
              onClick={() => {
                const window = resolveHeavyLeaderboardWindow();
                onNavigate({
                  suite: 'Hitting',
                  targetType: 'team',
                  targetValue: 'All',
                  startDate: window.startDate,
                  endDate: window.endDate,
                  page: 'Leaderboard',
                  navigationSource: 'home_leaderboard',
                });
              }}
              style={{
                textAlign: 'center',
                borderRadius: 14,
                border: homePanelBorder,
                background: homePanelBackground,
                padding: '14px 14px 13px',
                cursor: 'pointer',
                color: '#f8fafc',
                boxShadow: homePanelShadow,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.01em' }}>Hitting Leaderboard</span>
            </button>
          </>
            <button
              key="home-game-log"
              type="button"
              className="home-suite-panel-card"
              onClick={openHomeGameLog}
              style={{
                textAlign: 'center',
                borderRadius: 14,
                border: homePanelBorder,
                background: homePanelBackground,
                padding: '14px 14px 13px',
                cursor: 'pointer',
                color: '#f8fafc',
                boxShadow: homePanelShadow,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.01em' }}>Game Log</span>
            </button>
            {trailingQuickPanels.map((panel) => (
              <button
                key={`tail-${panel.suite}`}
                type="button"
                className="home-suite-panel-card"
                onClick={() => onOpenSuite(panel.suite)}
                style={{
                  textAlign: 'center',
                  borderRadius: 14,
                  border: homePanelBorder,
                  background: homePanelBackground,
                  padding: '14px 14px 13px',
                  cursor: 'pointer',
                  color: '#f8fafc',
                  boxShadow: homePanelShadow,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: panel.suite === activeSuite ? 0.9 : 1,
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.01em' }}>{panel.title}</span>
              </button>
            ))}
          </>
        ) : (
          <>
            {schoolPanelsWithoutStuff.map((panel) => (
              <button
                key={panel.suite}
                type="button"
                className="home-suite-panel-card"
                onClick={() => {
                  if (panel.suite === '__game_log__') {
                    openHomeGameLog();
                    return;
                  }
                  onOpenSuite(panel.suite);
                }}
                style={{
                  textAlign: 'center',
                  borderRadius: 14,
                  border: homePanelBorder,
                  background: homePanelBackground,
                  padding: '14px 14px 13px',
                  cursor: 'pointer',
                  color: '#f8fafc',
                  boxShadow: homePanelShadow,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: panel.suite === activeSuite ? 0.9 : 1,
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.01em' }}>{panel.title}</span>
              </button>
            ))}
            {hasSchoolStuffPanel ? (
              <button
                key="school-stuff-bottom"
                type="button"
                className="home-suite-panel-card"
                onClick={() => onOpenSuite('Stuff+ Calculator')}
                style={{
                  textAlign: 'center',
                  borderRadius: 14,
                  border: homePanelBorder,
                  background: homePanelBackground,
                  padding: '14px 14px 13px',
                  cursor: 'pointer',
                  color: '#f8fafc',
                  boxShadow: homePanelShadow,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: activeSuite === 'Stuff+ Calculator' ? 0.9 : 1,
                  gridColumn: '1 / -1',
                  justifySelf: 'center',
                  width: 'min(520px, 100%)',
                }}
              >
                <span style={{ fontSize: 16, fontWeight: 800, letterSpacing: '0.01em' }}>Stuff+ Calculator</span>
              </button>
            ) : null}
          </>
        )}
      </div>

      {shouldLoadAlerts ? (
      <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', marginTop: 8 }}>
        <section className="portal-panel" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Pitching Trends (Last 2 Weeks vs Season)</h3>
          {loadingAlerts ? <p style={{ margin: 0 }}>Loading pitching alerts...</p> : null}
          {!loadingAlerts && alertsError ? <p className="auth-error">{alertsError}</p> : null}
          {!loadingAlerts && !alertsError ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    {(['Velo', 'K%', 'BB%', 'E+A%'] as PitchingAlertMetric[]).map((metric) => (
                      <th key={`p-header-${metric}`}>
                        <button
                          type="button"
                          onClick={() => togglePitchingSort(metric)}
                          style={{
                            all: 'unset',
                            cursor: 'pointer',
                            fontWeight: 700,
                          }}
                        >
                          {metric}
                          {headerIndicator(pitchingSort.metric, metric, pitchingSort.mode)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedPitchingAlerts.map((row) => (
                    <tr key={`p-alert-${row.name}`}>
                      <td>
                        <button
                          type="button"
                          onClick={() => openPitchingAlertPlayer(row.name)}
                          style={{
                            all: 'unset',
                            cursor: 'pointer',
                            color: 'var(--portal-link, #60a5fa)',
                            fontWeight: 700,
                          }}
                          title={`Open ${row.name} pitching summary`}
                        >
                          {row.name}
                        </button>
                      </td>
                      {['Velo', 'K%', 'BB%', 'E+A%'].map((metric) => {
                        const pair = row.metrics[metric];
                        const delta = metricDelta(pair?.season ?? null, pair?.recent ?? null);
                        const up = typeof delta === 'number' && delta > 0;
                        const down = typeof delta === 'number' && delta < 0;
                        const isReverseGood = metric === 'BB%';
                        const deltaColor =
                          up
                            ? isReverseGood
                              ? '#ef4444'
                              : '#22c55e'
                            : down
                              ? isReverseGood
                                ? '#22c55e'
                                : '#ef4444'
                              : '#94a3b8';
                        return (
                          <td key={`p-${row.name}-${metric}`}>
                            <div style={{ display: 'grid', gap: 2 }}>
                              <span style={{ opacity: 0.85 }}>
                                {formatMetricValue(metric, pair?.season ?? null)}
                                {' \u2192 '}
                                {formatMetricValue(metric, pair?.recent ?? null)}
                              </span>
                              <span
                                style={{
                                  color: deltaColor,
                                  fontWeight: 700,
                                  fontSize: 12,
                                }}
                              >
                                {up ? '↑' : down ? '↓' : '→'} {delta === null ? '-' : `${Math.abs(delta).toFixed(metric.includes('%') ? 1 : 2)}${metric.includes('%') ? '%' : ''}`}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!loadingAlerts && !alertsError && sortedPitchingAlerts.length > pageSize ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setPitchingPage((prev) => Math.max(1, prev - 1))} disabled={effectivePitchingPage <= 1}>
                Previous 25
              </button>
              <span className="portal-muted-text" style={{ fontSize: 12 }}>Page {effectivePitchingPage} of {pitchingPageCount}</span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPitchingPage((prev) => Math.min(pitchingPageCount, prev + 1))}
                disabled={effectivePitchingPage >= pitchingPageCount}
              >
                Next 25
              </button>
            </div>
          ) : null}
        </section>

        <section className="portal-panel" style={{ margin: 0 }}>
          <h3 style={{ marginTop: 0, marginBottom: 8 }}>Hitting Trends (Last 2 Weeks vs Season)</h3>
          {loadingAlerts ? <p style={{ margin: 0 }}>Loading hitting alerts...</p> : null}
          {!loadingAlerts && alertsError ? <p className="auth-error">{alertsError}</p> : null}
          {!loadingAlerts && !alertsError ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="portal-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    {(['xWOBA', 'Barrel%', 'GoZoneSw%'] as HittingAlertMetric[]).map((metric) => (
                      <th key={`h-header-${metric}`}>
                        <button
                          type="button"
                          onClick={() => toggleHittingSort(metric)}
                          style={{
                            all: 'unset',
                            cursor: 'pointer',
                            fontWeight: 700,
                          }}
                        >
                          {metric}
                          {headerIndicator(hittingSort.metric, metric, hittingSort.mode)}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pagedHittingAlerts.map((row) => (
                    <tr key={`h-alert-${row.name}`}>
                      <td>
                        <button
                          type="button"
                          onClick={() => openHittingAlertPlayer(row.name)}
                          style={{
                            all: 'unset',
                            cursor: 'pointer',
                            color: 'var(--portal-link, #60a5fa)',
                            fontWeight: 700,
                          }}
                          title={`Open ${row.name} hitting summary`}
                        >
                          {row.name}
                        </button>
                      </td>
                      {['xWOBA', 'Barrel%', 'GoZoneSw%'].map((metric) => {
                        const pair = row.metrics[metric];
                        const delta = metricDelta(pair?.season ?? null, pair?.recent ?? null);
                        const up = typeof delta === 'number' && delta > 0;
                        const down = typeof delta === 'number' && delta < 0;
                        return (
                          <td key={`h-${row.name}-${metric}`}>
                            <div style={{ display: 'grid', gap: 2 }}>
                              <span style={{ opacity: 0.85 }}>
                                {formatMetricValue(metric, pair?.season ?? null)}
                                {' \u2192 '}
                                {formatMetricValue(metric, pair?.recent ?? null)}
                              </span>
                              <span
                                style={{
                                  color: up ? '#22c55e' : down ? '#ef4444' : '#94a3b8',
                                  fontWeight: 700,
                                  fontSize: 12,
                                }}
                              >
                                {up ? '↑' : down ? '↓' : '→'} {delta === null ? '-' : `${Math.abs(delta).toFixed(metric.includes('%') ? 1 : 3)}${metric.includes('%') ? '%' : ''}`}
                              </span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!loadingAlerts && !alertsError && sortedHittingAlerts.length > pageSize ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setHittingPage((prev) => Math.max(1, prev - 1))} disabled={effectiveHittingPage <= 1}>
                Previous 25
              </button>
              <span className="portal-muted-text" style={{ fontSize: 12 }}>Page {effectiveHittingPage} of {hittingPageCount}</span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setHittingPage((prev) => Math.min(hittingPageCount, prev + 1))}
                disabled={effectiveHittingPage >= hittingPageCount}
              >
                Next 25
              </button>
            </div>
          ) : null}
        </section>
      </div>
      ) : null}

    </section>
  );
}
