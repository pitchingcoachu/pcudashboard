'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import BiomechanicsHub from './biomechanics-hub';
import CatchingSuite from './catching-suite';
import ComparisonToolSuite from './comparison-tool-suite';
import CustomReportsSuite from './custom-reports-suite';
import HittingSuite from './hitting-suite';
import HomeSuite from './home-suite';
import MobileDashboardHome from './mobile-dashboard-home';
import PlayerPlansSuite from './player-plans-suite';
import PitchingSuite from './pitching-suite';
import { LEAGUE_TEAM_NAME_BY_CODE } from '../../../lib/league-team-name-map';
import { getProTeamDisplayName, getProTeamLogoUrl, inferProTeamCode } from './pro-team-logos';
import StuffCalculatorSuite from './stuff-calculator-suite';
import { dashboardActivityPath, dispatchPortalActivity } from './activity-events';

type DashboardShellProps = {
  role: 'admin' | 'coach' | 'player';
  selectedSchoolCode: string;
  forceHome?: boolean;
  initialSuite?: SuiteName | null;
};

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

type SuiteName =
  | 'Home'
  | 'Pitching'
  | 'Hitting'
  | 'Catching'
  | 'Custom Reports'
  | 'Comparison Tool'
  | 'Biomechanics'
  | 'Player Plans'
  | 'Stuff+ Calculator';

type HomeNavigateRequest = {
  requestId: number;
  suite: 'Pitching' | 'Hitting';
  targetType: 'player' | 'team';
  targetValue: string;
  startDate: string;
  endDate: string;
  page?: 'Summary' | 'Leaderboard' | 'Game Log';
  navigationSource?: 'search' | 'home_leaderboard';
};

const ALL_SUITE_NAMES: SuiteName[] = [
  'Home',
  'Pitching',
  'Hitting',
  'Catching',
  'Custom Reports',
  'Comparison Tool',
  'Biomechanics',
  'Player Plans',
  'Stuff+ Calculator',
];

function toFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',');
  const first = rest.join(' ').trim();
  const combined = `${first} ${last}`.replace(/\s+/g, ' ').trim();
  return combined || raw;
}

function suiteActivitySlug(value: string): string {
  if (value === 'Stuff+ Calculator') return 'stuff-calculator';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

function resolveCandidateLogoUrl(isPro: boolean, candidate: Candidate): string {
  if (!isPro) return '';
  const playerTeam = String(candidate.team_code ?? '').trim();
  if (candidate.type === 'player') {
    if (!playerTeam) return '';
    return String(getProTeamLogoUrl(playerTeam) ?? '').trim();
  }
  const teamSeed = playerTeam || inferProTeamCode(candidate.value) || candidate.value;
  return String(getProTeamLogoUrl(teamSeed) ?? '').trim();
}

function formatCandidateTeamName(isPro: boolean, value: string | null | undefined): string {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (isPro) return getProTeamDisplayName(raw);
  const upper = raw.toUpperCase();
  return LEAGUE_TEAM_NAME_BY_CODE[upper] ?? raw;
}

function candidateSearchLabelParts(isPro: boolean, candidate: Candidate): { primary: string; team: string } {
  if (candidate.type === 'team') return { primary: formatCandidateTeamName(isPro, candidate.value) || toFirstLast(candidate.value), team: '' };
  return {
    primary: toFirstLast(candidate.value),
    team: formatCandidateTeamName(isPro, candidate.team_code),
  };
}

async function fetchHomePayload(signal?: AbortSignal): Promise<SearchPayload> {
  const response = await fetch('/api/dashboard/home/search', { cache: 'no-store', signal });
  const payload = (await response.json()) as SearchPayload & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Failed to load dashboard search.');
  return payload;
}

export default function DashboardShell({ role, selectedSchoolCode, forceHome = false, initialSuite = null }: DashboardShellProps) {
  const storageSchoolToken = String(selectedSchoolCode ?? '').trim().toUpperCase() || 'DEFAULT';
  const shellStorageKey = `portal_dashboard_shell_state:${storageSchoolToken}`;
  const pendingHomeNavigateStorageKey = `portal_dashboard_home_nav:${storageSchoolToken}`;
  const [homeNavigateRequest, setHomeNavigateRequest] = useState<HomeNavigateRequest | null>(null);
  const [suite, setSuite] = useState<SuiteName>('Home');
  const appliedHomeNavigateSuiteRef = useRef<number | null>(null);
  const [navSearchPayload, setNavSearchPayload] = useState<SearchPayload | null>(null);
  const [navSearchInput, setNavSearchInput] = useState('');
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [navSearchError, setNavSearchError] = useState<string | null>(null);
  const [mountedSuites, setMountedSuites] = useState<Record<SuiteName, boolean>>(() => ({
    Home: suite === 'Home',
    Pitching: suite === 'Pitching',
    Hitting: suite === 'Hitting',
    Catching: suite === 'Catching',
    'Custom Reports': suite === 'Custom Reports',
    'Comparison Tool': suite === 'Comparison Tool',
    'Biomechanics': suite === 'Biomechanics',
    'Player Plans': suite === 'Player Plans',
    'Stuff+ Calculator': suite === 'Stuff+ Calculator',
  }));
  const isLeague = String(selectedSchoolCode || '').toUpperCase() === 'LEAGUE';
  const isPro = String(selectedSchoolCode || '').toUpperCase() === 'PRO';
  const navSearchBorder = isPro
    ? '1px solid rgba(88, 132, 198, 0.62)'
    : '1px solid rgba(var(--portal-accent-rgb, 200, 16, 46), 0.45)';
  const navSearchBackground = isPro
    ? 'linear-gradient(145deg, rgba(6, 17, 38, 0.95), rgba(7, 23, 50, 0.92))'
    : 'rgba(3, 3, 3, 0.72)';
  const navSearchDropdownBorder = isPro
    ? '1px solid rgba(88, 132, 198, 0.58)'
    : '1px solid rgba(var(--portal-accent-rgb, 200, 16, 46), 0.45)';
  const navSearchDropdownBackground = isPro
    ? 'linear-gradient(150deg, rgba(6, 16, 35, 0.98), rgba(7, 25, 54, 0.96))'
    : 'rgba(5, 5, 6, 0.97)';
  const activeSuiteButtonStyle = isPro
    ? {
        borderColor: 'rgba(109, 153, 220, 0.9)',
        background: 'linear-gradient(135deg, rgba(22, 62, 128, 0.98), rgba(10, 32, 70, 0.96))',
        boxShadow: '0 10px 24px rgba(8, 22, 48, 0.42), 0 0 0 1px rgba(109, 153, 220, 0.24)',
        color: '#f8fafc',
      }
    : undefined;
  const suiteOptions: SuiteName[] = useMemo(() => {
    const base: SuiteName[] = ['Home', 'Pitching', 'Hitting'];
    if (!isPro) base.push('Catching');
    base.push('Custom Reports', 'Comparison Tool');
    if (String(selectedSchoolCode || '').trim().toUpperCase() === 'PCU') base.push('Biomechanics');
    if (!isLeague) base.push('Player Plans');
    if (!isLeague) base.push('Stuff+ Calculator');
    return base;
  }, [isLeague, isPro, selectedSchoolCode]);

  const activeSuite: SuiteName = suiteOptions.includes(suite) ? suite : 'Home';
  const showSuite = (name: SuiteName) => activeSuite === name;
  const activateSuite = useCallback((name: string) => {
    const resolved = suiteOptions.includes(name as SuiteName) ? (name as SuiteName) : 'Home';
    setSuite(resolved);
    setMountedSuites((current) => (current[resolved] ? current : { ...current, [resolved]: true }));
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(shellStorageKey, resolved);
      } catch {
        // Ignore client storage errors.
      }
    }
  }, [shellStorageKey, suiteOptions]);
  useEffect(() => {
    dispatchPortalActivity({
      eventType: 'page_view',
      path: dashboardActivityPath(suiteActivitySlug(activeSuite)),
      metadata: {
        pageLabel: `Dashboard / ${activeSuite}`,
        section: 'Dashboard',
        suite: activeSuite,
        schoolCode: selectedSchoolCode,
      },
    });
  }, [activeSuite, selectedSchoolCode]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (forceHome) {
      try {
        window.sessionStorage.removeItem(shellStorageKey);
        window.sessionStorage.removeItem(pendingHomeNavigateStorageKey);
        const url = new URL(window.location.href);
        if (url.searchParams.get('home') === '1') {
          url.searchParams.delete('home');
          const next = `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams.toString()}` : ''}${url.hash}`;
          window.history.replaceState(window.history.state, '', next);
        }
      } catch {
        // Ignore client storage errors.
      }
      return;
    }
    if (initialSuite) {
      const frameId = window.requestAnimationFrame(() => {
        activateSuite(initialSuite);
      });
      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }
    let restoredRequest: HomeNavigateRequest | null = null;
    try {
      const rawPendingNavigate = window.sessionStorage.getItem(pendingHomeNavigateStorageKey);
      if (rawPendingNavigate) {
        const parsed = JSON.parse(rawPendingNavigate) as HomeNavigateRequest;
        if (
          parsed &&
          parsed.requestId &&
          parsed.suite &&
          parsed.targetType &&
          parsed.targetValue &&
          Date.now() - parsed.requestId <= 60000
        ) {
          restoredRequest = parsed;
        }
      }
    } catch {
      // Ignore client storage errors.
    }
    if (!restoredRequest) return;
    const frameId = window.requestAnimationFrame(() => {
      if (restoredRequest) setHomeNavigateRequest(restoredRequest);
      activateSuite(restoredRequest.suite);
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [forceHome, initialSuite, shellStorageKey, pendingHomeNavigateStorageKey, activateSuite]);
  const handleHomeNavigate = (input: Omit<HomeNavigateRequest, 'requestId'>) => {
    const nextRequest: HomeNavigateRequest = {
      ...input,
      requestId: Date.now(),
    };
    appliedHomeNavigateSuiteRef.current = null;
    setHomeNavigateRequest(nextRequest);
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem(pendingHomeNavigateStorageKey, JSON.stringify(nextRequest));
      } catch {
        // Ignore client storage errors.
      }
    }
    activateSuite(input.suite);
  };
  useEffect(() => {
    if (!homeNavigateRequest) return;
    if (appliedHomeNavigateSuiteRef.current === homeNavigateRequest.requestId) return;
    if (activeSuite !== homeNavigateRequest.suite) return;
    appliedHomeNavigateSuiteRef.current = homeNavigateRequest.requestId;
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem(pendingHomeNavigateStorageKey);
      } catch {
        // Ignore client storage errors.
      }
    }
  }, [homeNavigateRequest, activeSuite, pendingHomeNavigateStorageKey]);

  useEffect(() => {
    if (activeSuite === 'Home') return;
    const cachedSchoolCode = String(navSearchPayload?.school_code ?? '').trim().toUpperCase();
    const selectedCode = String(selectedSchoolCode ?? '').trim().toUpperCase();
    if (cachedSchoolCode && cachedSchoolCode === selectedCode) return;
    let isMounted = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    fetchHomePayload(controller.signal)
      .then((payload) => {
        if (!isMounted) return;
        setNavSearchPayload(payload);
        setNavSearchError(null);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        if (error instanceof DOMException && error.name === 'AbortError') return;
        const message = error instanceof Error ? error.message : 'Failed to load search options.';
        setNavSearchError(message);
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
      });
    return () => {
      isMounted = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeSuite, navSearchPayload?.school_code, selectedSchoolCode]);
  const navMatchingCandidates = useMemo(() => {
    const source = navSearchPayload?.candidates ?? [];
    const needle = navSearchQuery.trim().toLowerCase();
    if (!needle) return [];
    return source.filter(
      (candidate) =>
        candidate.value.toLowerCase().includes(needle) ||
        toFirstLast(candidate.value).toLowerCase().includes(needle)
    );
  }, [navSearchPayload?.candidates, navSearchQuery]);
  const navCandidateGroups = useMemo(() => {
    const players = navMatchingCandidates.filter((candidate) => candidate.type === 'player').slice(0, 8);
    const teams = navMatchingCandidates.filter((candidate) => candidate.type === 'team').slice(0, 8);
    return [
      { key: 'players', label: 'Players', candidates: players },
      { key: 'teams', label: 'Teams', candidates: teams },
    ].filter((group) => group.candidates.length > 0);
  }, [navMatchingCandidates]);
  const navigateFromNavCandidate = (candidate: Candidate) => {
    const dateWindow = navSearchPayload?.date_window;
    if (!dateWindow) return;
    setNavSearchInput(toFirstLast(candidate.value));
    setNavSearchQuery('');
    handleHomeNavigate({
      suite: candidate.suite,
      targetType: candidate.type,
      targetValue: candidate.value,
      startDate: dateWindow.startDate,
      endDate: dateWindow.endDate,
      navigationSource: 'search',
    });
  };
  const submitNavSearch = () => {
    const parsed = resolveTypedCandidate(navSearchInput, navMatchingCandidates);
    if (parsed) {
      navigateFromNavCandidate(parsed);
      return;
    }
    if (navMatchingCandidates.length > 0) {
      navigateFromNavCandidate(navMatchingCandidates[0]);
      return;
    }
    setNavSearchError('No matching player or team found.');
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div className="portal-dashboard-suite-select-wrap">
        {activeSuite !== 'Home' ? (
          <>
            <label className="portal-nav-mobile-label" htmlFor="dashboard-suite-select">
              Dashboard Suite
            </label>
            <select
              id="dashboard-suite-select"
              className="portal-nav-mobile"
              value={activeSuite}
              onChange={(event) => activateSuite(event.target.value as SuiteName)}
            >
              {suiteOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      {activeSuite !== 'Home' ? (
        <div className="portal-dashboard-suite-tabs">
          <div className="portal-dashboard-suite-tabs-search">
            <input
              className="portal-search"
              placeholder="Search player or team"
              value={navSearchInput}
              onChange={(event) => {
                setNavSearchInput(event.target.value);
                setNavSearchQuery(event.target.value);
                if (navSearchError) setNavSearchError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== 'Enter') return;
                event.preventDefault();
                submitNavSearch();
              }}
              style={{
                width: 280,
                padding: '8px 10px',
                fontSize: 14,
                borderRadius: 10,
                border: navSearchBorder,
                background: navSearchBackground,
                color: '#f8fafc',
              }}
            />
            {navCandidateGroups.length > 0 ? (
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 'calc(100% + 6px)',
                  zIndex: 40,
                  display: 'grid',
                  gap: 4,
                  maxHeight: 280,
                  overflowY: 'auto',
                  padding: 6,
                  borderRadius: 10,
                  border: navSearchDropdownBorder,
                  background: navSearchDropdownBackground,
                }}
              >
                {navCandidateGroups.map((group) => (
                  <div key={`nav-candidate-group-${group.key}`} style={{ display: 'grid', gap: 4 }}>
                    <div
                      style={{
                        padding: '4px 8px 2px',
                        fontSize: 11,
                        fontWeight: 800,
                        letterSpacing: '0.08em',
                        textTransform: 'uppercase',
                        color: 'rgba(226, 232, 240, 0.64)',
                      }}
                    >
                      {group.label}
                    </div>
                    {group.candidates.map((candidate) => {
                      const logoUrl = resolveCandidateLogoUrl(isPro, candidate);
                      const labelParts = candidateSearchLabelParts(isPro, candidate);
                      return (
                        <button
                          key={`nav-candidate-${candidate.type}-${candidate.value}-${candidate.suite}`}
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => navigateFromNavCandidate(candidate)}
                          style={{ textAlign: 'left', justifyContent: 'space-between', width: '100%', gap: 10 }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                            {logoUrl ? (
                              <img
                                src={logoUrl}
                                alt={candidate.type === 'team' ? candidate.value : (candidate.team_code ?? '')}
                                style={{ width: 16, height: 16, objectFit: 'contain', flex: '0 0 auto' }}
                              />
                            ) : null}
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {labelParts.primary}
                              {labelParts.team ? (
                                <span style={{ color: 'rgba(var(--portal-accent-rgb, 200, 16, 46), 0.88)' }}>
                                  {` (${labelParts.team})`}
                                </span>
                              ) : null}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="portal-dashboard-suite-tabs-center">
            {suiteOptions.map((name) => (
              <button
                key={name}
                type="button"
                className={activeSuite === name ? 'btn btn-primary' : 'btn btn-ghost'}
                onClick={() => activateSuite(name)}
                style={activeSuite === name ? activeSuiteButtonStyle : undefined}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      {activeSuite !== 'Home' && navSearchError ? <p className="auth-error" style={{ margin: 0 }}>{navSearchError}</p> : null}
      {mountedSuites.Home ? (
        <div style={{ display: showSuite('Home') ? 'block' : 'none' }}>
          <div className="portal-desktop-dashboard-home">
            <HomeSuite
              role={role}
              selectedSchoolCode={selectedSchoolCode}
              activeSuite={activeSuite}
              suiteOptions={suiteOptions}
              onOpenSuite={activateSuite}
              onNavigate={handleHomeNavigate}
            />
          </div>
          <MobileDashboardHome suiteOptions={suiteOptions} onOpenSuite={activateSuite} />
        </div>
      ) : null}
      {mountedSuites.Pitching ? (
        <div style={{ display: showSuite('Pitching') ? 'block' : 'none' }}>
          <PitchingSuite role={role} selectedSchoolCode={selectedSchoolCode} homeNavigateRequest={homeNavigateRequest} />
        </div>
      ) : null}
      {mountedSuites.Hitting ? <div style={{ display: showSuite('Hitting') ? 'block' : 'none' }}><HittingSuite role={role} selectedSchoolCode={selectedSchoolCode} homeNavigateRequest={homeNavigateRequest} /></div> : null}
      {!isPro && mountedSuites.Catching ? <div style={{ display: showSuite('Catching') ? 'block' : 'none' }}><CatchingSuite /></div> : null}
      {mountedSuites['Custom Reports'] ? (
        <div style={{ display: showSuite('Custom Reports') ? 'block' : 'none' }}>
          <CustomReportsSuite initialSchoolCode={selectedSchoolCode} />
        </div>
      ) : null}
      {mountedSuites['Comparison Tool'] ? (
        <div style={{ display: showSuite('Comparison Tool') ? 'block' : 'none' }}>
          <ComparisonToolSuite />
        </div>
      ) : null}
      {mountedSuites.Biomechanics ? (
        <div style={{ display: showSuite('Biomechanics') ? 'block' : 'none' }}>
          <BiomechanicsHub role={role} schoolCode={selectedSchoolCode} isActive={showSuite('Biomechanics')} />
        </div>
      ) : null}
      {!isLeague && mountedSuites['Player Plans'] ? (
        <div style={{ display: showSuite('Player Plans') ? 'block' : 'none' }}>
          <PlayerPlansSuite selectedSchoolCode={selectedSchoolCode} />
        </div>
      ) : null}
      {!isLeague && mountedSuites['Stuff+ Calculator'] ? (
        <div style={{ display: showSuite('Stuff+ Calculator') ? 'block' : 'none' }}>
          <StuffCalculatorSuite />
        </div>
      ) : null}
    </div>
  );
}
