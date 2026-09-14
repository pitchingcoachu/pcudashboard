'use client';

import { useEffect, useMemo, useState } from 'react';

type TrackmanSyncStatus = {
  lastRequestedAt: string | null;
  lastCompletedAt: string | null;
  status: 'idle' | 'queued' | 'success' | 'failed';
  cooldownUntil: string | null;
};

type TrackmanSyncPayload = {
  configured?: boolean;
  sync?: TrackmanSyncStatus | null;
  error?: string;
};

export default function TrackmanSyncButton() {
  const [configured, setConfigured] = useState(false);
  const [sync, setSync] = useState<TrackmanSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch('/api/dashboard/trackman-sync', { cache: 'no-store' });
        if (!response.ok) throw new Error();
        const payload = (await response.json().catch(() => ({}))) as TrackmanSyncPayload;
        if (!active) return;
        setConfigured(Boolean(payload.configured));
        setSync(payload.sync ?? null);
      } catch {
        if (!active) return;
        setConfigured(false);
        setSync(null);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const cooldownSeconds = useMemo(() => {
    if (!sync?.cooldownUntil) return 0;
    return Math.max(0, Math.ceil((new Date(sync.cooldownUntil).getTime() - clock) / 1000));
  }, [sync?.cooldownUntil, clock]);

  if (!configured) return null;

  async function syncNewData() {
    if (syncing || cooldownSeconds > 0) return;
    setSyncing(true);
    setMessage(null);
    try {
      const response = await fetch('/api/dashboard/trackman-sync', { method: 'POST' });
      const payload = (await response.json().catch(() => ({}))) as TrackmanSyncPayload;
      if (payload.sync) setSync(payload.sync);
      if (!response.ok) {
        setMessage(payload.error || 'Unable to start the TrackMan sync.');
      } else {
        setMessage('TrackMan sync started.');
      }
    } catch {
      setMessage('Unable to start the TrackMan sync.');
    } finally {
      setSyncing(false);
      setClock(Date.now());
    }
  }

  const disabled = syncing || cooldownSeconds > 0;
  const label = syncing
    ? 'Syncing…'
    : cooldownSeconds > 0
    ? `Available in ${Math.ceil(cooldownSeconds / 60)} min`
    : 'Sync New Data';

  return (
    <div className="portal-trackman-sync">
      <button
        type="button"
        className="portal-trackman-sync-btn"
        aria-label={`TrackMan sync: ${label}`}
        title={label}
        disabled={disabled}
        onClick={() => {
          void syncNewData();
        }}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z" />
        </svg>
      </button>
      {message ? <span className="portal-trackman-sync-note">{message}</span> : null}
    </div>
  );
}
