'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

export type ProfilesListRow = {
  playerId: number;
  fullName: string;
  goals: string[];
};

type ProfilesListProps = {
  players: ProfilesListRow[];
};

export default function ProfilesList({ players }: ProfilesListProps) {
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();

  const filteredPlayers = useMemo(() => {
    if (!normalizedQuery) return players;
    return players.filter((player) => {
      const haystack = `${player.fullName} ${player.goals.join(' ')}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, players]);

  const playerPlanHref = (playerId: number) => `/portal/dashboard?suite=player-plans&playerPlanPlayerId=${playerId}`;

  return (
    <section className="portal-panel">
      <div className="portal-row-between">
        <h2>Profiles</h2>
        <label className="portal-inline-filter" style={{ minWidth: 'min(320px, 100%)' }}>
          Search
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search players or goals"
          />
        </label>
      </div>

      <div className="portal-table-wrap">
        <table className="portal-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Goal 1</th>
              <th>Goal 2</th>
              <th>Goal 3</th>
            </tr>
          </thead>
          <tbody>
            {filteredPlayers.map((player) => (
              <tr key={player.playerId}>
                <td>
                  <Link href={`/portal/player?previewPlayerId=${player.playerId}`} className="portal-table-link">
                    {player.fullName}
                  </Link>
                </td>
                <td>
                  {player.goals[0] ? (
                    <Link href={playerPlanHref(player.playerId)} className="portal-table-link">
                      {player.goals[0]}
                    </Link>
                  ) : (
                    'None'
                  )}
                </td>
                <td>
                  {player.goals[1] ? (
                    <Link href={playerPlanHref(player.playerId)} className="portal-table-link">
                      {player.goals[1]}
                    </Link>
                  ) : (
                    'None'
                  )}
                </td>
                <td>
                  {player.goals[2] ? (
                    <Link href={playerPlanHref(player.playerId)} className="portal-table-link">
                      {player.goals[2]}
                    </Link>
                  ) : (
                    'None'
                  )}
                </td>
              </tr>
            ))}
            {filteredPlayers.length === 0 ? (
              <tr>
                <td colSpan={4} className="portal-muted-text">
                  No matching profiles.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
