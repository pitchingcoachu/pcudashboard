const PULSE_PARSE_URL = 'https://motus-server.herokuapp.com/parse';
const PULSE_APP_ID = 'P1ihKsSXJAs8slk5d6L3bPLaiezLeZnLwjMNjBkS';
const DEFAULT_IMPORT_URL = 'https://www.pcudashboard.com/api/automation/arizona-pulse';
const GMAIL_API_URL = 'https://gmail.googleapis.com/gmail/v1/users/me';
const GMAIL_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const POLL_INTERVAL_MS = 20_000;
const POLL_TIMEOUT_MS = 15 * 60_000;

function requiredEnv(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function base64UrlDecode(value) {
  const normalized = String(value ?? '').replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

function arizonaDate(daysAgo = 0) {
  const shifted = new Date(Date.now() - (7 * 60 + daysAgo * 24 * 60) * 60_000);
  return shifted.toISOString().slice(0, 10);
}

function parseDate(date) {
  return { __type: 'Date', iso: `${date}T07:00:00.000Z` };
}

async function responseError(response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    return parsed.error?.message || parsed.error || parsed.message || text;
  } catch {
    return text || `${response.status} ${response.statusText}`;
  }
}

async function pulseRequest(path, { body, sessionToken } = {}) {
  const response = await fetch(`${PULSE_PARSE_URL}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-parse-application-id': PULSE_APP_ID,
      ...(sessionToken ? { 'x-parse-session-token': sessionToken } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  if (!response.ok) throw new Error(`PULSE request failed: ${await responseError(response)}`);
  return response.json();
}

async function queuePulseExport() {
  const username = requiredEnv('ARIZONA_PULSE_USERNAME');
  const password = requiredEnv('ARIZONA_PULSE_PASSWORD');
  const exportEmail = requiredEnv('ARIZONA_PULSE_EXPORT_EMAIL');
  const login = await pulseRequest('/login', { body: { username, password } });
  if (!login.sessionToken) throw new Error('PULSE login did not return a session token.');

  const dashboard = await pulseRequest('/functions/getDashboardItems', {
    sessionToken: login.sessionToken,
    body: { sport: 'baseball', digitalCoach: false },
  });
  const items = Array.isArray(dashboard.result) ? dashboard.result : [];
  const athleteIds = [...new Set(items
    .filter((item) => item?.subscriptionStatus?.valid && item?.subscriptionStatus?.status === 'subscribed')
    .map((item) => item?.athleteProfile?.objectId)
    .filter(Boolean))];
  if (!athleteIds.length) throw new Error('PULSE returned no subscribed Arizona athletes.');

  const startDate = arizonaDate(2);
  const endDate = arizonaDate(0);
  await pulseRequest('/functions/queueDashboardExport', {
    sessionToken: login.sessionToken,
    body: {
      email: exportEmail,
      athletes: athleteIds,
      sport: 'baseball',
      startDate: parseDate(startDate),
      endDate: parseDate(endDate),
      locale: 'en',
      subscriptionOverride: false,
      exportEvents: true,
      exportWorkloads: true,
      anonymize: false,
    },
  });
  console.log(`Queued Arizona PULSE export for ${athleteIds.length} athletes (${startDate} through ${endDate}).`);
}

async function gmailAccessToken() {
  const body = new URLSearchParams({
    client_id: requiredEnv('GMAIL_CLIENT_ID'),
    client_secret: requiredEnv('GMAIL_CLIENT_SECRET'),
    refresh_token: requiredEnv('GMAIL_REFRESH_TOKEN'),
    grant_type: 'refresh_token',
  });
  const response = await fetch(GMAIL_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) throw new Error(`Gmail authentication failed: ${await responseError(response)}`);
  const payload = await response.json();
  if (!payload.access_token) throw new Error('Gmail did not return an access token.');
  return payload.access_token;
}

async function gmailRequest(path, accessToken) {
  const response = await fetch(`${GMAIL_API_URL}${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Gmail request failed: ${await responseError(response)}`);
  return response.json();
}

function messageBodies(part, output = []) {
  if (part?.body?.data && ['text/plain', 'text/html'].includes(part.mimeType)) {
    output.push(base64UrlDecode(part.body.data).toString('utf8'));
  }
  for (const child of part?.parts ?? []) messageBodies(child, output);
  return output;
}

function messageAttachments(part, output = []) {
  if (String(part?.filename ?? '').toLowerCase().endsWith('.csv') && part?.body?.attachmentId) {
    output.push({ filename: part.filename, attachmentId: part.body.attachmentId });
  }
  for (const child of part?.parts ?? []) messageAttachments(child, output);
  return output;
}

function urlsFromBodies(bodies) {
  const urls = new Set();
  for (const body of bodies) {
    for (const match of body.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
      const cleaned = match[0]
        .replace(/&amp;/gi, '&')
        .replace(/[).,;]+$/, '');
      if (/unsubscribe|privacy|facebook|twitter|instagram|linkedin/i.test(cleaned)) continue;
      urls.add(cleaned);
    }
  }
  return [...urls].slice(0, 24);
}

function csvKind(buffer) {
  const header = buffer.subarray(0, 2048).toString('utf8').replace(/^\uFEFF/, '').toLowerCase();
  if (header.includes('firstname,lastname,date,a:c ratio')) return 'workload';
  if (header.includes('firstname,lastname,datetime,tag')) return 'events';
  return null;
}

async function filesFromMessage(message, accessToken) {
  const files = [];
  for (const attachment of messageAttachments(message.payload)) {
    const payload = await gmailRequest(
      `/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(attachment.attachmentId)}`,
      accessToken,
    );
    const buffer = base64UrlDecode(payload.data);
    const kind = csvKind(buffer);
    if (kind) files.push({ kind, name: attachment.filename, buffer });
  }

  for (const url of urlsFromBodies(messageBodies(message.payload))) {
    let response;
    try {
      response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30_000) });
    } catch {
      continue;
    }
    if (!response.ok) continue;
    const buffer = Buffer.from(await response.arrayBuffer());
    const kind = csvKind(buffer);
    if (!kind) continue;
    const disposition = response.headers.get('content-disposition') ?? '';
    const filename = disposition.match(/filename\*?=(?:UTF-8''|["']?)([^"';]+)/i)?.[1];
    files.push({ kind, name: filename ? decodeURIComponent(filename) : `arizona_pulse_${kind}.csv`, buffer });
  }
  return files;
}

async function waitForPulseCsvs(requestedAt) {
  const accessToken = await gmailAccessToken();
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  const found = new Map();
  while (Date.now() < deadline) {
    const query = encodeURIComponent(`after:${Math.floor(requestedAt / 1000)} newer_than:1d`);
    const listing = await gmailRequest(`/messages?q=${query}&maxResults=30`, accessToken);
    for (const item of listing.messages ?? []) {
      const message = await gmailRequest(`/messages/${encodeURIComponent(item.id)}?format=full`, accessToken);
      const headers = Object.fromEntries((message.payload?.headers ?? []).map((header) => [
        String(header.name ?? '').toLowerCase(),
        String(header.value ?? ''),
      ]));
      const envelope = `${headers.from ?? ''} ${headers.subject ?? ''}`;
      if (!/pulse|motus|driveline/i.test(envelope)) continue;
      for (const file of await filesFromMessage(message, accessToken)) found.set(file.kind, file);
    }
    if (found.has('events') && found.has('workload')) {
      console.log('Downloaded both Arizona PULSE CSV exports from Gmail.');
      return [found.get('events'), found.get('workload')];
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Timed out waiting for both PULSE export CSVs in Gmail.');
}

async function importCsvs(files) {
  const form = new FormData();
  for (const file of files) form.append('files', new Blob([file.buffer], { type: 'text/csv' }), file.name);
  const response = await fetch(process.env.PULSE_IMPORT_URL || DEFAULT_IMPORT_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${requiredEnv('ARIZONA_PULSE_SYNC_TOKEN')}` },
    body: form,
  });
  if (!response.ok) throw new Error(`Dashboard PULSE import failed: ${await responseError(response)}`);
  const result = await response.json();
  const summary = (result.results ?? []).map((item) => ({
    kind: item.kind,
    rows: item.rowCount,
    inserted: item.insertedRows,
    duplicate: item.duplicate,
  }));
  console.log('Arizona PULSE import complete:', summary);
}

async function main() {
  const requestedAt = Date.now() - 30_000;
  await queuePulseExport();
  const files = await waitForPulseCsvs(requestedAt);
  await importCsvs(files);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
