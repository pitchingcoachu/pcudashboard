import { execFileSync } from 'node:child_process';
import JSZip from 'jszip';

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
if (!credential.password) throw new Error('No GitHub credential is available.');

const response = await fetch(
  'https://api.github.com/repos/pitchingcoachu/pcudashboard/actions/runs/36256972858/logs',
  {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${credential.password}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pcudashboard-sync-log-check',
    },
    redirect: 'follow',
  },
);
if (!response.ok) throw new Error(`GitHub log download failed (${response.status}).`);
const zip = await JSZip.loadAsync(await response.arrayBuffer());
for (const [name, entry] of Object.entries(zip.files)) {
  if (entry.dir) continue;
  const content = await entry.async('string');
  const lines = content.split('\n').filter((line) =>
    /Syncing PCU|discovered \d+ CSV|Pitching_2026-09-25|Complete:|roster_name_keys|intended-zone|source unavailable/i.test(line),
  );
  if (lines.length) {
    console.log(`LOG ${name}`);
    console.log(lines.join('\n'));
  }
}
