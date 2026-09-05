import { createPrivateKey, sign } from 'node:crypto';
import { connect, constants, type ClientHttp2Session } from 'node:http2';

type ApnsMessage = {
  token: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
};

export type ApnsDeliveryResult = {
  token: string;
  ok: boolean;
  status: number;
  reason: string | null;
};

const APNS_PRODUCTION_ORIGIN = 'https://api.push.apple.com';
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;
let cachedProviderToken: { value: string; createdAt: number; configKey: string } | null = null;
let cachedClient: ClientHttp2Session | null = null;
let warnedMissingConfig = false;

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function readPrivateKey(raw: string): string {
  const normalized = raw.trim().replace(/\\n/g, '\n');
  if (normalized.includes('BEGIN PRIVATE KEY')) return normalized;
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function apnsConfig(): { teamId: string; keyId: string; privateKey: string; bundleId: string } | null {
  const teamId = String(process.env.APNS_TEAM_ID ?? '').trim();
  const keyId = String(process.env.APNS_KEY_ID ?? '').trim();
  const privateKeyRaw = String(process.env.APNS_PRIVATE_KEY ?? '').trim();
  const bundleId = String(process.env.APNS_BUNDLE_ID ?? 'com.pitchingcoachu.pearlplayerdev').trim();
  if (!teamId || !keyId || !privateKeyRaw || !bundleId) return null;
  return { teamId, keyId, privateKey: readPrivateKey(privateKeyRaw), bundleId };
}

function providerToken(config: NonNullable<ReturnType<typeof apnsConfig>>): string {
  const now = Date.now();
  const configKey = `${config.teamId}:${config.keyId}`;
  if (cachedProviderToken && cachedProviderToken.configKey === configKey && now - cachedProviderToken.createdAt < TOKEN_MAX_AGE_MS) {
    return cachedProviderToken.value;
  }

  const encodedHeader = base64UrlJson({ alg: 'ES256', kid: config.keyId });
  const encodedClaims = base64UrlJson({ iss: config.teamId, iat: Math.floor(now / 1000) });
  const signingInput = `${encodedHeader}.${encodedClaims}`;
  const signature = sign(null, Buffer.from(signingInput), {
    key: createPrivateKey(config.privateKey),
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const value = `${signingInput}.${signature}`;
  cachedProviderToken = { value, createdAt: now, configKey };
  return value;
}

function sendOne(
  client: ClientHttp2Session,
  config: NonNullable<ReturnType<typeof apnsConfig>>,
  authorization: string,
  message: ApnsMessage
): Promise<ApnsDeliveryResult> {
  return new Promise((resolve) => {
    let status = 0;
    let responseBody = '';
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const finish = (result: ApnsDeliveryResult) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(result);
    };
    timeout = setTimeout(() => {
      finish({ token: message.token, ok: false, status, reason: 'APNs request timed out.' });
    }, 10_000);

    const request = client.request({
      [constants.HTTP2_HEADER_METHOD]: 'POST',
      [constants.HTTP2_HEADER_PATH]: `/3/device/${message.token}`,
      authorization: `bearer ${authorization}`,
      'apns-topic': config.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    });
    request.setEncoding('utf8');
    request.on('response', (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS] ?? 0);
    });
    request.on('data', (chunk: string) => {
      responseBody += chunk;
    });
    request.on('error', (error) => {
      finish({ token: message.token, ok: false, status, reason: error.message });
    });
    request.on('end', () => {
      let reason: string | null = null;
      if (responseBody) {
        try {
          const parsed = JSON.parse(responseBody) as { reason?: unknown };
          reason = typeof parsed.reason === 'string' ? parsed.reason : responseBody;
        } catch {
          reason = responseBody;
        }
      }
      finish({ token: message.token, ok: status === 200, status, reason });
    });

    const customData = message.data && typeof message.data === 'object' ? message.data : {};
    request.end(JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: 'default',
      },
      ...customData,
    }));
  });
}

function productionClient(): ClientHttp2Session {
  if (cachedClient && !cachedClient.closed && !cachedClient.destroyed) return cachedClient;
  const client = connect(APNS_PRODUCTION_ORIGIN);
  cachedClient = client;
  client.on('error', () => {
    if (cachedClient === client) cachedClient = null;
  });
  client.on('close', () => {
    if (cachedClient === client) cachedClient = null;
  });
  return client;
}

/** Sends visible production notifications directly through Apple Push
 * Notification service. Missing credentials make this a safe no-op so a
 * notification failure can never break the underlying dashboard action. */
export async function sendApnsNotifications(messages: ApnsMessage[]): Promise<ApnsDeliveryResult[]> {
  const config = apnsConfig();
  const validMessages = messages.filter((message) => /^[a-f0-9]{32,}$/i.test(message.token));
  if (!config) {
    if (!warnedMissingConfig && validMessages.length > 0) {
      warnedMissingConfig = true;
      console.warn('[push] APNs credentials are not configured; native notifications were skipped.');
    }
    return [];
  }
  if (validMessages.length === 0) return [];

  const authorization = providerToken(config);
  const client = productionClient();
  return Promise.all(validMessages.map((message) => sendOne(client, config, authorization, message)));
}
