'use client';

import { useEffect, useMemo, useState } from 'react';
import CatchingSuite from './catching-suite';
import ComparisonToolSuite from './comparison-tool-suite';
import CustomReportsSuite from './custom-reports-suite';
import HittingSuite from './hitting-suite';
import HomeSuite from './home-suite';
import PlayerNotesSuite from './player-notes-suite';
import PlayerPlansSuite from './player-plans-suite';
import PitchingSuite from './pitching-suite';
import { getProTeamLogoUrl, inferProTeamCode } from './pro-team-logos';
import StuffCalculatorSuite from './stuff-calculator-suite';

type DashboardShellProps = {
  role: 'admin' | 'coach' | 'player';
  selectedSchoolCode: string;
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
  | 'Player Plans'
  | 'Player Notes'
  | 'Stuff+ Calculator';

type HomeNavigateRequest = {
  requestId: number;
  suite: 'Pitching' | 'Hitting';
  targetType: 'player' | 'team';
  targetValue: string;
  startDate: string;
  endDate: string;
  page?: 'Summary' | 'Leaderboard';
  navigationSource?: 'search';
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

async function fetchHomePayload(): Promise<SearchPayload> {
  const response = await fetch('/api/dashboard/home/search', { cache: 'no-store' });
  const payload = (await response.json()) as SearchPayload & { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Failed to load dashboard search.');
  return payload;
}

export default function DashboardShell({ role, selectedSchoolCode }: DashboardShellProps) {
  const [suite, setSuite] = useState<SuiteName>('Home');
  const [homeNavigateRequest, setHomeNavigateRequest] = useState<HomeNavigateRequest | null>(null);
  const [navSearchPayload, setNavSearchPayload] = useState<SearchPayload | null>(null);
  const [navSearchInput, setNavSearchInput] = useState('');
  const [navSearchQuery, setNavSearchQuery] = useState('');
  const [navSearchError, setNavSearchError] = useState<string | null>(null);
  const [mountedSuites, setMountedSuites] = useState<Record<SuiteName, boolean>>({
    Home: true,
    Pitching: false,
    Hitting: false,
    Catching: false,
    'Custom Reports': false,
    'Comparison Tool': false,
    'Player Plans': false,
    'Player Notes': false,
    'Stuff+ Calculator': false,
  });
  const canAccessPlayerNotes = role === 'admin' || role === 'coach';
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
    if (!isLeague) base.push('Player Plans');
    if (!isLeague && canAccessPlayerNotes) base.push('Player Notes');
    if (!isLeague) base.push('Stuff+ Calculator');
    return base;
  }, [canAccessPlayerNotes, isLeague, isPro]);

  const activeSuite: SuiteName = suiteOptions.includes(suite) ? suite : 'Home';
  const showSuite = (name: SuiteName) => activeSuite === name;
  const activateSuite = (name: SuiteName) => {
    setSuite(name);
    setMountedSuites((current) => (current[name] ? current : { ...current, [name]: true }));
  };
  const handleHomeNavigate = (input: Omit<HomeNavigateRequest, 'requestId'>) => {
    const nextRequest: HomeNavigateRequest = {
      ...input,
      requestId: Date.now(),
    };
    setHomeNavigateRequest(nextRequest);
    activateSuite(input.suite);
  };
  useEffect(() => {
    let isMounted = true;
    fetchHomePayload()
      .then((payload) => {
        if (!isMounted) return;
        setNavSearchPayload(payload);
        setNavSearchError(null);
      })
      .catch((error: unknown) => {
        if (!isMounted) return;
        setNavSearchError(error instanceof Error ? error.message : 'Failed to load search options.');
      });
    return () => {
      isMounted = false;
    };
  }, [selectedSchoolCode]);
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
  const navFilteredCandidates = useMemo(() => navMatchingCandidates.slice(0, 8), [navMatchingCandidates]);
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
            {navFilteredCandidates.length > 0 ? (
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
                {navFilteredCandidates.map((candidate) => {
                  const logoUrl = resolveCandidateLogoUrl(isPro, candidate);
                  return (
                    <button
                      key={`nav-candidate-${candidate.type}-${candidate.value}-${candidate.suite}`}
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => navigateFromNavCandidate(candidate)}
                      style={{ textAlign: 'left', justifyContent: 'flex-start', width: '100%' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        {logoUrl ? (
                          <img
                            src={logoUrl}
                            alt={candidate.type === 'team' ? candidate.value : (candidate.team_code ?? '')}
                            style={{ width: 16, height: 16, objectFit: 'contain' }}
                          />
                        ) : null}
                        <span>{toFirstLast(candidate.value)}</span>
                      </span>
                    </button>
                  );
                })}
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
          <HomeSuite
            selectedSchoolCode={selectedSchoolCode}
            activeSuite={activeSuite}
            suiteOptions={suiteOptions}
            onOpenSuite={activateSuite}
            onNavigate={handleHomeNavigate}
          />
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
      {!isLeague && mountedSuites['Player Plans'] ? (
        <div style={{ display: showSuite('Player Plans') ? 'block' : 'none' }}>
          <PlayerPlansSuite />
        </div>
      ) : null}
      {!isLeague && canAccessPlayerNotes && mountedSuites['Player Notes'] ? (
        <div style={{ display: showSuite('Player Notes') ? 'block' : 'none' }}>
          <PlayerNotesSuite />
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
