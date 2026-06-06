import { config } from 'dotenv';
import { resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

config({ path: resolve(process.cwd(), '.env.local') });
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = process.env.DASHBOARD_DATABASE_URL ?? '';
}

const { saveAllPitchRows, saveSinglePitchPoints } = await import('../lib/biomechanics-db');

const ORG_ID = 1;
const SCHOOL_CODE = 'PCU';

function parseCsv(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/);
  const headers = lines[0]?.split(',').map((h) => h.trim().replace(/^"|"$/g, '')) ?? [];
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim();
    if (!line) continue;
    const values = line.split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h] = values[idx] ?? ''; });
    rows.push(row);
  }
  return rows;
}

async function main() {
  const allPitchDir = '/Users/jaredgaynor/Documents/GitHub/pcudashboard/Axioforce/All pitch CSVs/6:5';
  const singlePitchDir = '/Users/jaredgaynor/Documents/GitHub/pcudashboard/Axioforce/Single Pitch CSVs/6:5';

  const allPitchFiles = readdirSync(allPitchDir).filter((f) => f.endsWith('.csv'));
  console.log(`Found ${allPitchFiles.length} all-pitch CSV(s)`);
  for (const fileName of allPitchFiles) {
    const csvContent = readFileSync(join(allPitchDir, fileName), 'utf-8');
    const rows = parseCsv(csvContent);
    console.log(`  Ingesting all-pitch: ${fileName} (${rows.length} rows)`);
    const result = await saveAllPitchRows({ organizationId: ORG_ID, schoolCode: SCHOOL_CODE, sourceFileName: fileName, csvContent, rows, createdByUserId: null });
    console.log(`  → Inserted ${result.insertedRows} rows`);
  }

  const singleFiles = readdirSync(singlePitchDir).filter((f) => f.endsWith('.csv'));
  console.log(`\nFound ${singleFiles.length} single-pitch CSV(s)`);
  let done = 0;
  for (const fileName of singleFiles) {
    const csvContent = readFileSync(join(singlePitchDir, fileName), 'utf-8');
    const rows = parseCsv(csvContent);
    await saveSinglePitchPoints({ organizationId: ORG_ID, schoolCode: SCHOOL_CODE, sourceFileName: fileName, csvContent, rows, createdByUserId: null });
    done++;
    if (done % 20 === 0) console.log(`  Ingested ${done}/${singleFiles.length}...`);
  }
  console.log(`\nDone. ${done} single-pitch files ingested.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
