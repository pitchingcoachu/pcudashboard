import Link from 'next/link';

type RosterCardEntry = {
  playerId: number;
  fullName: string;
  email: string | null;
  assignedCoachName: string | null;
  status: string | null;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export default function PlayerRosterCards({ players }: { players: RosterCardEntry[] }) {
  return (
    <div className="portal-roster-cards">
      {players.map((player) => {
        const isInactive = String(player.status ?? '').trim().toLowerCase() === 'inactive';
        return (
          <Link key={player.playerId} href={`/portal/player?previewPlayerId=${player.playerId}`} className="portal-roster-card">
            <span className="portal-roster-card-avatar" aria-hidden="true">
              {initials(player.fullName)}
            </span>
            <span className="portal-roster-card-body">
              <span className="portal-roster-card-name">{player.fullName}</span>
              <span className="portal-roster-card-meta">{player.assignedCoachName ?? 'Unassigned'}</span>
            </span>
            <span className={`portal-roster-card-status${isInactive ? ' is-inactive' : ''}`}>
              {isInactive ? 'Inactive' : 'Active'}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
