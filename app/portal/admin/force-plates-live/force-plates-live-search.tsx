'use client';

import { useMemo, useState } from 'react';
import type { ValdSnapshot } from '../../../../lib/vald-forceplates';
import ForcePlatesDashboard from '../../force-plates/force-plates-dashboard';

type PlayerChoice = { id: number; name: string };
type Selection = { kind: 'player'; player: PlayerChoice } | { kind: 'all' };

export default function ForcePlatesLiveSearch({ players }: { players: PlayerChoice[] }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshot, setSnapshot] = useState<ValdSnapshot | null>(null);
  const [fetchedAtLabel, setFetchedAtLabel] = useState('');

  const matches = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return players.slice(0, 20);
    return players.filter((player) => player.name.toLowerCase().includes(normalized)).slice(0, 20);
  }, [players, query]);

  const runLookup = async (nextSelection: Selection) => {
    setSelection(nextSelection);
    setQuery(nextSelection.kind === 'player' ? nextSelection.player.name : 'All Players');
    setOpen(false);
    setLoading(true);
    setError('');
    setSnapshot(null);
    try {
      const requestUrl =
        nextSelection.kind === 'all'
          ? '/api/admin/force-plates/live?all=1'
          : `/api/admin/force-plates/live?playerId=${nextSelection.player.id}`;
      const response = await fetch(requestUrl, { cache: 'no-store' });
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

  const playersWithTests = snapshot?.players?.filter((p) => p.testsCount > 0) ?? [];
  const hasAnyData = playersWithTests.length > 0;

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
            if (selection && event.target.value !== (selection.kind === 'player' ? selection.player.name : 'All Players')) {
              setSelection(null);
            }
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
        {open ? (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 30,
              maxHeight: 320,
              overflowY: 'auto',
              border: '1px solid var(--border, #333)',
              borderRadius: 10,
              background: 'var(--panel-bg, #0a0a0a)',
              boxShadow: '0 12px 30px rgba(0,0,0,0.4)',
            }}
          >
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => void runLookup({ kind: 'all' })}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.55rem 0.75rem',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--border, #333)',
                color: 'var(--text-main, #fff)',
                cursor: 'pointer',
                fontSize: '0.9rem',
                fontWeight: 700,
              }}
            >
              All Players
            </button>
            {matches.map((player) => (
              <button
                key={player.id}
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void runLookup({ kind: 'player', player })}
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

      {loading ? (
        <p className="portal-muted-text">
          {selection?.kind === 'all' ? 'Pulling live data for every player from VALD...' : 'Pulling live data from VALD...'}
        </p>
      ) : null}
      {error ? (
        <article className="portal-admin-card">
          <p className="auth-error" style={{ margin: 0 }}>
            {error}
          </p>
        </article>
      ) : null}

      {snapshot && !loading ? (
        hasAnyData ? (
          <>
            <ForcePlatesDashboard snapshot={snapshot} />
            <p className="portal-muted-text" style={{ margin: 0 }}>
              {selection?.kind === 'all'
                ? `Pulled live from VALD at ${fetchedAtLabel} -- ${playersWithTests.length} of ${snapshot.players.length} players have recent tests. Trial-level detail is skipped in All Players mode to keep it fast; search one player for full rep detail.`
                : `Pulled live from VALD at ${fetchedAtLabel}.`}
            </p>
          </>
        ) : (
          <article className="portal-admin-card">
            <p className="portal-muted-text" style={{ margin: 0 }}>
              {selection?.kind === 'all'
                ? 'No ForceDecks tests found for any player in VALD in the last 30 days.'
                : `No ForceDecks tests found for ${selection?.kind === 'player' ? selection.player.name : ''} in VALD.`}
            </p>
          </article>
        )
      ) : null}
    </div>
  );
}
