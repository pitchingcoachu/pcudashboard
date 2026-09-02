import { listClientsByOrganization, resolveOrganizationIdForSchool } from './training-db';

function normalizePlayerName(value: string): string {
  const raw = String(value ?? '').trim();
  const firstLast = raw.includes(',')
    ? `${raw.split(',').slice(1).join(' ').trim()} ${raw.split(',')[0].trim()}`.trim()
    : raw;
  return firstLast.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mergePlayerNames(values: string[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const name = String(value ?? '').trim();
    const key = normalizePlayerName(name);
    if (key && !byKey.has(key)) byKey.set(key, name);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}

export async function applyManagedRosterTeamScope(input: {
  payload: Record<string, unknown>;
  schoolCode: string;
  fallbackOrganizationId?: number | null;
  playerField: 'hitters' | 'pitchers';
  mapField: 'hitters_by_team_code' | 'pitchers_by_team_code';
}): Promise<void> {
  const schoolCode = String(input.schoolCode ?? '').trim().toUpperCase();
  if (!schoolCode || schoolCode === 'LEAGUE' || schoolCode === 'PRO') return;

  const organizationId = await resolveOrganizationIdForSchool({
    schoolCode,
    fallbackOrganizationId: Number(input.fallbackOrganizationId ?? 0) || 0,
    createIfMissing: false,
  }).catch(() => 0);
  if (!organizationId) return;

  const managedPlayers = await listClientsByOrganization(organizationId).catch(() => []);
  const managedNames = managedPlayers.map((player) => String(player.fullName ?? '').trim()).filter(Boolean);
  if (!managedNames.length) return;

  const managedKeys = new Set(managedNames.map(normalizePlayerName).filter(Boolean));
  const observedNames = Array.isArray(input.payload[input.playerField])
    ? (input.payload[input.playerField] as unknown[]).map((value) => String(value ?? '').trim()).filter(Boolean)
    : [];
  const teamNames = observedNames.filter((name) => managedKeys.has(normalizePlayerName(name)));
  const opponentNames = observedNames.filter((name) => !managedKeys.has(normalizePlayerName(name)));
  const teamMap = input.payload[input.mapField] && typeof input.payload[input.mapField] === 'object'
    ? { ...(input.payload[input.mapField] as Record<string, unknown>) }
    : {};

  // Keep All as every observed TrackMan player. The school bucket is driven
  // by Manage Players, while Opponents is the remaining observed data.
  teamMap[schoolCode] = mergePlayerNames([...teamNames, ...managedNames]);
  teamMap.Opponents = mergePlayerNames(opponentNames);
  input.payload[input.mapField] = teamMap;
}
