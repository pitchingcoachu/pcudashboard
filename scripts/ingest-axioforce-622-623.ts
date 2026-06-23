import { config } from 'dotenv';
import { resolve, join } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

config({ path: resolve(process.cwd(), '.env.local') });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = process.env.DASHBOARD_DATABASE_URL ?? '';
process.env.DB_QUERY_TIMEOUT_MS = process.env.DB_QUERY_TIMEOUT_MS || '120000';
process.env.DB_STATEMENT_TIMEOUT_MS = process.env.DB_STATEMENT_TIMEOUT_MS || '120000';

const { saveAllPitchRows, saveSinglePitchPoints } = await import('../lib/biomechanics-db');

const ORG_ID = 1;
const SCHOOL_CODE = 'PCU';
const ROOT = resolve(process.cwd(), 'Axioforce');
const DATES = ['6-22', '6-23'] as const;

function parseCsv(text: string): Array<Record<string, string>> {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const parsedRows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? '';
    const nextCharacter = normalized[index + 1] ?? '';
    if (character === '"') {
      if (inQuotes && nextCharacter === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (character === ',' && !inQuotes) {
      row.push(field);
      field = '';
    } else if (character === '\n' && !inQuotes) {
      row.push(field);
      parsedRows.push(row);
      row = [];
      field = '';
    } else {
      field += character;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    parsedRows.push(row);
  }

  const headers = (parsedRows.shift() ?? []).map((header) => header.trim());
  return parsedRows
    .filter((values) => values.some((value) => value.trim()))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]?.trim() ?? ''])));
}

async function ingestDate(dateFolder: (typeof DATES)[number]) {
  const allPitchDir = join(ROOT, 'All pitch CSVs', dateFolder);
  const singlePitchDir = join(ROOT, 'Single Pitch CSVs', dateFolder);
  const allPitchFiles = readdirSync(allPitchDir).filter((fileName) => fileName.endsWith('.csv')).sort();
  const singlePitchFiles = readdirSync(singlePitchDir).filter((fileName) => fileName.endsWith('.csv')).sort();

  console.log(`\n${dateFolder}: found ${allPitchFiles.length} all-pitch CSV(s) and ${singlePitchFiles.length} single-pitch CSV(s)`);
  let allPitchRows = 0;
  let trackmanTimesBackfilled = 0;
  for (const fileName of allPitchFiles) {
    const csvContent = readFileSync(join(allPitchDir, fileName), 'utf-8');
    const rows = parseCsv(csvContent);
    const result = await saveAllPitchRows({
      organizationId: ORG_ID,
      schoolCode: SCHOOL_CODE,
      sourceFileName: fileName,
      csvContent,
      rows,
      createdByUserId: null,
    });
    allPitchRows += result.insertedRows;
    trackmanTimesBackfilled += result.trackmanTimesBackfilled;
    console.log(`  All-pitch: ${fileName} (${result.insertedRows} rows, ${result.trackmanTimesBackfilled} TrackMan time(s) backfilled)`);
  }

  let singlePitchFilesDone = 0;
  let graphRows = 0;
  for (const fileName of singlePitchFiles) {
    const csvContent = readFileSync(join(singlePitchDir, fileName), 'utf-8');
    const rows = parseCsv(csvContent);
    const result = await saveSinglePitchPoints({
      organizationId: ORG_ID,
      schoolCode: SCHOOL_CODE,
      sourceFileName: fileName,
      csvContent,
      rows,
      createdByUserId: null,
    });
    graphRows += result.insertedRows;
    singlePitchFilesDone += 1;
    if (singlePitchFilesDone % 10 === 0 || singlePitchFilesDone === singlePitchFiles.length) {
      console.log(`  Single-pitch: ${singlePitchFilesDone}/${singlePitchFiles.length} files (${graphRows} graph rows cached)`);
    }
  }

  return { dateFolder, allPitchFiles: allPitchFiles.length, allPitchRows, trackmanTimesBackfilled, singlePitchFiles: singlePitchFilesDone, graphRows };
}

async function main() {
  const results = [];
  for (const dateFolder of DATES) results.push(await ingestDate(dateFolder));
  console.log(`\n${JSON.stringify({ imported: results })}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
