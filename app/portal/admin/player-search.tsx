'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type Player = { playerId: number; fullName: string };

function formatName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed.includes(',')) return trimmed;
  const [last, ...rest] = trimmed.split(',').map((p) => p.trim());
  const first = rest.join(' ').trim();
  return first && last ? `${first} ${last}` : trimmed;
}

export default function PlayerSearch() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/admin/clients', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { players?: Player[] }) => {
        if (Array.isArray(data.players)) setPlayers(data.players);
      })
      .catch(() => {});
  }, []);

  const filtered = query.trim()
    ? players
        .map((p) => ({ ...p, display: formatName(p.fullName) }))
        .filter((p) => p.display.toLowerCase().includes(query.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  function select(player: { playerId: number }) {
    setQuery('');
    setOpen(false);
    router.push(`/portal/player?previewPlayerId=${player.playerId}`);
  }

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', maxWidth: 420 }}>
      <div className="portal-form-grid" style={{ margin: 0 }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { setOpen(false); setQuery(''); }
            if (e.key === 'Enter' && filtered.length === 1) select(filtered[0]!);
          }}
          placeholder="Search player..."
        />
      </div>
      {open && filtered.length > 0 ? (
        <ul className="portal-search-select-menu" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 999, margin: 0, padding: '4px 0', listStyle: 'none' }}>
          {filtered.map((p) => (
            <li key={p.playerId}>
              <button
                type="button"
                className="portal-search-select-option"
                onMouseDown={(e) => { e.preventDefault(); select(p); }}
                style={{ width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer', fontSize: 14 }}
              >
                {p.display}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
