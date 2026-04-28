import { getPlayerForUser } from './training-db';

type SessionLike = {
  role?: 'admin' | 'coach' | 'player';
  organizationId?: number;
  userId?: number;
  name?: string;
};

type PlayerNameCacheEntry = {
  expiresAt: number;
  fullName: string | null;
};

const PLAYER_NAME_CACHE_TTL_MS = 60_000;
const PLAYER_NAME_CACHE_KEY = '__pcu_dashboard_player_name_cache_v1__';

function getPlayerNameCache(): Map<string, PlayerNameCacheEntry> {
  const globalRef = globalThis as typeof globalThis & {
    [PLAYER_NAME_CACHE_KEY]?: Map<string, PlayerNameCacheEntry>;
  };
  if (!globalRef[PLAYER_NAME_CACHE_KEY]) {
    globalRef[PLAYER_NAME_CACHE_KEY] = new Map<string, PlayerNameCacheEntry>();
  }
  return globalRef[PLAYER_NAME_CACHE_KEY]!;
}

export type DashboardDomain = 'Pitching' | 'Hitting' | 'Catching';

export type DashboardPlayerIdentity = {
  firstLast: string;
  lastFirst: string;
  candidates: string[];
  candidateKeys: Set<string>;
};

export function shouldScopeDashboardPlayer(role: string | null | undefined, schoolCode: string | null | undefined): boolean {
  const normalizedRole = String(role ?? '').trim().toLowerCase();
  if (normalizedRole !== 'player') return false;
  const school = String(schoolCode ?? '').trim().toUpperCase();
  return school !== 'PRO' && school !== 'LEAGUE';
}

function normalizeSpace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toFirstLast(value: string): string {
  const raw = normalizeSpace(String(value ?? ''));
  if (!raw) return '';
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',');
  const first = normalizeSpace(rest.join(' '));
  return normalizeSpace(`${first} ${last}`);
}

function toLastFirst(value: string): string {
  const firstLast = toFirstLast(value);
  if (!firstLast) return '';
  if (firstLast.includes(',')) return firstLast;
  const parts = firstLast.split(' ').filter(Boolean);
  if (parts.length < 2) return firstLast;
  const last = parts[parts.length - 1];
  const first = parts.slice(0, -1).join(' ');
  return `${last}, ${first}`;
}

function normalizeNameKey(value: string): string {
  return toFirstLast(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeSpace(value)).filter(Boolean)));
}

export async function resolveDashboardPlayerIdentity(session: SessionLike): Promise<DashboardPlayerIdentity | null> {
  if (session.role !== 'player') return null;
  const organizationId = session.organizationId ?? 0;
  const userId = session.userId ?? 0;
  if (organizationId <= 0 || userId <= 0) {
    const fallbackSeed = unique([session.name ?? '']);
    if (fallbackSeed.length === 0) return null;
    const names = unique(
      fallbackSeed.flatMap((value) => {
        const firstLast = toFirstLast(value);
        const lastFirst = toLastFirst(value);
        return [value, firstLast, lastFirst];
      })
    );
    const firstLast = toFirstLast(fallbackSeed[0]);
    const lastFirst = toLastFirst(fallbackSeed[0]);
    return {
      firstLast,
      lastFirst,
      candidates: names,
      candidateKeys: new Set(names.map((name) => normalizeNameKey(name)).filter(Boolean)),
    };
  }

  const cacheKey = `${organizationId}:${userId}`;
  const now = Date.now();
  const cache = getPlayerNameCache();
  let ownFullName: string | null = null;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    ownFullName = cached.fullName;
  } else {
    try {
      const own = await getPlayerForUser({ organizationId, userId });
      ownFullName = own?.fullName ?? null;
    } catch {
      ownFullName = null;
    }
    cache.set(cacheKey, {
      expiresAt: now + PLAYER_NAME_CACHE_TTL_MS,
      fullName: ownFullName,
    });
  }

  const seed = unique([ownFullName ?? '', session.name ?? '']);
  if (seed.length === 0) return null;

  const names = unique(
    seed.flatMap((value) => {
      const firstLast = toFirstLast(value);
      const lastFirst = toLastFirst(value);
      return [value, firstLast, lastFirst];
    })
  );
  const firstLast = toFirstLast(seed[0]);
  const lastFirst = toLastFirst(seed[0]);

  return {
    firstLast,
    lastFirst,
    candidates: names,
    candidateKeys: new Set(names.map((name) => normalizeNameKey(name)).filter(Boolean)),
  };
}

export function selectScopedPlayerName(options: unknown[], identity: DashboardPlayerIdentity): string | null {
  const names = options.map((value) => normalizeSpace(String(value ?? ''))).filter(Boolean);
  for (const option of names) {
    if (identity.candidateKeys.has(normalizeNameKey(option))) return option;
  }
  return null;
}

export function scopedPlayerQueryName(identity: DashboardPlayerIdentity, domain: DashboardDomain): string {
  if (domain === 'Hitting') return identity.firstLast || identity.lastFirst || identity.candidates[0] || '';
  return identity.lastFirst || identity.firstLast || identity.candidates[0] || '';
}
