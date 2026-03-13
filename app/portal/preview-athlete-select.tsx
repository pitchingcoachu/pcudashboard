'use client';

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

  return (
    <div className="portal-preview-form">
      <label>
        Preview Athlete
        <select
          value={String(selectedPlayerId)}
          onChange={(event) => {
            const params = new URLSearchParams(extraParams);
            params.set('previewPlayerId', event.target.value);
            router.push(`${basePath}?${params.toString()}`);
          }}
        >
          {players.map((client) => (
            <option key={client.playerId} value={String(client.playerId)}>
              {client.fullName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
