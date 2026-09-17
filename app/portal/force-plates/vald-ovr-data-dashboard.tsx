'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import type { ValdSnapshot } from '../../../lib/vald-forceplates';
import type { OvrSprintResult, OvrSprintUpload, OvrVbtResult } from '../../../lib/ovr-sprint';
import ForcePlatesDashboard from './force-plates-dashboard';
import tabStyles from '../ovr-sprint/ovr-sprint.module.css';

const OvrSprintDashboard = dynamic(() => import('../ovr-sprint/ovr-sprint-dashboard'), { loading: () => <LoadingPanel /> });
const OvrVbtDashboard = dynamic(() => import('../ovr-sprint/ovr-vbt-dashboard'), { loading: () => <LoadingPanel /> });

type DataTab = 'vald' | 'sprint' | 'vbt' | 'imports';

type Props = {
  snapshot: ValdSnapshot | null;
  valdError: string;
  lastSyncLabel: string;
  canManageViews: boolean;
  canImport: boolean;
  showOvr: boolean;
  availableTestTypes?: string[];
};

function LoadingPanel() {
  return <div className={tabStyles.loadingPanel}>Loading data…</div>;
}

export default function ValdOvrDataDashboard({ snapshot, valdError, lastSyncLabel, canManageViews, canImport, showOvr, availableTestTypes = [] }: Props) {
  const [tab, setTab] = useState<DataTab>('vald');
  const [sprintResults, setSprintResults] = useState<OvrSprintResult[]>([]);
  const [vbtResults, setVbtResults] = useState<OvrVbtResult[]>([]);
  const [uploads, setUploads] = useState<OvrSprintUpload[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [dataVersion, setDataVersion] = useState(0);

  async function selectTab(next: DataTab) {
    setTab(next);
    if (next === 'vald') return;
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
    {showOvr ? <div className={tabStyles.dataTabs} role="tablist" aria-label="VALD and OVR data type">
      <button type="button" className={tab === 'vald' ? tabStyles.active : ''} onClick={() => selectTab('vald')}>VALD Force Plates</button>
      <button type="button" className={tab === 'sprint' ? tabStyles.active : ''} onClick={() => selectTab('sprint')}>Sprint</button>
      <button type="button" className={tab === 'vbt' ? tabStyles.active : ''} onClick={() => selectTab('vbt')}>VBT</button>
      {canImport ? <button type="button" className={tab === 'imports' ? tabStyles.active : ''} onClick={() => selectTab('imports')}>Imports</button> : null}
    </div> : null}

    {tab === 'vald' ? <>
      {valdError ? <article className="portal-admin-card"><p className="auth-error" style={{ margin: 0 }}>{valdError}</p></article> : null}
      {snapshot ? <ForcePlatesDashboard snapshot={snapshot} canManageViews={canManageViews} availableTestTypes={availableTestTypes} /> : null}
      {snapshot ? <article className="portal-admin-card"><p className="portal-muted-text" style={{ margin: 0 }}>Last sync: {lastSyncLabel}</p></article> : null}
    </> : null}

    {tab !== 'vald' && loading ? <LoadingPanel /> : null}
    {tab !== 'vald' && !loading && loadError ? <article className="portal-admin-card"><p className="auth-error" style={{ margin: 0 }}>{loadError}</p></article> : null}
    {tab === 'sprint' && !loading && !loadError ? <OvrSprintDashboard key={`sprint-${dataVersion}`} initialResults={sprintResults} initialUploads={uploads} canImport={canImport} viewMode="sprint" /> : null}
    {tab === 'vbt' && !loading && !loadError ? <OvrVbtDashboard key={`vbt-${dataVersion}`} initialResults={vbtResults} /> : null}
    {tab === 'imports' && !loading && !loadError ? <OvrSprintDashboard key={`imports-${dataVersion}`} initialResults={sprintResults} initialUploads={uploads} canImport={canImport} viewMode="imports" /> : null}
  </>;
}
