import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../lib/auth';

type PlayerMeta = {
  headshotUrl: string;
  pitchHand: '' | 'R' | 'L';
  batSide: '' | 'R' | 'L';
  mlbamId: number;
  canonicalName: string;
};

type StatsApiPerson = {
  id?: number;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  useName?: string;
  pitchHand?: { code?: string };
  batSide?: { code?: string };
};

function normalizeKey(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function normHand(value: unknown): '' | 'R' | 'L' {
  const v = String(value ?? '').trim().toUpperCase();
  if (v.startsWith('R')) return 'R';
  if (v.startsWith('L')) return 'L';
  return '';
}

function headshotUrlFromMlbamId(id: number): string {
  return `https://img.mlbstatic.com/mlb-photos/image/upload/w_213,q_100/v1/people/${id}/headshot/67/current`;
}

function parseNames(url: URL): string[] {
  const repeated = url.searchParams.getAll('name').map((entry) => entry.trim()).filter(Boolean);
  const single = (url.searchParams.get('names') ?? '')
    .split(/[;,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const merged = [...repeated, ...single];
  return Array.from(new Set(merged)).slice(0, 120);
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const names = parseNames(url);
  if (!names.length) return NextResponse.json({ items: {} });

  try {
    const searchUrl = new URL('https://statsapi.mlb.com/api/v1/people/search');
    searchUrl.searchParams.set('names', names.join(','));
    const response = await fetch(searchUrl.toString(), { cache: 'no-store' });
    const payload = (await response.json().catch(() => ({}))) as { people?: StatsApiPerson[] };
    const people = Array.isArray(payload.people) ? payload.people : [];

    const byNorm: Record<string, StatsApiPerson[]> = {};
    for (const person of people) {
      const keys = [
        person.fullName,
        [person.useName, person.lastName].filter(Boolean).join(' '),
        [person.firstName, person.lastName].filter(Boolean).join(' '),
      ]
        .map((entry) => normalizeKey(String(entry ?? '')))
        .filter(Boolean);
      for (const key of keys) {
        if (!byNorm[key]) byNorm[key] = [];
        byNorm[key].push(person);
      }
    }

    const items: Record<string, PlayerMeta> = {};
    for (const name of names) {
      const key = normalizeKey(name);
      const candidates = byNorm[key] ?? [];
      const pick = candidates[0];
      const id = Number(pick?.id ?? 0);
      if (!Number.isFinite(id) || id <= 0) continue;
      items[name] = {
        headshotUrl: headshotUrlFromMlbamId(id),
        pitchHand: normHand(pick?.pitchHand?.code),
        batSide: normHand(pick?.batSide?.code),
        mlbamId: id,
        canonicalName: String(pick?.fullName ?? name).trim() || name,
      };
    }

    return NextResponse.json({ items });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to resolve player metadata.' },
      { status: 502 }
    );
  }
}

