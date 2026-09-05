import { randomBytes } from 'node:crypto';
import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const credentialsPath = process.argv[2];
if (!credentialsPath) throw new Error('Pass the downloaded Google OAuth credentials JSON path.');

const credentialsJson = JSON.parse(await readFile(credentialsPath, 'utf8'));
const credentials = credentialsJson.installed ?? credentialsJson.web;
if (!credentials?.client_id || !credentials?.client_secret) {
  throw new Error('Google OAuth JSON does not contain a desktop client ID and secret.');
}

const port = 53682;
const redirectUri = `http://127.0.0.1:${port}/oauth2/callback`;
const state = randomBytes(24).toString('hex');
const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authorizationUrl.search = new URLSearchParams({
  client_id: credentials.client_id,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/gmail.readonly',
  access_type: 'offline',
  prompt: 'consent',
  state,
}).toString();

const resultPath = '/private/tmp/arizona-pulse-gmail-oauth.json';

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    server.close();
    reject(new Error('Gmail authorization timed out after 10 minutes.'));
  }, 10 * 60_000);

  const server = createServer(async (request, response) => {
    try {
      const callback = new URL(request.url ?? '/', redirectUri);
      if (callback.pathname !== '/oauth2/callback') {
        response.writeHead(404).end('Not found');
        return;
      }
      if (callback.searchParams.get('state') !== state) throw new Error('OAuth state did not match.');
      if (callback.searchParams.get('error')) throw new Error(`Google authorization failed: ${callback.searchParams.get('error')}`);
      const code = callback.searchParams.get('code');
      if (!code) throw new Error('Google did not return an authorization code.');

      const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: credentials.client_id,
          client_secret: credentials.client_secret,
          code,
          grant_type: 'authorization_code',
          redirect_uri: redirectUri,
        }),
      });
      const tokenPayload = await tokenResponse.json();
      if (!tokenResponse.ok) throw new Error(tokenPayload.error_description || tokenPayload.error || 'Token exchange failed.');
      if (!tokenPayload.refresh_token) throw new Error('Google did not issue an offline refresh token.');

      await writeFile(resultPath, JSON.stringify({
        clientId: credentials.client_id,
        clientSecret: credentials.client_secret,
        refreshToken: tokenPayload.refresh_token,
      }), { mode: 0o600 });
      await chmod(resultPath, 0o600);

      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<h1>Gmail authorization complete</h1><p>You may close this tab and return to Codex.</p>');
      clearTimeout(timeout);
      server.close(() => resolve());
    } catch (error) {
      response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      response.end(error instanceof Error ? error.message : 'Authorization failed.');
      clearTimeout(timeout);
      server.close(() => reject(error));
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log('Opening Google authorization in your browser...');
    const opener = spawn('open', [authorizationUrl.toString()], { detached: true, stdio: 'ignore' });
    opener.unref();
  });
});

console.log(`Gmail authorization completed. Credentials were written securely to ${resultPath}.`);
