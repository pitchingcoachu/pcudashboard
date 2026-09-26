import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from './auth-db';
import { listCalendarSessions, type CalendarSession, type SessionTypeValue } from './booking-db';

// One Google Calendar per organization (the owner's). Sessions are pushed one-way: one event per
// booked session time, marked "free" so they never block availability in Calendly or elsewhere.

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email'];
const TIME_ZONE = 'America/Phoenix';
// Regular/Bullpen slots are stored as a start time only; these are the event lengths shown on the calendar.
const DEFAULT_EVENT_MINUTES: Record<SessionTypeValue, number> = { regular: 60, bullpen: 30, assessment: 90 };

export function isGoogleCalendarConfigured(): boolean {
  return Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET);
}

// The dashboard is served from more than one domain; Google must send the admin back to the same
// domain they started on (their login cookie lives there), so the redirect is built from the request.
// Every domain in use must be listed as an authorized redirect URI on the Google OAuth client.
export function googleRedirectUri(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/api/integrations/google-calendar/callback`;
}

function secretKey(purpose: string): Buffer {
  const secret = String(process.env.AUTH_SECRET ?? '');
  if (!secret) throw new Error('AUTH_SECRET is required for Google Calendar.');
  return createHash('sha256').update(`${secret}:${purpose}`).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey('google-calendar-token'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('base64url')).join('.');
}

function decrypt(packed: string): string {
  const [iv, tag, data] = packed.split('.').map((part) => Buffer.from(part, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', secretKey('google-calendar-token'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/** Signed OAuth `state` binding the callback to the org + user that started the connection. */
export function createOAuthState(organizationId: number, userId: number): string {
  const body = Buffer.from(JSON.stringify({ o: organizationId, u: userId, t: Date.now() })).toString('base64url');
  const sig = createHmac('sha256', secretKey('google-calendar-state')).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyOAuthState(state: string): { organizationId: number; userId: number } | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secretKey('google-calendar-state')).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { o: number; u: number; t: number };
  if (Date.now() - parsed.t > 15 * 60 * 1000) return null;
  return { organizationId: parsed.o, userId: parsed.u };
}

export function buildGoogleAuthUrl(state: string, origin: string): string {
  const params = new URLSearchParams({
    client_id: String(process.env.GOOGLE_OAUTH_CLIENT_ID), redirect_uri: googleRedirectUri(origin), response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

let tablesReady = false;
async function ensureGoogleCalendarTables(): Promise<void> {
  if (tablesReady || !isDatabaseConfigured()) return;
  await ensureAuthDbReady();
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_calendar_connections (
      organization_id INTEGER PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      google_email TEXT NOT NULL DEFAULT '',
      refresh_token_enc TEXT NOT NULL,
      calendar_id TEXT NOT NULL DEFAULT 'primary',
      connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_synced_at TIMESTAMPTZ,
      last_error TEXT
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS google_calendar_event_links (
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      slot_id BIGINT NOT NULL,
      starts_at TIMESTAMPTZ NOT NULL,
      google_event_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, slot_id)
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_gcal_links_org_start ON google_calendar_event_links (organization_id, starts_at);`);
  tablesReady = true;
}

async function tokenRequest(params: Record<string, string>): Promise<{ access_token: string; refresh_token?: string; expires_in: number; id_token?: string }> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: String(process.env.GOOGLE_OAUTH_CLIENT_ID), client_secret: String(process.env.GOOGLE_OAUTH_CLIENT_SECRET), ...params }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Google token request failed: ${String(payload.error_description ?? payload.error ?? response.status)}`);
  return payload as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string };
}

function emailFromIdToken(idToken: string | undefined): string {
  if (!idToken) return '';
  try { return String(JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')).email ?? ''); } catch { return ''; }
}

export async function completeGoogleConnection(input: { organizationId: number; userId: number; code: string; origin: string }): Promise<string> {
  await ensureGoogleCalendarTables();
  const tokens = await tokenRequest({ grant_type: 'authorization_code', code: input.code, redirect_uri: googleRedirectUri(input.origin) });
  if (!tokens.refresh_token) throw new Error('Google did not return offline access. Remove the app from your Google account permissions and connect again.');
  const email = emailFromIdToken(tokens.id_token);
  await getDbPool().query(
    `INSERT INTO google_calendar_connections (organization_id,user_id,google_email,refresh_token_enc)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (organization_id) DO UPDATE SET user_id=EXCLUDED.user_id, google_email=EXCLUDED.google_email,
       refresh_token_enc=EXCLUDED.refresh_token_enc, connected_at=NOW(), last_error=NULL`,
    [input.organizationId, input.userId, email, encrypt(tokens.refresh_token)]
  );
  // A new account starts with a fresh set of events.
  await getDbPool().query(`DELETE FROM google_calendar_event_links WHERE organization_id=$1`, [input.organizationId]);
  accessTokenCache.delete(input.organizationId);
  return email;
}

export type GoogleCalendarStatus = { configured: boolean; connected: boolean; email: string; lastSyncedAt: string | null; lastError: string | null };

export async function getGoogleCalendarStatus(organizationId: number): Promise<GoogleCalendarStatus> {
  const configured = isGoogleCalendarConfigured();
  if (!isDatabaseConfigured()) return { configured, connected: false, email: '', lastSyncedAt: null, lastError: null };
  await ensureGoogleCalendarTables();
  const row = (await getDbPool().query(
    `SELECT google_email, last_synced_at, last_error FROM google_calendar_connections WHERE organization_id=$1`, [organizationId]
  )).rows[0];
  return {
    configured, connected: Boolean(row), email: row?.google_email ?? '',
    lastSyncedAt: row?.last_synced_at ? new Date(row.last_synced_at).toISOString() : null, lastError: row?.last_error ?? null,
  };
}

/** Disconnects and removes every event this integration created, so the calendar is left clean. */
export async function disconnectGoogleCalendar(organizationId: number): Promise<void> {
  await ensureGoogleCalendarTables();
  const connection = await loadConnection(organizationId);
  if (connection) {
    const links = await getDbPool().query(`SELECT google_event_id FROM google_calendar_event_links WHERE organization_id=$1`, [organizationId]);
    for (const link of links.rows) await deleteEvent(connection, String(link.google_event_id)).catch(() => {});
    const refreshToken = decrypt(connection.refreshTokenEnc);
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' }).catch(() => {});
  }
  await getDbPool().query(`DELETE FROM google_calendar_event_links WHERE organization_id=$1`, [organizationId]);
  await getDbPool().query(`DELETE FROM google_calendar_connections WHERE organization_id=$1`, [organizationId]);
  accessTokenCache.delete(organizationId);
}

type Connection = { organizationId: number; refreshTokenEnc: string; calendarId: string };

async function loadConnection(organizationId: number): Promise<Connection | null> {
  const row = (await getDbPool().query(
    `SELECT refresh_token_enc, calendar_id FROM google_calendar_connections WHERE organization_id=$1`, [organizationId]
  )).rows[0];
  return row ? { organizationId, refreshTokenEnc: row.refresh_token_enc, calendarId: row.calendar_id } : null;
}

const accessTokenCache = new Map<number, { token: string; expiresAt: number }>();

async function accessToken(connection: Connection): Promise<string> {
  const cached = accessTokenCache.get(connection.organizationId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(connection.refreshTokenEnc) });
  accessTokenCache.set(connection.organizationId, { token: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 });
  return tokens.access_token;
}

async function calendarFetch(connection: Connection, path: string, init: RequestInit = {}): Promise<Response> {
  const token = await accessToken(connection);
  return fetch(`${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(connection.calendarId)}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

async function deleteEvent(connection: Connection, eventId: string): Promise<void> {
  const response = await calendarFetch(connection, `/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404 && response.status !== 410) throw new Error(`Google delete failed (${response.status}).`);
}

function sessionLabel(type: SessionTypeValue): string {
  return type === 'bullpen' ? 'Bullpen' : type === 'assessment' ? 'Assessment' : 'Regular Training';
}

function eventBody(session: CalendarSession) {
  const start = new Date(session.startsAt);
  const storedEnd = new Date(session.endsAt);
  const end = storedEnd > start ? storedEnd : new Date(start.getTime() + DEFAULT_EVENT_MINUTES[session.sessionType] * 60_000);
  const names = session.attendees.map((person) => person.name);
  const summary = session.sessionType === 'assessment'
    ? `Assessment · ${names.join(', ')}`
    : `${sessionLabel(session.sessionType)} (${names.length}/${session.capacity}) · ${names.join(', ')}`;
  const lines = session.attendees.map((person) => {
    const contact = [person.email, person.phone].filter(Boolean).join(' · ');
    const via = person.source === 'calendly' ? ' (Calendly)' : '';
    return `• ${person.name}${via}${contact ? ` — ${contact}` : ''}`;
  });
  return {
    summary,
    description: `${lines.join('\n')}\n\nSynced from the PCU booking schedule.`,
    location: session.location || undefined,
    start: { dateTime: start.toISOString(), timeZone: TIME_ZONE },
    end: { dateTime: end.toISOString(), timeZone: TIME_ZONE },
    transparency: 'transparent',
    extendedProperties: { private: { pcuSlotId: String(session.slotId) } },
  };
}

/**
 * Reconciles Google Calendar with the booking schedule for [from, to): creates/updates one event per
 * booked session time and deletes events whose session no longer has anyone booked.
 */
export async function syncGoogleCalendarRange(organizationId: number, from: Date, to: Date): Promise<{ upserted: number; deleted: number } | null> {
  if (!isGoogleCalendarConfigured() || !isDatabaseConfigured()) return null;
  await ensureGoogleCalendarTables();
  const connection = await loadConnection(organizationId);
  if (!connection) return null;
  const pool = getDbPool();
  let upserted = 0, deleted = 0;
  try {
    const sessions = await listCalendarSessions({ organizationId, from: from.toISOString(), to: to.toISOString() });
    const links = await pool.query(
      `SELECT slot_id, google_event_id, content_hash FROM google_calendar_event_links
       WHERE organization_id=$1 AND ((starts_at >= $2 AND starts_at < $3) OR slot_id = ANY($4::bigint[]))`,
      [organizationId, from.toISOString(), to.toISOString(), sessions.map((session) => session.slotId)]
    );
    const linkBySlot = new Map(links.rows.map((row) => [Number(row.slot_id), { eventId: String(row.google_event_id), hash: String(row.content_hash) }]));
    const liveSlots = new Set<number>();
    for (const session of sessions) {
      liveSlots.add(session.slotId);
      const body = eventBody(session);
      const hash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
      const link = linkBySlot.get(session.slotId);
      if (link && link.hash === hash) continue;
      let eventId = link?.eventId ?? '';
      if (eventId) {
        const response = await calendarFetch(connection, `/events/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: JSON.stringify(body) });
        if (response.status === 404 || response.status === 410) eventId = '';
        else if (!response.ok) throw new Error(`Google update failed (${response.status}).`);
      }
      if (!eventId) {
        const response = await calendarFetch(connection, '/events', { method: 'POST', body: JSON.stringify(body) });
        if (!response.ok) throw new Error(`Google create failed (${response.status}).`);
        eventId = String(((await response.json()) as { id: string }).id);
      }
      await pool.query(
        `INSERT INTO google_calendar_event_links (organization_id,slot_id,starts_at,google_event_id,content_hash)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (organization_id,slot_id) DO UPDATE SET starts_at=EXCLUDED.starts_at, google_event_id=EXCLUDED.google_event_id,
           content_hash=EXCLUDED.content_hash, updated_at=NOW()`,
        [organizationId, session.slotId, session.startsAt, eventId, hash]
      );
      upserted += 1;
    }
    for (const [slotId, link] of linkBySlot) {
      if (liveSlots.has(slotId)) continue;
      await deleteEvent(connection, link.eventId);
      await pool.query(`DELETE FROM google_calendar_event_links WHERE organization_id=$1 AND slot_id=$2`, [organizationId, slotId]);
      deleted += 1;
    }
    await pool.query(`UPDATE google_calendar_connections SET last_synced_at=NOW(), last_error=NULL WHERE organization_id=$1`, [organizationId]);
    return { upserted, deleted };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Calendar sync failed.';
    await pool.query(`UPDATE google_calendar_connections SET last_error=$2 WHERE organization_id=$1`, [organizationId, message.slice(0, 500)]).catch(() => {});
    throw error;
  }
}

/** Syncs the Phoenix-local calendar day of each given instant (used right after a booking change). */
export async function syncGoogleCalendarForTimes(organizationId: number, instants: Array<string | null | undefined>): Promise<void> {
  const days = new Set(instants.filter((value): value is string => Boolean(value)).map((iso) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
  ));
  for (const day of days) {
    // Phoenix has no daylight saving time, so the day is always UTC-7.
    const from = new Date(`${day}T00:00:00-07:00`);
    await syncGoogleCalendarRange(organizationId, from, new Date(from.getTime() + 86_400_000)).catch((error) => {
      console.error('[google-calendar] sync failed', error);
    });
  }
}

export async function listGoogleCalendarOrganizations(): Promise<number[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureGoogleCalendarTables();
  const result = await getDbPool().query(`SELECT organization_id FROM google_calendar_connections`);
  return result.rows.map((row) => Number(row.organization_id));
}
