import { createHmac, timingSafeEqual } from 'node:crypto';
import { getSessionUserByEmail, validateLoginWithDatabase } from './auth-db';

export const SESSION_COOKIE_NAME = 'pcu_session_v3';
export const DOMAIN_SESSION_COOKIE_NAME = 'pcu_session_v3_domain';
export const LEGACY_SESSION_COOKIE_NAMES = ['pcu_session_v2'] as const;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const DEFAULT_DASHBOARD_URL = 'https://pitchingcoachu.shinyapps.io/TMdata/';

type AppLink = {
  name: string;
  url: string;
};

type UserRecord = {
  email: string;
  password: string;
  appUrl?: string;
  apps?: Array<{
    name?: string;
    label?: string;
    url?: string;
  }>;
  name?: string;
};

type SessionPayload = {
  userId?: number;
  email: string;
  appUrl: string;
  apps: AppLink[];
  name?: string;
  role?: 'admin' | 'player';
  organizationId?: number;
  playerId?: number | null;
  exp: number;
};

type CookieStoreLike = {
  get(name: string): { value: string } | undefined;
};

function base64urlEncode(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function base64urlDecode(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function getAuthSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error('AUTH_SECRET must be set and at least 16 characters.');
  }
  return secret;
}

function getConfiguredUsers(): UserRecord[] {
  const rawJson = process.env.APP_USERS_JSON;
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as UserRecord[];
      return parsed.filter((u) => u.email && u.password && getConfiguredUserApps(u).length > 0);
    } catch {
      return [];
    }
  }

  const email = process.env.AUTH_LOGIN_EMAIL;
  const password = process.env.AUTH_LOGIN_PASSWORD;
  const appUrl = DEFAULT_DASHBOARD_URL;
  const name = process.env.AUTH_LOGIN_NAME;

  if (email && password && appUrl) {
    return [{ email, password, appUrl, name }];
  }

  return [];
}

function getConfiguredUserApps(user: UserRecord): AppLink[] {
  return [{ name: 'Dashboard', url: DEFAULT_DASHBOARD_URL }];
}

export function validateLogin(email: string, password: string): Omit<SessionPayload, 'exp'> | null {
  const normalized = email.trim().toLowerCase();
  const users = getConfiguredUsers();
  const match = users.find((u) => u.email.trim().toLowerCase() === normalized && u.password === password);
  if (!match) return null;
  const apps = getConfiguredUserApps(match);
  if (apps.length === 0) return null;

  return {
    email: match.email,
    appUrl: apps[0].url,
    apps,
    name: match.name,
  };
}

export async function validateLoginCredentials(
  email: string,
  password: string
): Promise<Omit<SessionPayload, 'exp'> | null> {
  const configured = getConfiguredUsers().find((u) => u.email.trim().toLowerCase() === email.trim().toLowerCase());
  const configuredApps = configured ? getConfiguredUserApps(configured) : [];

  try {
    const dbUser = await validateLoginWithDatabase(email, password);
    if (dbUser) {
      const apps = configuredApps.length > 0 ? configuredApps : [{ name: 'Dashboard', url: dbUser.appUrl }];

      return {
        ...dbUser,
        name: dbUser.name ?? configured?.name ?? undefined,
        appUrl: apps[0].url,
        apps,
      };
    }
  } catch {
    // If the DB is temporarily unavailable, allow env-configured users to log in.
  }

  const fallback = validateLogin(email, password);
  if (!fallback) return null;

  try {
    const dbUser = await getSessionUserByEmail(fallback.email);
    if (dbUser) {
      const apps = configuredApps.length > 0 ? configuredApps : [{ name: 'Dashboard', url: dbUser.appUrl }];
      return {
        ...dbUser,
        appUrl: apps[0].url,
        apps,
        name: dbUser.name ?? fallback.name,
      };
    }
  } catch {
    // Preserve fallback behavior if DB lookup fails.
  }

  return fallback;
}

export function createSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const secret = getAuthSecret();
  const complete: SessionPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };

  const encodedPayload = base64urlEncode(JSON.stringify(complete));
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const [encodedPayload, providedSignature] = token.split('.');
  if (!encodedPayload || !providedSignature) return null;

  const secret = getAuthSecret();
  const expectedSignature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');

  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (providedBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(base64urlDecode(encodedPayload)) as SessionPayload;
    if (!parsed.email || !parsed.appUrl || !parsed.exp) return null;
    const apps = Array.isArray(parsed.apps)
      ? parsed.apps
          .map((app) => ({
            name: app?.name?.trim() || 'Dashboard',
            url: app?.url?.trim() || '',
          }))
          .filter((app) => app.url.length > 0)
      : [{ name: 'Dashboard', url: parsed.appUrl }];
    if (apps.length === 0) return null;
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return {
    userId: parsed.userId,
    ...parsed,
    appUrl: parsed.appUrl,
    apps,
    role: parsed.role === 'player' ? 'player' : 'admin',
    organizationId: parsed.organizationId,
    playerId: parsed.playerId ?? null,
  };
  } catch {
    return null;
  }
}

export function getSessionFromCookies(cookieStore: CookieStoreLike): SessionPayload | null {
  const cookieNames = [SESSION_COOKIE_NAME, DOMAIN_SESSION_COOKIE_NAME, ...LEGACY_SESSION_COOKIE_NAMES];
  for (const cookieName of cookieNames) {
    const token = cookieStore.get(cookieName)?.value;
    if (!token) continue;
    const parsed = verifySessionToken(token);
    if (parsed) return parsed;
  }
  return null;
}

type SessionCookieOptions = {
  httpOnly: true;
  secure: boolean;
  sameSite: 'lax';
  path: '/';
  maxAge: number;
  domain?: string;
};

function resolveCookieDomain(hostname?: string): string | undefined {
  const configuredDomain = process.env.AUTH_COOKIE_DOMAIN?.trim();
  if (configuredDomain) {
    return configuredDomain.startsWith('.') ? configuredDomain : `.${configuredDomain}`;
  }

  // Production fallback for the known public domain.
  if (hostname && (hostname === 'pcudashboard.com' || hostname.endsWith('.pcudashboard.com'))) {
    return '.pcudashboard.com';
  }

  return undefined;
}

export function getSessionCookieOptions(): SessionCookieOptions {
  const options: {
    httpOnly: true;
    secure: boolean;
    sameSite: 'lax';
    path: '/';
    maxAge: number;
    domain?: string;
  } = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  };

  return options;
}

export function getDomainSessionCookieOptions(hostname?: string): SessionCookieOptions | null {
  const domain = resolveCookieDomain(hostname);
  if (!domain) return null;
  return { ...getSessionCookieOptions(), domain };
}
