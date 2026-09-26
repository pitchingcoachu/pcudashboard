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
if (!credential.password) throw new Error('No GitHub credential is available.');

async function latestRun() {
  const response = await fetch(
    'https://api.github.com/repos/pitchingcoachu/pcudashboard/actions/workflows/pcu-trackman-sync.yml/runs?event=workflow_dispatch&per_page=1',
    {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${credential.password}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'pcudashboard-sync-monitor',
      },
    },
  );
  if (!response.ok) throw new Error(`GitHub runs query failed (${response.status}).`);
  const body = await response.json();
  const run = body.workflow_runs?.[0];
  return run ? {
    id: run.id,
    status: run.status,
    conclusion: run.conclusion,
    created_at: run.created_at,
    updated_at: run.updated_at,
    html_url: run.html_url,
  } : { run: null };
}

if (!process.argv.includes('--wait')) {
  console.log(JSON.stringify(await latestRun()));
} else {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const run = await latestRun();
    console.log(JSON.stringify(run));
    if (run.status === 'completed') process.exit(run.conclusion === 'success' ? 0 : 1);
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  throw new Error('Timed out waiting for the PCU sync workflow.');
}
