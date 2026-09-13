import { createHash, createSign } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import pg from 'pg';

const { Pool } = pg;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const organizationId = Number(process.env.VALD_FORCEDECKS_ORGANIZATION_ID ?? 1);
const schoolCode = String(process.env.VALD_FORCEDECKS_SCHOOL_CODE ?? 'PCU').trim().toUpperCase();

function required(name) {
  const value = String(process.env[name] ?? '').trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function parseServiceAccount() {
  const raw = required('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON');
  const parsed = JSON.parse(raw);
  if (!parsed.client_email || !parsed.private_key) throw new Error('Google service-account JSON is missing client_email or private_key.');
  return parsed;
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token';
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({ iss: credentials.client_email, scope: DRIVE_SCOPE, aud: tokenUri, iat: now, exp: now + 3600 }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key).toString('base64url')}`;
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth2.0:grant-type:jwt-bearer', assertion }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) throw new Error(`Google OAuth failed (${response.status}): ${payload.error_description || payload.error || 'unknown error'}`);
  return payload.access_token;
}

async function driveJson(token, url) {
  const response = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Google Drive request failed (${response.status}): ${payload?.error?.message || 'unknown error'}`);
  return payload;
}

function escapeDriveQuery(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function listChildren(token, folderId) {
  const files = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({
      q: `'${escapeDriveQuery(folderId)}' in parents and trashed = false`,
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size)',
      pageSize: '1000',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const payload = await driveJson(token, `https://www.googleapis.com/drive/v3/files?${params}`);
    files.push(...(payload.files || []));
    pageToken = payload.nextPageToken || '';
  } while (pageToken);
  return files;
}

async function walkDriveFolder(token, rootFolderId) {
  const files = [];
  let folders = [{ id: rootFolderId, relativeParts: [] }];
  while (folders.length) {
    const next = [];
    for (const folder of folders) {
      for (const item of await listChildren(token, folder.id)) {
        const relativeParts = [...folder.relativeParts, item.name];
        if (item.mimeType === FOLDER_MIME) next.push({ id: item.id, relativeParts });
        else if (item.name.toLowerCase().endsWith('.csv') || item.mimeType === 'text/csv') files.push({ ...item, relativeParts });
      }
    }
    folders = next;
  }
  return files;
}

async function ensureLedger(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS force_plate_drive_sync_files (
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      drive_file_id TEXT NOT NULL,
      drive_path TEXT NOT NULL,
      md5_checksum TEXT,
      roster_fingerprint TEXT,
      drive_modified_at TIMESTAMPTZ,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, school_code, drive_file_id)
    )
  `);
  await pool.query(`ALTER TABLE force_plate_drive_sync_files ADD COLUMN IF NOT EXISTS roster_fingerprint TEXT`);
  await pool.query(`ALTER TABLE force_plate_drive_sync_files ADD COLUMN IF NOT EXISTS file_kind TEXT`);
  await pool.query(`ALTER TABLE force_plate_drive_sync_files ADD COLUMN IF NOT EXISTS storage_key TEXT`);
}

async function getRosterFingerprint(pool) {
  const result = await pool.query(
    `SELECT id::text, LOWER(TRIM(full_name)) AS full_name, COALESCE(status, '') AS status
     FROM players
     WHERE organization_id = $1
     ORDER BY id`,
    [organizationId]
  );
  return createHash('sha256').update(JSON.stringify(result.rows)).digest('hex');
}

async function downloadFile(token, file) {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Could not download ${file.relativeParts.join('/')} (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

function isResultExport(content) {
  const header = content.subarray(0, Math.min(content.length, 16_384)).toString('utf8').split(/\r?\n/, 1)[0].toLowerCase();
  return header.includes('name') && header.includes('test type') && header.includes('date') && header.includes('time');
}

async function archiveRawRecording(file, content) {
  const accountId = required('R2_ACCOUNT_ID');
  const bucket = String(process.env.R2_BUCKET_NAME ?? 'pcu').trim() || 'pcu';
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
    },
  });
  const hash = createHash('sha256').update(content).digest('hex');
  const fileName = safePart(file.relativeParts.at(-1) || file.name || 'recording.csv');
  const key = `vald-forcedecks-raw/org-${organizationId}/school-${schoolCode}/${hash}/${fileName}`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: content,
    ContentType: 'text/csv',
    Metadata: {
      organization_id: String(organizationId),
      school_code: schoolCode,
      drive_file_id: String(file.id),
      sha256: hash,
    },
  }));
  client.destroy();
  return key;
}

async function runImporter(root) {
  await new Promise((resolve, reject) => {
    const child = spawn('npx', ['--no-install', 'tsx', 'scripts/import-vald-forcedecks-exports.ts'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        VALD_FORCEDECKS_EXPORT_ROOT: root,
        VALD_FORCEDECKS_ORGANIZATION_ID: String(organizationId),
        VALD_FORCEDECKS_SCHOOL_CODE: schoolCode,
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`ForceDecks importer failed (${signal || code}).`)));
  });
}

async function markImported(pool, files, rosterFingerprint) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const file of files) {
      await client.query(
        `INSERT INTO force_plate_drive_sync_files
           (organization_id, school_code, drive_file_id, drive_path, md5_checksum, roster_fingerprint, drive_modified_at, file_kind, storage_key, imported_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (organization_id, school_code, drive_file_id) DO UPDATE SET
           drive_path = EXCLUDED.drive_path,
           md5_checksum = EXCLUDED.md5_checksum,
           roster_fingerprint = EXCLUDED.roster_fingerprint,
           drive_modified_at = EXCLUDED.drive_modified_at,
           file_kind = EXCLUDED.file_kind,
           storage_key = EXCLUDED.storage_key,
           imported_at = NOW()`,
        [organizationId, schoolCode, file.id, file.relativeParts.join('/'), file.md5Checksum || null, rosterFingerprint, file.modifiedTime || null, file.fileKind, file.storageKey || null]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function safePart(value) {
  return String(value).replace(/[\\/:*?"<>|\0]/g, '_').trim() || 'unnamed.csv';
}

async function main() {
  if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error('VALD_FORCEDECKS_ORGANIZATION_ID must be a positive integer.');
  const pool = new Pool({ connectionString: required('DATABASE_URL') });
  const rootFolderId = required('GOOGLE_DRIVE_VALD_FORCEDECKS_FOLDER_ID');
  const suppliedToken = String(process.env.GOOGLE_DRIVE_ACCESS_TOKEN ?? '').trim();
  const token = suppliedToken || await getAccessToken(parseServiceAccount());
  let tempRoot = '';
  try {
    await ensureLedger(pool);
    const rosterFingerprint = await getRosterFingerprint(pool);
    const driveFiles = await walkDriveFolder(token, rootFolderId);
    const state = await pool.query(
      `SELECT drive_file_id, md5_checksum, roster_fingerprint, drive_modified_at::text, file_kind
       FROM force_plate_drive_sync_files WHERE organization_id = $1 AND school_code = $2`,
      [organizationId, schoolCode]
    );
    const stateById = new Map(state.rows.map((row) => [String(row.drive_file_id), row]));
    const pending = driveFiles.filter((file) => {
      const prior = stateById.get(file.id);
      if (!prior) return true;
      if (prior.file_kind !== 'raw-recording' && prior.roster_fingerprint !== rosterFingerprint) return true;
      if (file.md5Checksum) return file.md5Checksum !== prior.md5_checksum;
      return new Date(file.modifiedTime || 0).getTime() !== new Date(prior.drive_modified_at || 0).getTime();
    });
    console.log(`VALD ForceDecks Drive CSVs: ${driveFiles.length}; new or changed: ${pending.length}`);
    if (!pending.length) return;
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'vald-forcedecks-drive-'));
    const batchSize = 20;
    for (let start = 0; start < pending.length; start += batchSize) {
      const batch = pending.slice(start, start + batchSize);
      const batchRoot = path.join(tempRoot, `batch-${String(start / batchSize + 1).padStart(4, '0')}`);
      const processed = [];
      let resultCount = 0;
      for (const file of batch) {
        console.log(`Downloading ${file.relativeParts.join('/')}`);
        const content = await downloadFile(token, file);
        if (isResultExport(content)) {
          const destination = path.join(batchRoot, ...file.relativeParts.map(safePart));
          await fs.mkdir(path.dirname(destination), { recursive: true });
          await fs.writeFile(destination, content);
          processed.push({ ...file, fileKind: 'result-export', storageKey: null });
          resultCount += 1;
        } else {
          const storageKey = await archiveRawRecording(file, content);
          processed.push({ ...file, fileKind: 'raw-recording', storageKey });
          console.log(`Archived raw ForceDecks recording: ${file.relativeParts.join('/')}`);
        }
      }
      if (resultCount > 0) await runImporter(batchRoot);
      await markImported(pool, processed, rosterFingerprint);
      await fs.rm(batchRoot, { recursive: true, force: true });
      console.log(`Drive checkpoint saved: ${Math.min(start + batch.length, pending.length)}/${pending.length}`);
    }
  } finally {
    await pool.end();
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
