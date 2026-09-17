'use client';

import { useState } from 'react';
import type { OvrSprintResult, OvrSprintUpload, OvrVbtResult } from '../../../lib/ovr-sprint';
import OvrSprintDashboard from './ovr-sprint-dashboard';
import OvrVbtDashboard from './ovr-vbt-dashboard';
import styles from './ovr-sprint.module.css';

type Props = {
  initialResults: OvrSprintResult[];
  initialVbtResults: OvrVbtResult[];
  initialUploads: OvrSprintUpload[];
  canImport: boolean;
};

export default function OvrDataDashboard(props: Props) {
  const [dataTab, setDataTab] = useState<'sprint' | 'vbt' | 'imports'>('sprint');
  const [vbtResults, setVbtResults] = useState(props.initialVbtResults);
  const [loadingVbt, setLoadingVbt] = useState(false);
  async function openVbt() {
    setLoadingVbt(true);
    try {
      const response = await fetch('/api/ovr-sprint', { cache: 'no-store' });
      const payload = await response.json();
      if (response.ok && Array.isArray(payload.vbtResults)) setVbtResults(payload.vbtResults);
    } finally {
      setLoadingVbt(false);
      setDataTab('vbt');
    }
  }
  return <>
    <div className={styles.dataTabs} role="tablist" aria-label="OVR data type">
      <button type="button" className={dataTab === 'sprint' ? styles.active : ''} onClick={() => setDataTab('sprint')}>Sprint</button>
      <button type="button" className={dataTab === 'vbt' ? styles.active : ''} onClick={openVbt} disabled={loadingVbt}>{loadingVbt ? 'Loading…' : 'VBT'}</button>
      {props.canImport ? <button type="button" className={dataTab === 'imports' ? styles.active : ''} onClick={() => setDataTab('imports')}>Imports</button> : null}
    </div>
    {dataTab === 'sprint' ? <OvrSprintDashboard initialResults={props.initialResults} initialUploads={props.initialUploads} canImport={props.canImport} viewMode="sprint" /> : null}
    {dataTab === 'vbt' ? <OvrVbtDashboard initialResults={vbtResults} /> : null}
    {dataTab === 'imports' ? <OvrSprintDashboard initialResults={props.initialResults} initialUploads={props.initialUploads} canImport={props.canImport} viewMode="imports" /> : null}
  </>;
}
