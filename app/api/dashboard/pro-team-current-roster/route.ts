import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';

type Domain = 'Pitching' | 'Hitting' | 'Catching';

type TeamEntry = {
  id?: number;
  name?: string;
  teamName?: string;
  abbreviation?: string;
};

type RosterEntry = {
  person?: { fullName?: string };
  position?: { type?: string; abbreviation?: string; code?: string };
};

function normalizeTeamLabel(value: string): string {
  return String(value ?? '')
    .trim()
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function normalizeNameKey(value: string): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parseDomain(value: string): Domain {
  const raw = String(value ?? '').trim().toLowerCase();
  if (raw === 'pitching') return 'Pitching';
  if (raw === 'catching') return 'Catching';
  return 'Hitting';
}

async function findTeam(teamLabel: string): Promise<{ id: number; sportId: number } | null> {
  const normalized = normalizeTeamLabel(teamLabel);
  if (!normalized || normalized === 'all') return null;
  const sportIds = [1, 11]; // MLB, AAA
  for (const sportId of sportIds) {
    const url = new URL('https://statsapi.mlb.com/api/v1/teams');
    url.searchParams.set('sportId', String(sportId));
    const response = await fetch(url.toString(), { cache: 'no-store' });
    const payload = (await response.json().catch(() => ({}))) as { teams?: TeamEntry[] };
    const teams = Array.isArray(payload.teams) ? payload.teams : [];
    const exact = teams.find((team) => normalizeTeamLabel(team.name ?? team.teamName ?? '') === normalized);
    if (exact?.id) return { id: Number(exact.id), sportId };
  }
  return null;
}

async function fetchRosterNames(teamId: number, domain: Domain): Promise<string[]> {
  const minByDomain: Record<Domain, number> = {
    Pitching: 8,
    Hitting: 9,
    Catching: 1,
  };
  const fetchByType = async (rosterType: string): Promise<string[]> => {
    const rosterUrl = new URL(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster`);
    rosterUrl.searchParams.set('rosterType', rosterType);
    try {
      const response = await fetch(rosterUrl.toString(), { cache: 'no-store' });
      const payload = (await response.json().catch(() => ({}))) as { roster?: RosterEntry[] };
      const roster = Array.isArray(payload.roster) ? payload.roster : [];
      return filterRosterByDomain(roster, domain);
    } catch {
      return [];
    }
  };

  const active = await fetchByType('active');
  if (active.length >= (minByDomain[domain] ?? 1)) return active;

  const fullRoster = await fetchByType('fullRoster');
  const merged = Array.from(new Set([...active, ...fullRoster])).sort((a, b) => a.localeCompare(b));
  if (merged.length) return merged;
  return active;
}

function filterRosterByDomain(entries: RosterEntry[], domain: Domain): string[] {
  const out = new Set<string>();
  for (const entry of entries) {
    const fullName = String(entry.person?.fullName ?? '').trim();
    if (!fullName) continue;
    const positionType = String(entry.position?.type ?? '').trim().toLowerCase();
    const positionAbbr = String(entry.position?.abbreviation ?? entry.position?.code ?? '').trim().toUpperCase();
    const isPitcher =
      positionType === 'pitcher' ||
      positionAbbr === 'P' ||
      positionAbbr === 'SP' ||
      positionAbbr === 'RP' ||
      positionAbbr === 'CP';
    const isCatcher = positionType === 'catcher' || positionAbbr === 'C';
    const include =
      domain === 'Pitching'
        ? isPitcher
        : domain === 'Catching'
          ? isCatcher
          : !isPitcher;
    if (include) out.add(fullName);
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const team = String(url.searchParams.get('team') ?? '').trim();
  const domain = parseDomain(String(url.searchParams.get('domain') ?? 'Hitting'));
  if (!team || team.toLowerCase() === 'all') return NextResponse.json({ names: [] });

  try {
    const foundTeam = await findTeam(team);
    if (!foundTeam?.id) return NextResponse.json({ names: [] });
    const names = await fetchRosterNames(foundTeam.id, domain);
    const nameKeys = names.map((name) => normalizeNameKey(name));
    return NextResponse.json({ names, nameKeys });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load current team roster.' },
      { status: 502 }
    );
  }
}
