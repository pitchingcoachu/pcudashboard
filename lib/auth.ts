import { createHmac, timingSafeEqual } from 'node:crypto';
import { validateLoginWithDatabase } from './auth-db';

export const SESSION_COOKIE_NAME = 'pcu_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 15;

type UserRecord = {
  email: string;
  password: string;
  appUrl: string;
  name?: string;
};

type SessionPayload = {
  email: string;
  appUrl: string;
  name?: string;
  exp: number;
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
      return parsed.filter((u) => u.email && u.password && u.appUrl);
    } catch {
      return [];
    }
  }

  const email = process.env.AUTH_LOGIN_EMAIL;
  const password = process.env.AUTH_LOGIN_PASSWORD;
  const appUrl = process.env.AUTH_APP_URL;
  const name = process.env.AUTH_LOGIN_NAME;

  if (email && password && appUrl) {
    return [{ email, password, appUrl, name }];
  }

  return [];
}

export function validateLogin(email: string, password: string): Omit<SessionPayload, 'exp'> | null {
  const normalized = email.trim().toLowerCase();
  const users = getConfiguredUsers();
  const match = users.find((u) => u.email.trim().toLowerCase() === normalized && u.password === password);
  if (!match) return null;

  return {
    email: match.email,
    appUrl: match.appUrl,
    name: match.name,
  };
}

export async function validateLoginCredentials(
  email: string,
  password: string
): Promise<Omit<SessionPayload, 'exp'> | null> {
  const dbUser = await validateLoginWithDatabase(email, password);
  if (dbUser) return dbUser;
  return validateLogin(email, password);
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
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: SESSION_TTL_SECONDS,
};
