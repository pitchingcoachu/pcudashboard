'use client';
import { useEffect, useState } from 'react';

type Session = {
  id: number;
  title: string;
  sessionType: string;
  status: string;
  summaryBullets: string[];
  transcriptText: string;
  audioAvailable: boolean;
  createdAt: string;
};

export default function AiSessionsSection({ playerId }: { playerId: number }) {
  const [items, setItems] = useState<Session[]>([]);
  const [open, setOpen] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    const c = new AbortController();
    fetch(`/api/ai/sessions?playerId=${playerId}`, { cache: 'no-store', signal: c.signal })
      .then((r) => r.json())
      .then((p) => setItems(p.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
    return () => c.abort();
  }, [playerId]);

  return (
    <article className="portal-admin-card">
      <div className="portal-row-between" style={{ alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>AI Sessions</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className="portal-muted-text">{items.length} saved</span>
          <button type="button" className="btn btn-ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </div>
      {expanded ? (
        loading ? (
          <p className="portal-muted-text">Loading sessions…</p>
        ) : items.length === 0 ? (
          <p className="portal-muted-text">No AI session summaries have been shared here.</p>
        ) : (
          <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
            {items.map((item) => (
              <div key={item.id} className="portal-panel" style={{ padding: 12 }}>
                <button
                  type="button"
                  onClick={() => setOpen(open === item.id ? null : item.id)}
                  style={{ all: 'unset', cursor: 'pointer', display: 'grid', gap: 3, width: '100%' }}
                >
                  <strong>{item.title}</strong>
                  <span className="portal-muted-text">
                    {item.sessionType} · {new Date(item.createdAt).toLocaleDateString()}
                  </span>
                </button>
                {open === item.id ? (
                  <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
                    {item.audioAvailable ? (
                      <audio controls src={`/api/ai/sessions/${item.id}/audio`} style={{ width: '100%' }} />
                    ) : null}
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {item.summaryBullets.map((bullet, index) => (
                        <li key={index}>{bullet}</li>
                      ))}
                    </ul>
                    <details>
                      <summary>Full transcript</summary>
                      <p style={{ whiteSpace: 'pre-wrap' }}>{item.transcriptText}</p>
                    </details>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )
      ) : null}
    </article>
  );
}
