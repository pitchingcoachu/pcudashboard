'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

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

function formatElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return minutes > 0 ? `${minutes}m ${secs}s` : `${secs}s`;
}

export default function TrackmanSyncButton() {
  const [configured, setConfigured] = useState(false);
  const [sync, setSync] = useState<TrackmanSyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const previousStatus = useRef<TrackmanSyncStatus['status'] | null>(null);

  async function load() {
    try {
      const response = await fetch('/api/dashboard/trackman-sync', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      const payload = (await response.json().catch(() => ({}))) as TrackmanSyncPayload;
      setConfigured(Boolean(payload.configured));
      const next = payload.sync ?? null;

      if (previousStatus.current === 'queued' && next && next.status !== 'queued') {
        setMessage(next.status === 'success' ? 'TrackMan sync complete.' : 'TrackMan sync failed — check with staff.');
      }
      previousStatus.current = next?.status ?? null;
      setSync(next);
    } catch {
      setConfigured(false);
      setSync(null);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Poll while a sync is actively running so the button reflects real
  // completion instead of guessing -- stops automatically once the
  // GitHub Actions workflow's callback flips status away from "queued".
  useEffect(() => {
    if (sync?.status !== 'queued') return;
    const interval = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(interval);
  }, [sync?.status]);

  useEffect(() => {
    const interval = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);

  const cooldownSeconds = useMemo(() => {
    if (!sync?.cooldownUntil) return 0;
    return Math.max(0, Math.ceil((new Date(sync.cooldownUntil).getTime() - clock) / 1000));
  }, [sync?.cooldownUntil, clock]);

  const elapsedSeconds = useMemo(() => {
    if (sync?.status !== 'queued' || !sync.lastRequestedAt) return 0;
    return Math.max(0, Math.floor((clock - new Date(sync.lastRequestedAt).getTime()) / 1000));
  }, [sync?.status, sync?.lastRequestedAt, clock]);

  if (!configured) return null;

  async function syncNewData() {
    if (syncing || cooldownSeconds > 0 || sync?.status === 'queued') return;
    setSyncing(true);
    setMessage(null);
    try {
      const response = await fetch('/api/dashboard/trackman-sync', { method: 'POST' });
      const payload = (await response.json().catch(() => ({}))) as TrackmanSyncPayload;
      if (payload.sync) {
        previousStatus.current = payload.sync.status;
        setSync(payload.sync);
      }
      if (!response.ok) {
        setMessage(payload.error || 'Unable to start the TrackMan sync.');
      } else {
        setMessage(null);
      }
    } catch {
      setMessage('Unable to start the TrackMan sync.');
    } finally {
      setSyncing(false);
      setClock(Date.now());
    }
  }

  const isRunning = sync?.status === 'queued';
  const disabled = syncing || isRunning || cooldownSeconds > 0;
  const label = isRunning
    ? `Syncing… ${formatElapsed(elapsedSeconds)}`
    : syncing
    ? 'Starting…'
    : cooldownSeconds > 0
    ? `Available in ${Math.ceil(cooldownSeconds / 60)} min`
    : 'Sync New Data';

  return (
    <div className="portal-trackman-sync">
      <button
        type="button"
        className={`portal-trackman-sync-btn${isRunning ? ' is-running' : ''}`}
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
      {isRunning ? <span className="portal-trackman-sync-note">Syncing… {formatElapsed(elapsedSeconds)}</span> : null}
      {message ? <span className="portal-trackman-sync-note">{message}</span> : null}
    </div>
  );
}
