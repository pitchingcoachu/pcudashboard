'use client';

import { useEffect, useState } from 'react';

type ProSearchResult = {
  id: number;
  fullName: string;
};

type ProLink = {
  playerId: number;
  proPlayerName: string;
  createdAt: string;
};

export default function PlayerProLinkPanel({
  playerId,
  playerName,
  canEdit,
}: {
  playerId: number;
  playerName: string;
  canEdit: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [link, setLink] = useState<ProLink | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/dashboard/player-pro-link?playerId=${playerId}`, { cache: 'no-store' })
      .then((res) => res.json())
      .then((payload: { link?: ProLink | null }) => {
        if (!cancelled) setLink(payload.link ?? null);
      })
      .catch(() => {
        if (!cancelled) setLink(null);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

  async function runSearch(term: string) {
    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (term.trim()) params.set('search', term.trim());
      else params.set('seedFromName', playerName);
      const response = await fetch(`/api/dashboard/player-pro-link?${params.toString()}`, { cache: 'no-store' });
      const payload = (await response.json()) as { results?: ProSearchResult[]; error?: string };
      setResults(payload.results ?? []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  async function saveLink(proPlayerName: string) {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/dashboard/player-pro-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId, proPlayerName }),
      });
      const payload = (await response.json()) as { link?: ProLink; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to save link.');
      setLink(payload.link ?? null);
      setResults([]);
      setQuery('');
      setMessage('PRO link saved.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to save link.');
    } finally {
      setSaving(false);
    }
  }

  async function removeLink() {
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch(`/api/dashboard/player-pro-link?playerId=${playerId}`, { method: 'DELETE' });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Failed to remove link.');
      setLink(null);
      setMessage('PRO link removed.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to remove link.');
    } finally {
      setSaving(false);
    }
  }

  // No link, no edit access -- nothing to show for a player-role viewer.
  if (link === undefined) return null;
  if (!canEdit && !link) return null;

  return (
    <article className="portal-admin-card">
      <div className="portal-row-between">
        <h3>PRO / MLB Link</h3>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setExpanded((current) => !current)}
          aria-expanded={expanded}
        >
          {expanded ? 'Collapse' : 'Expand'}
        </button>
      </div>
      {!expanded ? null : (
        <div className="portal-form-grid">
          {link ? (
            <>
              <p className="portal-muted-text" style={{ margin: 0 }}>
                Linked to <strong>{link.proPlayerName}</strong>. Their MLB pitch data will appear alongside this
                player&apos;s reports.
              </p>
              {canEdit ? (
                <div className="portal-choice-line-actions">
                  <button type="button" className="btn btn-ghost" onClick={removeLink} disabled={saving}>
                    {saving ? 'Removing...' : 'Remove Link'}
                  </button>
                </div>
              ) : null}
            </>
          ) : canEdit ? (
            <>
              <label>
                Search MLB players
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      runSearch(query);
                    }
                  }}
                  placeholder="e.g. Aaron Nola"
                />
              </label>
              <div className="portal-choice-line-actions">
                <button type="button" className="btn btn-ghost" onClick={() => runSearch(query)} disabled={searching}>
                  {searching ? 'Searching...' : 'Search'}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost as-link"
                  onClick={() => runSearch('')}
                  disabled={searching}
                >
                  Suggest match
                </button>
              </div>
              {results.length > 0 ? (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 4 }}>
                  {results.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        className="btn btn-ghost as-link"
                        onClick={() => saveLink(result.fullName)}
                        disabled={saving}
                      >
                        {result.fullName}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <p className="portal-muted-text" style={{ margin: 0 }}>No PRO link set for this player.</p>
          )}
          {message ? <p className={message.includes('saved') || message.includes('removed') ? 'auth-message' : 'auth-error'}>{message}</p> : null}
        </div>
      )}
    </article>
  );
}
