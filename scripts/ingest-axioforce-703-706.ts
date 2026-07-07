import { config } from 'dotenv';
import { resolve, join } from 'node:path';
import { readFileSync, readdirSync, statSync } from 'node:fs';

config({ path: resolve(process.cwd(), '.env.local') });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = process.env.DASHBOARD_DATABASE_URL ?? '';
process.env.DB_QUERY_TIMEOUT_MS = process.env.DB_QUERY_TIMEOUT_MS || '120000';
process.env.DB_STATEMENT_TIMEOUT_MS = process.env.DB_STATEMENT_TIMEOUT_MS || '120000';

const { saveAllPitchRows, saveSinglePitchPoints } = await import('../lib/biomechanics-db');

const ORG_ID = 1;
const SCHOOL_CODE = 'PCU';
const ROOT = resolve(process.cwd(), 'Axioforce');
const DATE_FOLDER = '7:3-6';

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

function collectCsvFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectCsvFiles(full));
    } else if (entry.endsWith('.csv')) {
      results.push(full);
    }
  }
  return results;
}

async function main() {
  const allPitchDir = join(ROOT, 'All pitch CSVs', DATE_FOLDER);
  const singlePitchDir = join(ROOT, 'Single Pitch CSVs', DATE_FOLDER);

  const allPitchFiles = readdirSync(allPitchDir).filter((f) => f.endsWith('.csv')).sort();
  const singlePitchFiles = collectCsvFiles(singlePitchDir);

  console.log(`\n${DATE_FOLDER}: found ${allPitchFiles.length} all-pitch CSV(s) and ${singlePitchFiles.length} single-pitch CSV(s)`);

  let totalAllPitchRows = 0;
  let totalBackfilled = 0;
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
    totalAllPitchRows += result.insertedRows;
    totalBackfilled += result.trackmanTimesBackfilled;
    console.log(`  All-pitch: ${fileName} (${result.insertedRows} rows, ${result.trackmanTimesBackfilled} TrackMan time(s) backfilled)`);
  }

  let singlePitchDone = 0;
  let totalGraphRows = 0;
  for (const filePath of singlePitchFiles) {
    const fileName = filePath.split('/').pop() ?? filePath;
    const csvContent = readFileSync(filePath, 'utf-8');
    const rows = parseCsv(csvContent);
    const result = await saveSinglePitchPoints({
      organizationId: ORG_ID,
      schoolCode: SCHOOL_CODE,
      sourceFileName: fileName,
      csvContent,
      rows,
      createdByUserId: null,
    });
    totalGraphRows += result.insertedRows;
    singlePitchDone += 1;
    if (singlePitchDone % 20 === 0 || singlePitchDone === singlePitchFiles.length) {
      console.log(`  Single-pitch: ${singlePitchDone}/${singlePitchFiles.length} files (${totalGraphRows} graph rows cached)`);
    }
  }

  console.log(`\nDone. All-pitch rows: ${totalAllPitchRows}, TrackMan backfills: ${totalBackfilled}, Single-pitch files: ${singlePitchDone}, Graph rows: ${totalGraphRows}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
