// One-time setup: subscribes the dashboard to your Calendly bookings.
//
//   CALENDLY_TOKEN=<personal access token> CALENDLY_WEBHOOK_SIGNING_KEY=<same value as on Vercel> \
//     node scripts/register-calendly-webhook.mjs https://<your-dashboard-domain>
//
// Prints your event types (copy the assessment one into CALENDLY_ASSESSMENT_EVENT_TYPES) and the
// webhook it created. Re-running is safe: an existing subscription to the same URL is reported, not duplicated.

const token = process.env.CALENDLY_TOKEN;
const signingKey = process.env.CALENDLY_WEBHOOK_SIGNING_KEY;
const baseUrl = String(process.argv[2] ?? '').replace(/\/+$/, '');
if (!token || !signingKey || !baseUrl) {
  console.error('Usage: CALENDLY_TOKEN=... CALENDLY_WEBHOOK_SIGNING_KEY=... node scripts/register-calendly-webhook.mjs https://your-domain');
  process.exit(1);
}
const callbackUrl = `${baseUrl}/api/webhooks/calendly`;

async function calendly(path, init = {}) {
  const response = await fetch(`https://api.calendly.com${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${response.status}: ${JSON.stringify(body)}`);
  return body;
}

const me = (await calendly('/users/me')).resource;
console.log(`Calendly user: ${me.name} <${me.email}>`);

const eventTypes = (await calendly(`/event_types?user=${encodeURIComponent(me.uri)}&count=100`)).collection;
console.log('\nEvent types:');
for (const type of eventTypes) console.log(`  ${type.active ? '•' : '○'} ${type.name}\n      ${type.uri}`);

const existing = (await calendly(`/webhook_subscriptions?organization=${encodeURIComponent(me.current_organization)}&user=${encodeURIComponent(me.uri)}&scope=user`)).collection;
const match = existing.find((hook) => hook.callback_url === callbackUrl);
if (match) {
  console.log(`\nWebhook already registered (${match.state}): ${match.uri}`);
} else {
  const created = (await calendly('/webhook_subscriptions', {
    method: 'POST',
    body: JSON.stringify({ url: callbackUrl, events: ['invitee.created', 'invitee.canceled'], organization: me.current_organization, user: me.uri, scope: 'user', signing_key: signingKey }),
  })).resource;
  console.log(`\nWebhook created: ${created.uri}\n  → ${created.callback_url}`);
}
