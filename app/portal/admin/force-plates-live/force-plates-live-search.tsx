'use client';

import { useMemo, useState } from 'react';
import type { ValdSnapshot } from '../../../../lib/vald-forceplates';
import ForcePlatesDashboard from '../../force-plates/force-plates-dashboard';

type PlayerChoice = { id: number; name: string };

export default function ForcePlatesLiveSearch({ players }: { players: PlayerChoice[] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<PlayerChoice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<ValdSnapshot | null>(null);
  const [fetchedAtLabel, setFetchedAtLabel] = useState('');

  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return players.slice(0, 20);
    return players.filter((player) => player.name.toLowerCase().includes(normalized)).slice(0, 20);
  }, [players, query]);

  const runLookup = async (player: PlayerChoice) => {
    setSelected(player);
    setQuery(player.name);
    setOpen(false);
    setLoading(true);
    setError('');
    setSnapshot(null);
    try {
      const response = await fetch(`/api/admin/force-plates/live?playerId=${player.id}`, { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { snapshot?: ValdSnapshot; error?: string };
      if (!response.ok) throw new Error(String(payload.error ?? 'Failed to fetch ForceDecks data.'));
      if (!payload.snapshot) throw new Error('No data returned.');
      setSnapshot(payload.snapshot);
      setFetchedAtLabel(new Date().toLocaleTimeString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch ForceDecks data.');
    } finally {
      setLoading(false);
    }
  };

  const currentTestsCount = snapshot?.players?.[0]?.testsCount ?? 0;

  return (
    <div style={{ display: 'grid', gap: '1rem' }}>
      <div style={{ position: 'relative', maxWidth: 420 }}>
        <input
          type="text"
          value={query}
          placeholder="Search player by name..."
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (selected && event.target.value !== selected.name) setSelected(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          style={{
            width: '100%',
            padding: '0.6rem 0.75rem',
            borderRadius: 10,
            border: '1px solid var(--border, #333)',
            background: 'var(--input-bg, rgba(255,255,255,0.04))',
            color: 'var(--text-main, #fff)',
            fontSize: '0.95rem',
          }}
        />
        {open && matches.length > 0 ? (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 30,
              maxHeight: 280,
              overflowY: 'auto',
              border: '1px solid var(--border, #333)',
              borderRadius: 10,
              background: 'var(--panel-bg, #0a0a0a)',
              boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
            }}
          >
            {matches.map((player) => (
              <button
                key={player.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void runLookup(player)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.55rem 0.75rem',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--text-main, #fff)',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                }}
              >
                {player.name}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {loading ? <p className="portal-muted-text">Pulling live data from VALD...</p> : null}
      {error ? (
        <article className="portal-admin-card">
          <p className="auth-error" style={{ margin: 0 }}>
            {error}
          </p>
        </article>
      ) : null}

      {snapshot && !loading ? (
        currentTestsCount > 0 ? (
          <>
            <ForcePlatesDashboard snapshot={snapshot} />
            <p className="portal-muted-text" style={{ margin: 0 }}>
              Pulled live from VALD at {fetchedAtLabel}.
            </p>
          </>
        ) : (
          <article className="portal-admin-card">
            <p className="portal-muted-text" style={{ margin: 0 }}>
              No ForceDecks tests found for {selected?.name} in VALD.
            </p>
          </article>
        )
      ) : null}
    </div>
  );
}
