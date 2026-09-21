'use client';

import dynamic from 'next/dynamic';
import Image from 'next/image';
import { useState } from 'react';
import type { ValdSnapshot } from '../../../lib/vald-forceplates';
import type { OvrSprintResult, OvrSprintUpload, OvrVbtResult } from '../../../lib/ovr-sprint';
import ForcePlatesDashboard from './force-plates-dashboard';
import forcePlateStyles from './force-plates-dashboard.module.css';
import tabStyles from '../ovr-sprint/ovr-sprint.module.css';

const OvrSprintDashboard = dynamic(() => import('../ovr-sprint/ovr-sprint-dashboard'), { loading: () => <LoadingPanel /> });
const OvrVbtDashboard = dynamic(() => import('../ovr-sprint/ovr-vbt-dashboard'), { loading: () => <LoadingPanel /> });
const BiomechanicsHub = dynamic(() => import('../dashboard/biomechanics-hub'), { loading: () => <LoadingPanel /> });
const UniversalViewChart = dynamic(() => import('./universal-view-chart'), { loading: () => <LoadingPanel /> });

type DataTab = 'vald' | 'sprint' | 'vbt' | 'biomechanics' | 'chart' | 'imports';

type Props = {
  snapshot: ValdSnapshot | null;
  valdError: string;
  lastSyncLabel: string;
  canManageViews: boolean;
  canImport: boolean;
  showOvr: boolean;
  role: 'admin' | 'coach' | 'player';
  schoolCode: string;
  initialTab?: DataTab;
  availableTestTypes?: string[];
  focusedPlayerName?: string;
  embedded?: boolean;
};

function LoadingPanel() {
  return <div className={tabStyles.loadingPanel}>Loading data…</div>;
}

function samePlayer(left: string, right: string) {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalize(left) === normalize(right);
}

export default function ValdOvrDataDashboard({ snapshot, valdError, lastSyncLabel, canManageViews, canImport, showOvr, role, schoolCode, initialTab = 'vald', availableTestTypes = [], focusedPlayerName = '', embedded = false }: Props) {
  const [tab, setTab] = useState<DataTab>(initialTab);
  const [sprintResults, setSprintResults] = useState<OvrSprintResult[]>([]);
  const [vbtResults, setVbtResults] = useState<OvrVbtResult[]>([]);
  const [uploads, setUploads] = useState<OvrSprintUpload[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dataVersion, setDataVersion] = useState(0);
  const brand = tab === 'vald'
    ? { src: '/vald.webp', alt: 'VALD', fit: 'cover' as const, position: 'center', scale: 2.8 }
    : tab === 'biomechanics'
      ? { src: '/axioforce.jpeg', alt: 'AxioForce', fit: 'contain' as const, position: 'right center', scale: 1 }
      : tab === 'chart'
        ? { src: '/pearl-lockup-transparent.png', alt: 'Pearl', fit: 'contain' as const, position: 'right center', scale: 1 }
      : { src: '/ovr.png', alt: 'OVR', fit: 'contain' as const, position: 'right center', scale: 1 };

  async function selectTab(next: DataTab) {
    setTab(next);
    if (embedded) window.scrollTo({ top: 0, behavior: 'instant' });
    const url = new URL(window.location.href);
    if (next === 'vald') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (next === 'vald' || next === 'biomechanics' || next === 'chart') return;
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/ovr-sprint', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load OVR data.');
      const nextSprintResults = Array.isArray(payload.results) ? payload.results : [];
      const nextVbtResults = Array.isArray(payload.vbtResults) ? payload.vbtResults : [];
      setSprintResults(focusedPlayerName ? nextSprintResults.filter((row: OvrSprintResult) => samePlayer(row.athleteName, focusedPlayerName)) : nextSprintResults);
      setVbtResults(focusedPlayerName ? nextVbtResults.filter((row: OvrVbtResult) => samePlayer(row.athleteName, focusedPlayerName)) : nextVbtResults);
      setUploads(Array.isArray(payload.uploads) ? payload.uploads : []);
      setDataVersion((version) => version + 1);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load OVR data.');
    } finally {
      setLoading(false);
    }
  }

  return <>
    {!embedded ? <div className={`portal-admin-headline ${forcePlateStyles.pageHeadline}`}>
      <div className={forcePlateStyles.pageTitleGroup}>
        <h2 style={{ margin: 0 }}>{showOvr ? 'Biomechanics and Performance Data' : 'VALD Force Plate Data'}</h2>
      </div>
      <div className={forcePlateStyles.valdLogo}>
        <Image
          key={brand.src}
          src={brand.src}
          alt={brand.alt}
          fill
          sizes="220px"
          style={{
            objectFit: brand.fit,
            objectPosition: brand.position,
            transform: `scale(${brand.scale})`,
            clipPath: tab === 'biomechanics' ? 'inset(0 2px)' : undefined,
          }}
          priority={tab === initialTab}
        />
      </div>
    </div> : null}
    {showOvr ? <div className={`${tabStyles.dataTabs} ${embedded ? tabStyles.embeddedTabs : ''}`} role="tablist" aria-label="Biomechanics and performance data type">
      <button type="button" className={tab === 'vald' ? tabStyles.active : ''} onClick={() => selectTab('vald')}>VALD Force Plates</button>
      <button type="button" className={tab === 'sprint' ? tabStyles.active : ''} onClick={() => selectTab('sprint')}>Sprint</button>
      <button type="button" className={tab === 'vbt' ? tabStyles.active : ''} onClick={() => selectTab('vbt')}>VBT</button>
      <button type="button" className={tab === 'biomechanics' ? tabStyles.active : ''} onClick={() => selectTab('biomechanics')}>Biomechanics</button>
      <button type="button" className={tab === 'chart' ? tabStyles.active : ''} onClick={() => selectTab('chart')}>View Chart</button>
      {canImport && !focusedPlayerName ? <button type="button" className={tab === 'imports' ? tabStyles.active : ''} onClick={() => selectTab('imports')}>Imports</button> : null}
    </div> : null}

    {tab === 'vald' ? <>
      {valdError ? <article className="portal-admin-card"><p className="auth-error" style={{ margin: 0 }}>{valdError}</p></article> : null}
      {snapshot ? <ForcePlatesDashboard snapshot={snapshot} canManageViews={canManageViews && !focusedPlayerName} availableTestTypes={availableTestTypes} /> : null}
      {snapshot ? <article className="portal-admin-card"><p className="portal-muted-text" style={{ margin: 0 }}>Last sync: {lastSyncLabel}</p></article> : null}
    </> : null}

    {tab === 'biomechanics' ? <BiomechanicsHub role={role} schoolCode={schoolCode} isActive fixedPlayerName={focusedPlayerName || undefined} /> : null}
    {tab === 'chart' ? <UniversalViewChart schoolCode={schoolCode} fixedPlayerName={focusedPlayerName || undefined} /> : null}

    {tab !== 'vald' && tab !== 'biomechanics' && tab !== 'chart' && loading ? <LoadingPanel /> : null}
    {tab !== 'vald' && tab !== 'biomechanics' && tab !== 'chart' && !loading && loadError ? <article className="portal-admin-card"><p className="auth-error" style={{ margin: 0 }}>{loadError}</p></article> : null}
    {tab === 'sprint' && !loading && !loadError ? <OvrSprintDashboard key={`sprint-${dataVersion}`} initialResults={sprintResults} initialUploads={uploads} canImport={false} viewMode="sprint" playerOnly={role === 'player' || Boolean(focusedPlayerName)} /> : null}
    {tab === 'vbt' && !loading && !loadError ? <OvrVbtDashboard key={`vbt-${dataVersion}`} initialResults={vbtResults} playerOnly={role === 'player' || Boolean(focusedPlayerName)} /> : null}
    {tab === 'imports' && !loading && !loadError ? <OvrSprintDashboard key={`imports-${dataVersion}`} initialResults={sprintResults} initialUploads={uploads} canImport={canImport} viewMode="imports" /> : null}
  </>;
}
