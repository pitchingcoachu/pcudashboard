'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type PreviewAthleteSelectProps = {
  selectedPlayerId: number;
  players: Array<{ playerId: number; fullName: string }>;
  basePath: string;
  extraParams?: Record<string, string>;
};

export default function PreviewAthleteSelect({
  selectedPlayerId,
  players,
  basePath,
  extraParams = {},
}: PreviewAthleteSelectProps) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState(() => players.find((player) => player.playerId === selectedPlayerId)?.fullName ?? '');
  const [open, setOpen] = useState(false);

  const filteredPlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const sortedPlayers = [...players].sort((a, b) => a.fullName.localeCompare(b.fullName));
    if (!normalizedQuery) return sortedPlayers;
    return sortedPlayers.filter((player) => player.fullName.toLowerCase().includes(normalizedQuery));
  }, [players, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function goToPlayer(playerId: number) {
    const params = new URLSearchParams(extraParams);
    params.set('previewPlayerId', String(playerId));
    setOpen(false);
    router.push(`${basePath}?${params.toString()}`);
  }

  return (
    <div ref={wrapRef} className="portal-preview-form portal-player-search-picker">
      <label htmlFor="portal-player-profile-search">Player Profile</label>
      <div className="portal-player-search-combobox">
        <input
          id="portal-player-profile-search"
          type="search"
          value={query}
          placeholder="Search player profiles"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls="portal-player-profile-search-list"
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
        />
        {open ? (
          <div id="portal-player-profile-search-list" className="portal-player-search-list" role="listbox">
            {filteredPlayers.length > 0 ? (
              filteredPlayers.map((player) => {
                const selected = player.playerId === selectedPlayerId;
                return (
                  <button
                    key={player.playerId}
                    type="button"
                    className={`portal-player-search-option${selected ? ' active' : ''}`}
                    role="option"
                    aria-selected={selected}
                    onClick={() => goToPlayer(player.playerId)}
                  >
                    <span>{player.fullName}</span>
                    {selected ? <small>Current</small> : null}
                  </button>
                );
              })
            ) : (
              <p className="portal-player-search-empty">No matching players.</p>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
