'use client';

import { useState } from 'react';

export default function SyncForcePlatesButton() {
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState('');

  const runSync = async () => {
    if (syncing) return;
    setSyncing(true);
    setNotice('');
    try {
      const response = await fetch('/api/admin/force-plates/sync?full=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(String(payload.error ?? 'Sync failed.'));
      setNotice('Synced. Reloading...');
      window.location.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Sync failed.');
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
      <button type="button" className="btn btn-primary" onClick={runSync} disabled={syncing}>
        {syncing ? 'Syncing...' : 'Sync Force Plates'}
      </button>
      {notice ? <span className="portal-muted-text">{notice}</span> : null}
    </div>
  );
}
