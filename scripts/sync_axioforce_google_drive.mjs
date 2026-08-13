import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSign } from 'node:crypto';
import { spawn } from 'node:child_process';
import pg from 'pg';

const { Pool } = pg;
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const organizationId = Number(process.env.AXIOFORCE_ORGANIZATION_ID ?? 1);
const schoolCode = String(process.env.AXIOFORCE_SCHOOL_CODE ?? 'PCU').trim().toUpperCase();

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
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON must contain the complete service-account JSON object.');
  }
  if (!parsed.client_email || !parsed.private_key) throw new Error('Google service-account JSON is missing client_email or private_key.');
  return parsed;
}

async function getAccessToken(credentials) {
  const now = Math.floor(Date.now() / 1000);
  const tokenUri = credentials.token_uri || 'https://oauth2.googleapis.com/token';
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: DRIVE_SCOPE,
    aud: tokenUri,
    iat: now,
    exp: now + 3600,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key).toString('base64url')}`;
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
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

async function walkDriveFolder(token, folderId) {
  const results = [];
  let folders = [{ id: folderId, relativeParts: [] }];
  const concurrency = 10;
  while (folders.length) {
    const nextFolders = [];
    for (let start = 0; start < folders.length; start += concurrency) {
      const batch = folders.slice(start, start + concurrency);
      const childrenByFolder = await Promise.all(batch.map((folder) => listChildren(token, folder.id)));
      for (let index = 0; index < batch.length; index += 1) {
        const parent = batch[index];
        for (const item of childrenByFolder[index]) {
          const nextParts = [...parent.relativeParts, item.name];
          if (item.mimeType === FOLDER_MIME) nextFolders.push({ id: item.id, relativeParts: nextParts });
          else results.push({ ...item, relativeParts: nextParts });
        }
      }
    }
    folders = nextFolders;
  }
  return results;
}

function classifyFile(file) {
  if (!file.name.toLowerCase().endsWith('.csv') && file.mimeType !== 'text/csv') return null;
  const folders = file.relativeParts.slice(0, -1).map((part) => part.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  if (folders.some((part) => part.includes('single pitch') || part.includes('individual pitch'))) return 'single_pitch';
  if (folders.some((part) => part.includes('all pitch'))) return 'all_pitches';
  return null;
}

function safePathPart(value) {
  const cleaned = String(value).replace(/[\\/:*?"<>|\0]/g, '_').trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : 'unnamed';
}

async function downloadFile(token, file, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(file.id)}?alt=media&supportsAllDrives=true`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Could not download ${file.relativeParts.join('/')} (${response.status}): ${detail.slice(0, 300)}`);
  }
  await fs.writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function ensureStateTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS biomechanics_drive_sync_files (
      organization_id BIGINT NOT NULL,
      school_code TEXT NOT NULL,
      drive_file_id TEXT NOT NULL,
      drive_path TEXT NOT NULL,
      upload_kind TEXT NOT NULL,
      md5_checksum TEXT,
      drive_modified_at TIMESTAMPTZ,
      imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (organization_id, school_code, drive_file_id)
    )
  `);
}

async function runImporter(root) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(process.cwd(), 'scripts/import_axioforce_biomech.mjs')], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AXIOFORCE_ROOT: root,
        AXIOFORCE_IMPORT_MODE: 'incremental',
        AXIOFORCE_ORGANIZATION_ID: String(organizationId),
        AXIOFORCE_SCHOOL_CODE: schoolCode,
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve() : reject(new Error(`Axioforce importer failed (${signal || code}).`)));
  });
}

async function main() {
  if (!Number.isInteger(organizationId) || organizationId <= 0) throw new Error('AXIOFORCE_ORGANIZATION_ID must be a positive integer.');
  const databaseUrl = required('DATABASE_URL');
  const rootFolderId = required('GOOGLE_DRIVE_AXIOFORCE_FOLDER_ID');
  const suppliedAccessToken = String(process.env.GOOGLE_DRIVE_ACCESS_TOKEN ?? '').trim();
  const token = suppliedAccessToken || await getAccessToken(parseServiceAccount());
  const pool = new Pool({ connectionString: databaseUrl });
  let tempRoot = '';
  try {
    await ensureStateTable(pool);
    const driveFiles = (await walkDriveFolder(token, rootFolderId))
      .map((file) => ({ ...file, uploadKind: classifyFile(file) }))
      .filter((file) => file.uploadKind);
    const state = await pool.query(
      `SELECT drive_file_id, md5_checksum, drive_modified_at::text
       FROM biomechanics_drive_sync_files WHERE organization_id = $1 AND school_code = $2`,
      [organizationId, schoolCode]
    );
    const stateById = new Map(state.rows.map((row) => [String(row.drive_file_id), row]));

    // On the first automated run, most historical Drive exports may already be
    // present from a manual import. Seed the Drive ledger by scoped filename so
    // we do not download thousands of immutable historical exports just to
    // rediscover their content hashes. Later runs use Drive checksums/timestamps.
    if (state.rows.length === 0) {
      const existingUploads = await pool.query(
        `SELECT upload_kind, source_file_name
         FROM biomechanics_uploads
         WHERE organization_id = $1 AND school_code = $2`,
        [organizationId, schoolCode]
      );
      const existingKeys = new Set(existingUploads.rows.map((row) => {
        const kind = String(row.upload_kind ?? '').trim();
        const name = path.basename(String(row.source_file_name ?? '')).trim().toLowerCase();
        return `${kind}\u0000${name}`;
      }));
      const baselineFiles = driveFiles.filter((file) =>
        existingKeys.has(`${file.uploadKind}\u0000${path.basename(file.name).trim().toLowerCase()}`)
      );
      if (baselineFiles.length) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          for (const file of baselineFiles) {
            await client.query(
              `INSERT INTO biomechanics_drive_sync_files
                 (organization_id, school_code, drive_file_id, drive_path, upload_kind, md5_checksum, drive_modified_at, imported_at)
               VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
               ON CONFLICT (organization_id, school_code, drive_file_id) DO NOTHING`,
              [organizationId, schoolCode, file.id, file.relativeParts.join('/'), file.uploadKind, file.md5Checksum || null, file.modifiedTime || null]
            );
            stateById.set(file.id, {
              drive_file_id: file.id,
              md5_checksum: file.md5Checksum || null,
              drive_modified_at: file.modifiedTime || null,
            });
          }
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally {
          client.release();
        }
        console.log(`Bootstrapped ${baselineFiles.length} existing Drive file(s) from prior dashboard imports.`);
      }
    }

    const pending = driveFiles.filter((file) => {
      const prior = stateById.get(file.id);
      if (!prior) return true;
      if (file.md5Checksum) return file.md5Checksum !== prior.md5_checksum;
      return new Date(file.modifiedTime || 0).getTime() !== new Date(prior.drive_modified_at || 0).getTime();
    });
    console.log(`Google Drive CSVs: ${driveFiles.length}; new or changed: ${pending.length}`);
    if (!pending.length) return;

    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'axioforce-drive-'));
    for (let index = 0; index < pending.length; index += 1) {
      const file = pending[index];
      const base = file.uploadKind === 'all_pitches' ? 'All pitch CSVs' : 'Single Pitch CSVs';
      const relative = file.relativeParts.map(safePathPart);
      const destination = path.join(tempRoot, base, ...relative);
      console.log(`downloading ${index + 1}/${pending.length}: ${file.relativeParts.join('/')}`);
      await downloadFile(token, file, destination);
    }
    await runImporter(tempRoot);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const file of pending) {
        await client.query(
          `INSERT INTO biomechanics_drive_sync_files
             (organization_id, school_code, drive_file_id, drive_path, upload_kind, md5_checksum, drive_modified_at, imported_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
           ON CONFLICT (organization_id, school_code, drive_file_id) DO UPDATE SET
             drive_path = EXCLUDED.drive_path,
             upload_kind = EXCLUDED.upload_kind,
             md5_checksum = EXCLUDED.md5_checksum,
             drive_modified_at = EXCLUDED.drive_modified_at,
             imported_at = NOW()`,
          [organizationId, schoolCode, file.id, file.relativeParts.join('/'), file.uploadKind, file.md5Checksum || null, file.modifiedTime || null]
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    console.log(`Axioforce Drive sync complete: ${pending.length} file(s) processed.`);
  } finally {
    await pool.end();
    if (tempRoot) await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
