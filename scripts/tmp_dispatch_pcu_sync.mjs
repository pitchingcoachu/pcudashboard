import { execFileSync } from 'node:child_process';

const credentialText = execFileSync(
  'git',
  ['credential', 'fill'],
  { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
);
const credential = Object.fromEntries(
  credentialText.trim().split('\n').map((line) => {
    const index = line.indexOf('=');
    return [line.slice(0, index), line.slice(index + 1)];
  }),
);

if (!credential.password) throw new Error('No GitHub credential is available from the configured Git credential helper.');

const response = await fetch(
  'https://api.github.com/repos/pitchingcoachu/pcudashboard/actions/workflows/pcu-trackman-sync.yml/dispatches',
  {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${credential.password}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pcudashboard-sync-dispatch',
    },
    body: JSON.stringify({
      ref: 'main',
      inputs: {
        start_date: '2026-09-25',
        end_date: '2026-09-26',
        lookback_days: '2',
      },
    }),
  },
);

console.log(JSON.stringify({ status: response.status, ok: response.ok }));
if (!response.ok) {
  const body = await response.text();
  throw new Error(`GitHub workflow dispatch failed (${response.status}): ${body.slice(0, 500)}`);
}
