import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { listPlayerChoicesByOrganization } from '../lib/training-db';
import { markForcePlateSyncRunCompleted, markForcePlateSyncRunStarted, upsertForcePlateSnapshotToNeon } from '../lib/force-plate-neon-db';
import type { ValdMetricRow, ValdPlayerSnapshot, ValdSnapshot } from '../lib/vald-forceplates';

const METADATA_HEADERS = new Set(['name', 'externalid', 'test type', 'date', 'time', 'reps', 'tags']);

function required(name: string): string {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function normalizeName(value: string): string {
  const raw = String(value ?? '').trim().replace(/\s+\([^)]*\)\s*$/, '').trim();
  const firstLast = raw.includes(',')
    ? (() => {
        const [last, ...rest] = raw.split(',').map((part) => part.trim());
        return `${rest.join(' ')} ${last}`.trim();
      })()
    : raw;
  return firstLast.toLowerCase().replace(/\./g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field.length || row.length) {
    row.push(field);
    if (row.some((value) => value.trim())) rows.push(row);
  }
  return rows;
}

function headerKey(value: string): string {
  return String(value ?? '').replace(/^\uFEFF/, '').trim().toLowerCase();
}

function splitMetricHeader(value: string): { name: string; unit: string } {
  const clean = String(value ?? '').replace(/^\uFEFF/, '').trim();
  const match = clean.match(/^(.*?)\s*\[([^\]]]+)\]\s*$/);
  let name = (match?.[1] ?? clean).trim();
  let unit = (match?.[2] ?? '').trim();
  if (/^bw$/i.test(name)) name = 'Body Weight';
  if (/^kg$/i.test(unit)) unit = 'kg';
  if (/^in$/i.test(unit)) unit = 'in';
  return { name, unit };
}

function parseMetricValue(value: string): { value: number; label?: string } | null {
  const raw = String(value ?? '').trim().replace(/,/g, '');
  if (!raw) return null;
  const match = raw.match(/^([-+]?(?:\d+\.?\d*|\.\d+))(?:\s*([LR]))?$/i);
  if (!match) return null;
  const numeric = Number(match[1]);
  if (!Number.isFinite(numeric)) return null;
  return { value: numeric, ...(match[2] ? { label: match[2].toUpperCase() } : {}) };
}

function metricId(name: string, unit: string): number {
  const digest = createHash('sha256').update(`${name}\u0000${unit}`).digest();
  return digest.readUInt32BE(0) & 0x7fffffff;
}

function parseLocalDateTime(dateValue: string, timeValue: string): { date: string; dateTime: string } | null {
  const dateMatch = String(dateValue ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!dateMatch) return null;
  const [, monthRaw, dayRaw, year] = dateMatch;
  const timeMatch = String(timeValue ?? '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?$/i);
  if (!timeMatch) return null;
  let hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = Number(timeMatch[3] ?? 0);
  const meridiem = String(timeMatch[4] ?? '').toUpperCase();
  if (meridiem === 'PM' && hour < 12) hour += 12;
  if (meridiem === 'AM' && hour === 12) hour = 0;
  if (hour > 23 || minute > 59 || second > 59) return null;
  const month = monthRaw.padStart(2, '0');
  const day = dayRaw.padStart(2, '0');
  const offset = String(process.env.VALD_FORCEDECKS_UTC_OFFSET ?? '-07:00').trim();
  const iso = `${year}-${month}-${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}${offset}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return { date: `${Number(month)}/${Number(day)}/${String(year).slice(-2)}`, dateTime: parsed.toISOString() };
}

async function csvFiles(root: string): Promise<string[]> {
  const info = await stat(root);
  if (info.isFile()) return root.toLowerCase().endsWith('.csv') ? [root] : [];
  const out: string[] = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...await csvFiles(full));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) out.push(full);
  }
  return out.sort();
}

type ParsedTest = { playerName: string; profileId: string | null; testId: string; rows: ValdMetricRow[] };

function parseExport(fileName: string, text: string, rosterByName: Map<string, string>): { tests: ParsedTest[]; unmatched: Set<string>; ignoredRows: number } {
  const csv = parseCsv(text);
  if (csv.length < 2) throw new Error(`${path.basename(fileName)} has no ForceDecks result rows.`);
  const headers = csv[0].map((value) => String(value ?? '').replace(/^\uFEFF/, '').trim());
  const indexByHeader = new Map(headers.map((header, index) => [headerKey(header), index]));
  for (const requiredHeader of ['name', 'test type', 'date', 'time']) {
    if (!indexByHeader.has(requiredHeader)) throw new Error(`${path.basename(fileName)} is missing the ${requiredHeader} column.`);
  }
  const unmatched = new Set<string>();
  const tests: ParsedTest[] = [];
  const duplicateCounter = new Map<string, number>();
  let ignoredRows = 0;
  for (const values of csv.slice(1)) {
    const exportedName = String(values[indexByHeader.get('name') ?? -1] ?? '').trim();
    const playerName = rosterByName.get(normalizeName(exportedName));
    if (!playerName) {
      if (exportedName) unmatched.add(exportedName);
      ignoredRows += 1;
      continue;
    }
    const testType = String(values[indexByHeader.get('test type') ?? -1] ?? '').trim() || 'Unknown';
    const dateValue = String(values[indexByHeader.get('date') ?? -1] ?? '').trim();
    const timeValue = String(values[indexByHeader.get('time') ?? -1] ?? '').trim();
    const date = parseLocalDateTime(dateValue, timeValue);
    if (!date) {
      ignoredRows += 1;
      continue;
    }
    const externalId = String(values[indexByHeader.get('externalid') ?? -1] ?? '').trim();
    const identity = `${normalizeName(playerName)}|${externalId}|${testType.toLowerCase()}|${date.dateTime}`;
    const occurrence = (duplicateCounter.get(identity) ?? 0) + 1;
    duplicateCounter.set(identity, occurrence);
    const testId = `csv-${createHash('sha256').update(`${identity}|${occurrence}`).digest('hex').slice(0, 32)}`;
    const metricRows: ValdMetricRow[] = [];
    headers.forEach((header, index) => {
      const key = headerKey(header);
      if (METADATA_HEADERS.has(key)) return;
      const parsed = parseMetricValue(values[index] ?? '');
      if (!parsed) return;
      const metric = splitMetricHeader(header);
      if (!metric.name) return;
      metricRows.push({
        testId,
        date: date.date,
        dateTime: date.dateTime,
        testType,
        metricId: metricId(metric.name, metric.unit),
        metricName: metric.name,
        metricUnit: metric.unit,
        value: parsed.value,
        pointType: 'average',
        ...(parsed.label ? { pointLabel: parsed.label } : {}),
      });
    });
    if (!metricRows.length) {
      ignoredRows += 1;
      continue;
    }
    tests.push({ playerName, profileId: externalId || null, testId, rows: metricRows });
  }
  return { tests, unmatched, ignoredRows };
}

async function main() {
  const root = required('VALD_FORCEDECKS_EXPORT_ROOT');
  const organizationId = Number(process.env.VALD_FORCEDECKS_ORGANIZATION_ID ?? 1);
  const schoolCode = String(process.env.VALD_FORCEDECKS_SCHOOL_CODE ?? 'PCU').trim().toUpperCase();
  const dryRun = String(process.env.VALD_FORCEDECKS_DRY_RUN ?? '').trim() === '1';
  if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error('VALD_FORCEDECKS_ORGANIZATION_ID must be a positive integer.');
  const roster = await listPlayerChoicesByOrganization({ organizationId, assignedCoachUserId: null });
  const rosterByName = new Map<string, string>();
  for (const player of roster) {
    const name = String(player.fullName ?? '').trim();
    if (name) rosterByName.set(normalizeName(name), name.includes(',') ? name.split(',').slice(1).join(',').trim() + ' ' + name.split(',')[0].trim() : name);
  }
  const files = await csvFiles(root);
  if (!files.length) throw new Error('No CSV files were found in VALD_FORCEDECKS_EXPORT_ROOT.');
  const tests: ParsedTest[] = [];
  const unmatched = new Set<string>();
  let ignoredRows = 0;
  for (const file of files) {
    const parsed = parseExport(file, await readFile(file, 'utf8'), rosterByName);
    tests.push(...parsed.tests);
    parsed.unmatched.forEach((name) => unmatched.add(name));
    ignoredRows += parsed.ignoredRows;
  }
  if (!tests.length) throw new Error('No roster-matched ForceDecks tests were found in the export files.');
  const byPlayer = new Map<string, ParsedTest[]>();
  for (const test of tests) {
    const list = byPlayer.get(test.playerName) ?? [];
    list.push(test);
    byPlayer.set(test.playerName, list);
  }
  const players: ValdPlayerSnapshot[] = Array.from(byPlayer.entries()).map(([playerName, playerTests]) => ({
    playerName,
    profileId: playerTests.find((test) => test.profileId)?.profileId ?? null,
    testsCount: playerTests.length,
    recentTests: [],
    metricAverages: [],
    trend: [],
    metricRows: playerTests.flatMap((test) => test.rows),
  }));
  const metricRowCount = players.reduce((sum, player) => sum + player.metricRows.length, 0);
  const summary = { files: files.length, players: players.length, tests: tests.length, metricRows: metricRowCount, ignoredRows, unmatchedPlayers: Array.from(unmatched).sort() };
  if (dryRun) {
    console.log(JSON.stringify({ ok: true, dryRun: true, ...summary }, null, 2));
    return;
  }
  await markForcePlateSyncRunStarted({ organizationId, schoolCode });
  const snapshot: ValdSnapshot = { fetchedAt: new Date().toISOString(), tenantId: 'forcedecks-csv', players };
  const result = await upsertForcePlateSnapshotToNeon({ organizationId, schoolCode, snapshot });
  if (!result.ok) {
    await markForcePlateSyncRunCompleted({ organizationId, schoolCode, ok: false, error: result.error });
    throw new Error(result.error);
  }
  await markForcePlateSyncRunCompleted({ organizationId, schoolCode, ok: true, syncedAt: snapshot.fetchedAt });
  console.log(JSON.stringify({ ok: true, ...summary }, null, 2));
}

void main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
