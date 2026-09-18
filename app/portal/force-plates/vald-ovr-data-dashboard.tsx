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

type DataTab = 'vald' | 'sprint' | 'vbt' | 'biomechanics' | 'imports';

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
};

function LoadingPanel() {
  return <div className={tabStyles.loadingPanel}>Loading data…</div>;
}

export default function ValdOvrDataDashboard({ snapshot, valdError, lastSyncLabel, canManageViews, canImport, showOvr, role, schoolCode, initialTab = 'vald', availableTestTypes = [] }: Props) {
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
      : { src: '/ovr.png', alt: 'OVR', fit: 'contain' as const, position: 'right center', scale: 1 };

  async function selectTab(next: DataTab) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'vald') url.searchParams.delete('tab');
    else url.searchParams.set('tab', next);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (next === 'vald' || next === 'biomechanics') return;
    setLoading(true);
    setLoadError('');
    try {
      const response = await fetch('/api/ovr-sprint', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? 'Unable to load OVR data.');
      setSprintResults(Array.isArray(payload.results) ? payload.results : []);
      setVbtResults(Array.isArray(payload.vbtResults) ? payload.vbtResults : []);
      setUploads(Array.isArray(payload.uploads) ? payload.uploads : []);
      setDataVersion((version) => version + 1);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unable to load OVR data.');
    } finally {
      setLoading(false);
    }
  }

  return <>
    <div className={`portal-admin-headline ${forcePlateStyles.pageHeadline}`}>
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
    </div>
    {showOvr ? <div className={tabStyles.dataTabs} role="tablist" aria-label="Biomechanics and performance data type">
      <button type="button" className={tab === 'vald' ? tabStyles.active : ''} onClick={() => selectTab('vald')}>VALD Force Plates</button>
      <button type="button" className={tab === 'sprint' ? tabStyles.active : ''} onClick={() => selectTab('sprint')}>Sprint</button>
      <button type="button" className={tab === 'vbt' ? tabStyles.active : ''} onClick={() => selectTab('vbt')}>VBT</button>
      <button type="button" className={tab === 'biomechanics' ? tabStyles.active : ''} onClick={() => selectTab('biomechanics')}>Biomechanics</button>
      {canImport ? <button type="button" className={tab === 'imports' ? tabStyles.active : ''} onClick={() => selectTab('imports')}>Imports</button> : null}
    </div> : null}

    {tab === 'vald' ? <>
      {valdError ? <article className="portal-admin-card"><p className="auth-error" style={{ margin: 0 }}>{valdError}</p></article> : null}
      {snapshot ? <ForcePlatesDashboard snapshot={snapshot} canManageViews={canManageViews} availableTestTypes={availableTestTypes} /> : null}
      {snapshot ? <article className="portal-admin-card"><p className="portal-muted-text" style={{ margin: 0 }}>Last sync: {lastSyncLabel}</p></article> : null}
    </> : null}

    {tab === 'biomechanics' ? <BiomechanicsHub role={role} schoolCode={schoolCode} isActive /> : null}

    {tab !== 'vald' && tab !== 'biomechanics' && loading ? <LoadingPanel /> : null}
    {tab !== 'vald' && tab !== 'biomechanics' && !loading && loadError ? <article className="portal-admin-card"><p className="auth-error" style={{ margin: 0 }}>{loadError}</p></article> : null}
    {tab === 'sprint' && !loading && !loadError ? <OvrSprintDashboard key={`sprint-${dataVersion}`} initialResults={sprintResults} initialUploads={uploads} canImport={canImport} viewMode="sprint" playerOnly={role === 'player'} /> : null}
    {tab === 'vbt' && !loading && !loadError ? <OvrVbtDashboard key={`vbt-${dataVersion}`} initialResults={vbtResults} playerOnly={role === 'player'} /> : null}
    {tab === 'imports' && !loading && !loadError ? <OvrSprintDashboard key={`imports-${dataVersion}`} initialResults={sprintResults} initialUploads={uploads} canImport={canImport} viewMode="imports" /> : null}
  </>;
}
