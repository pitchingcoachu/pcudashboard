// Client for TrackMan's Baseball Data API (dataapi.trackmanbaseball.com) --
// NOT the FTP CSV export, and NOT the gated B1 webhook push feed. This is a
// pull/poll model: request an OAuth token via client_credentials, discover
// practice sessions, then fetch that session's tracked balls on demand.
// Confirmed working against the official "TrackMan Baseball Data API Quick
// Start Guide for Customers" v2.6 spec and the org's existing TM_CLIENT_ID/
// TM_CLIENT_SECRET (already used in scripts/sync_trackman_media.py).

const TRACKMAN_LOGIN_URL = 'https://login.trackmanbaseball.com/connect/token';
const TRACKMAN_API_URL = 'https://dataapi.trackmanbaseball.com/api/v1';

export type TrackmanPracticeSession = {
  version: string;
  sessionId: string;
  externalSessionId?: string;
  gameDateUtc: string;
  gameDateLocal: string;
  sessionType: string;
};

export type TrackmanPitchLocation = {
  plateLocHeight?: number;
  plateLocSide?: number;
  zoneSpeed?: number;
  vertApprAngle?: number;
  horzApprAngle?: number;
  zoneTime?: number;
};

export type TrackmanPitchBall = {
  version: string;
  playId: string;
  trackType: 'Pitch';
  pitch: {
    pitchUID?: string;
    release?: {
      relSpeed?: number;
      spinRate?: number;
      extension?: number;
      [key: string]: unknown;
    };
    trajectory?: {
      vertBreak?: number;
      inducedVertBreak?: number;
      horzBreak?: number;
    };
    location?: TrackmanPitchLocation;
    [key: string]: unknown;
  };
};

export type TrackmanBall =
  | TrackmanPitchBall
  | { version: string; playId: string; trackType: 'Hit' | 'CatcherThrow'; [key: string]: unknown };

let cachedToken: { value: string; expiresAtMs: number } | null = null;

async function getAccessToken(): Promise<string> {
  const clientId = String(process.env.TM_CLIENT_ID ?? '').trim();
  const clientSecret = String(process.env.TM_CLIENT_SECRET ?? '').trim();
  if (!clientId || !clientSecret) {
    throw new Error('TM_CLIENT_ID / TM_CLIENT_SECRET are not configured.');
  }

  if (cachedToken && cachedToken.expiresAtMs > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const response = await fetch(TRACKMAN_LOGIN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`TrackMan token request failed: ${response.status} ${body}`);
  }
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  const token = String(json.access_token ?? '').trim();
  if (!token) throw new Error('TrackMan token response did not include access_token.');

  cachedToken = { value: token, expiresAtMs: Date.now() + Number(json.expires_in ?? 3600) * 1000 };
  return token;
}

async function trackmanFetch<T>(path: string, init?: RequestInit, retriesLeft = 2): Promise<T> {
  const token = await getAccessToken();
  const response = await fetch(`${TRACKMAN_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'text/plain',
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 429 && retriesLeft > 0) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return trackmanFetch<T>(path, init, retriesLeft - 1);
  }
  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('TrackMan is rate-limiting requests right now. Wait a moment and try again.');
    }
    const body = await response.text().catch(() => '');
    throw new Error(`TrackMan API request failed (${path}): ${response.status} ${body}`);
  }
  return response.json() as Promise<T>;
}

/** Practice sessions (bullpens, not games) discovered in a date range. Trackman
 * caps the range at 30 consecutive days. */
export async function discoverPracticeSessions(input: {
  startDate: string;
  endDate: string;
  sessionType?: 'All' | 'Pitching' | 'Hitting';
}): Promise<TrackmanPracticeSession[]> {
  const result = await trackmanFetch<TrackmanPracticeSession[]>('/discovery/practice/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify({
      sessionType: input.sessionType ?? 'All',
      utcDateFrom: `${input.startDate}T00:00:00Z`,
      utcDateTo: `${input.endDate}T23:59:59Z`,
    }),
  });
  return Array.isArray(result) ? result : [];
}

/** All balls (pitches, hits, catcher throws) tracked so far in a practice
 * session. Safe to call repeatedly while a session is still live -- TrackMan
 * returns whatever has been tracked up to the moment of the request. */
export async function getPracticeBalls(sessionId: string): Promise<TrackmanBall[]> {
  const result = await trackmanFetch<TrackmanBall[]>(`/data/practice/balls/${sessionId}`);
  return Array.isArray(result) ? result : [];
}

export type TrackmanPracticePlay = {
  version: string;
  playID: string;
  pitcher?: { pitcher?: string; pitcherId?: string; pitcherThrows?: string };
  pitchTag?: { taggedPitchType?: string };
};

/** Pitch-type tagging (as entered on the B1 iPad app) for a practice session
 * -- a separate endpoint from ball tracking data; join on playID (balls'
 * `playId` == plays' `playID` -- confirmed against the live API; the docs'
 * mention of a shared `pitchUID` does not hold for practice plays in
 * practice). Only pitches the tagger has actually tagged will appear here,
 * and only for "Pitching" session types (not "Hitting"). */
export async function getPracticePlays(sessionId: string): Promise<TrackmanPracticePlay[]> {
  const result = await trackmanFetch<TrackmanPracticePlay[]>(`/data/practice/plays/${sessionId}`);
  return Array.isArray(result) ? result : [];
}
