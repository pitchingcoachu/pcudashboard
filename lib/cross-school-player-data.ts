type CrossSchoolPlayerLink = {
  aliases: Set<string>;
  schoolCodes: Set<string>;
};

const LINKS: CrossSchoolPlayerLink[] = [
  {
    aliases: new Set(['tommypascanu', 'pascanutommy', 'thomaspascanu', 'pascanuthomas']),
    schoolCodes: new Set(['PCU', 'ARIZONA']),
  },
];

const SCHOOL_DISPLAY_ALIASES: Record<string, Record<string, string>> = {
  ARIZONA: {
    thomaspascanu: 'Pascanu, Tommy',
    pascanuthomas: 'Pascanu, Tommy',
  },
};

function normalizedNameKeys(value: string): Set<string> {
  const raw = String(value ?? '').trim();
  if (!raw) return new Set();
  const candidates = [raw];
  if (raw.includes(',')) {
    const parts = raw.split(',').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) candidates.push([...parts.slice(1), parts[0]].join(' '));
  } else {
    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) candidates.push([...parts.slice(1), parts[0]].join(' '));
  }
  return new Set(candidates.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')).filter(Boolean));
}

export function isCrossSchoolPlayerSelection(schoolCode: string, playerSelection: string): boolean {
  const school = String(schoolCode ?? '').trim().toUpperCase();
  // Dashboard multi-selects use semicolons because a single display name can
  // legitimately contain a comma ("Last, First").
  const selectedNames = String(playerSelection ?? '').split(';').map((name) => name.trim()).filter(Boolean);
  if (selectedNames.length !== 1) return false;
  const keys = normalizedNameKeys(selectedNames[0]);
  return LINKS.some(
    (link) => link.schoolCodes.has(school) && Array.from(keys).some((key) => link.aliases.has(key))
  );
}

export function canonicalDashboardPlayerName(schoolCode: string, value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw) return raw;
  const school = String(schoolCode ?? '').trim().toUpperCase();
  const key = Array.from(normalizedNameKeys(raw))[0] ?? '';
  return SCHOOL_DISPLAY_ALIASES[school]?.[key] ?? raw;
}

function canonicalizeNames(schoolCode: string, values: unknown[]): string[] {
  const byKey = new Map<string, string>();
  for (const value of values) {
    const canonical = canonicalDashboardPlayerName(schoolCode, String(value ?? ''));
    const key = Array.from(normalizedNameKeys(canonical))[0] ?? '';
    if (key && !byKey.has(key)) byKey.set(key, canonical);
  }
  return Array.from(byKey.values()).sort((a, b) => a.localeCompare(b));
}

export function canonicalizeDashboardFilterPlayers(input: {
  payload: Record<string, unknown>;
  schoolCode: string;
  playerField: 'hitters' | 'pitchers';
  mapField: 'hitters_by_team_code' | 'pitchers_by_team_code';
}): void {
  const players = input.payload[input.playerField];
  if (Array.isArray(players)) input.payload[input.playerField] = canonicalizeNames(input.schoolCode, players);

  const rawMap = input.payload[input.mapField];
  if (!rawMap || typeof rawMap !== 'object') return;
  input.payload[input.mapField] = Object.fromEntries(
    Object.entries(rawMap as Record<string, unknown>).map(([team, names]) => [
      team,
      Array.isArray(names) ? canonicalizeNames(input.schoolCode, names) : names,
    ])
  );
}
