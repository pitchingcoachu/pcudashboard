'use client';

import { useEffect, useRef, useState } from 'react';

type VideoExportJobStatus = 'queued' | 'processing' | 'ready' | 'failed';

type VideoExportJobRow = {
  id: number;
  name: string;
  status: VideoExportJobStatus;
  errorMessage: string | null;
  fileSizeBytes: number | null;
  createdAt: string;
  completedAt: string | null;
};

const POLL_INTERVAL_MS = 12_000;

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1000 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function statusLabel(status: VideoExportJobStatus): string {
  if (status === 'queued') return 'Queued';
  if (status === 'processing') return 'Processing';
  if (status === 'ready') return 'Ready';
  return 'Failed';
}

export default function ExportsCard() {
  const [jobs, setJobs] = useState<VideoExportJobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch('/api/dashboard/video-exports', { cache: 'no-store' });
        const payload = (await response.json().catch(() => ({}))) as { jobs?: VideoExportJobRow[]; error?: string };
        if (cancelled) return;
        if (!response.ok) throw new Error(payload.error ?? 'Failed to load exports.');
        setJobs(payload.jobs ?? []);
        setError('');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load exports.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    pollTimer.current = setInterval(load, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const handleDelete = async (jobId: number) => {
    setDeletingId(jobId);
    try {
      await fetch(`/api/dashboard/video-exports?jobId=${jobId}`, { method: 'DELETE' });
      setJobs((current) => current.filter((job) => job.id !== jobId));
    } catch {
      // Leave the row in place; the user can retry.
    } finally {
      setDeletingId(null);
    }
  };

  const hasInProgress = jobs.some((job) => job.status === 'queued' || job.status === 'processing');

  return (
    <article className="portal-admin-card">
      <h2>Exports</h2>
      <p className="portal-muted-text" style={{ marginTop: 0 }}>
        Video exports render in the background — you can leave this page or close the tab, and they&apos;ll finish on
        their own. Come back here any time to download a finished export; it won&apos;t need to re-render.
      </p>

      {loading ? <p className="portal-muted-text">Loading exports...</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}
      {!loading && !error && jobs.length === 0 ? (
        <p className="portal-muted-text">No exports yet. Start one from a pitching video export dialog.</p>
      ) : null}

      {jobs.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '0.5rem' }}>
          {jobs.map((job) => (
            <div
              key={job.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '0.75rem',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: '8px',
                padding: '0.6rem 0.85rem',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.name}
                </div>
                <div className="portal-muted-text" style={{ fontSize: '0.8rem' }}>
                  {statusLabel(job.status)}
                  {job.status === 'ready' && job.fileSizeBytes ? ` · ${formatBytes(job.fileSizeBytes)}` : ''}
                  {' · '}
                  {formatTimestamp(job.createdAt)}
                  {job.status === 'failed' && job.errorMessage ? ` · ${job.errorMessage}` : ''}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                {job.status === 'ready' ? (
                  <a className="btn btn-primary" href={`/api/dashboard/video-exports/${job.id}/download`}>
                    Download
                  </a>
                ) : null}
                {job.status === 'queued' || job.status === 'processing' ? (
                  <span className="portal-muted-text" style={{ fontSize: '0.8rem' }}>
                    Rendering...
                  </span>
                ) : null}
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={deletingId === job.id}
                  onClick={() => void handleDelete(job.id)}
                >
                  {deletingId === job.id ? 'Removing...' : 'Remove'}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {hasInProgress ? (
        <p className="portal-muted-text" style={{ fontSize: '0.8rem', marginTop: '0.5rem' }}>
          Checking for updates every 12 seconds while an export is in progress.
        </p>
      ) : null}
    </article>
  );
}
