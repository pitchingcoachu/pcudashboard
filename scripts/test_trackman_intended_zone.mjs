#!/usr/bin/env node
// One-off connectivity test for the Trackman Data API's practice-session
// endpoints -- confirms TM_CLIENT_ID/TM_CLIENT_SECRET work and that a real
// session actually returns plateLocSide/plateLocHeight, before building any
// UI on top of it. Run with: TM_CLIENT_ID=... TM_CLIENT_SECRET=... node scripts/test_trackman_intended_zone.mjs

const TRACKMAN_LOGIN_URL = "https://login.trackmanbaseball.com/connect/token";
const TRACKMAN_API_URL = "https://dataapi.trackmanbaseball.com/api/v1";

function requiredEnv(name) {
  const value = (process.env[name] ?? "").trim();
  if (!value) throw new Error(`Required environment variable ${name} is missing.`);
  return value;
}

async function getAccessToken(clientId, clientSecret) {
  const res = await fetch(TRACKMAN_LOGIN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Token request failed: ${res.status} ${body}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("Token response missing access_token.");
  return json.access_token;
}

async function discoverPracticeSessions(token, startDate, endDate) {
  const res = await fetch(`${TRACKMAN_API_URL}/discovery/practice/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json-patch+json",
      Accept: "text/plain",
    },
    body: JSON.stringify({
      sessionType: "All",
      utcDateFrom: `${startDate}T00:00:00Z`,
      utcDateTo: `${endDate}T23:59:59Z`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Session discovery failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function getPracticeBalls(token, sessionId) {
  const res = await fetch(`${TRACKMAN_API_URL}/data/practice/balls/${sessionId}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "text/plain" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ball data fetch failed: ${res.status} ${body}`);
  }
  return res.json();
}

async function main() {
  const clientId = requiredEnv("TM_CLIENT_ID");
  const clientSecret = requiredEnv("TM_CLIENT_SECRET");

  console.log("Requesting access token...");
  const token = await getAccessToken(clientId, clientSecret);
  console.log("Got access token. Length:", token.length);

  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 14);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = today.toISOString().slice(0, 10);

  console.log(`\nDiscovering practice sessions from ${startDate} to ${endDate}...`);
  const sessions = await discoverPracticeSessions(token, startDate, endDate);
  const rows = Array.isArray(sessions) ? sessions : [];
  console.log(`Found ${rows.length} practice session(s).`);
  rows.slice(0, 10).forEach((s, i) => {
    console.log(`  [${i}] sessionId=${s.sessionId} sessionType=${s.sessionType} gameDateLocal=${s.gameDateLocal}`);
  });

  if (rows.length === 0) {
    console.log("\nNo sessions found in the last 14 days -- nothing more to test.");
    return;
  }

  const mostRecent = rows[rows.length - 1];
  console.log(`\nFetching ball data for most recent session ${mostRecent.sessionId}...`);
  const balls = await getPracticeBalls(token, mostRecent.sessionId);
  const ballRows = Array.isArray(balls) ? balls : [];
  console.log(`Got ${ballRows.length} ball(s) tracked in that session.`);

  const firstPitch = ballRows.find((b) => b.trackType === "Pitch" && b.pitch?.location);
  if (firstPitch) {
    console.log("\nFirst pitch with location data:");
    console.log(JSON.stringify(firstPitch.pitch.location, null, 2));
  } else {
    console.log("\nNo pitch with location data found in this session (may be all Hit data, or empty).");
  }
}

main().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
