import { getDbPool, isDatabaseConfigured } from './auth-db';
import { deleteObjectFromR2 } from './biomechanics-storage';
import { ensureTrainingDbReady } from './training-db';

declare global {
  var __pcuMotionCaptureDbReady: boolean | undefined;
  var __pcuMotionCaptureDbReadyPromise: Promise<void> | undefined;
}

export type MotionCaptureHandedness = 'RHP' | 'LHP';
export type MotionCaptureViewType = 'side' | 'behind';

export type MotionCaptureVideoRow = {
  id: number;
  throwId: number;
  viewType: MotionCaptureViewType;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
  createdAt: string;
};

export type MotionCaptureThrowRow = {
  id: number;
  organizationId: number;
  schoolCode: string;
  playerId: number;
  playerName: string;
  playerHeight: string | null;
  playerThrowsHand: string | null;
  throwDate: string;
  throwType: string;
  handedness: MotionCaptureHandedness;
  pitchEventId: string | null;
  trackmanPitchLabel: string | null;
  trackmanPitchJson: Record<string, unknown> | null;
  analysisStatus: string;
  analysisMessage: string | null;
  calibrationJson: Record<string, unknown> | null;
  eventsJson: Record<string, unknown> | null;
  metricsJson: Record<string, unknown> | null;
  graphJson: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  videos: MotionCaptureVideoRow[];
};

export type TrackmanPitchOption = {
  pitchEventId: string;
  label: string;
  pitchNo: string | null;
  pitchType: string | null;
  velocityMph: number | null;
  pitchTime: string | null;
};

function normalizeSchoolCode(value: string): string {
  return String(value ?? '').trim().toUpperCase() || 'PCU';
}

function normalizeHandedness(value: string): MotionCaptureHandedness {
  return String(value ?? '').trim().toUpperCase() === 'LHP' ? 'LHP' : 'RHP';
}

function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export async function ensureMotionCaptureDbReady(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (global.__pcuMotionCaptureDbReady) return;
  if (global.__pcuMotionCaptureDbReadyPromise) {
    await global.__pcuMotionCaptureDbReadyPromise;
    return;
  }
  global.__pcuMotionCaptureDbReadyPromise = (async () => {
    await ensureTrainingDbReady();
    const pool = getDbPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS motion_capture_throws (
        id BIGSERIAL PRIMARY KEY,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        school_code TEXT NOT NULL,
        player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
        throw_date DATE NOT NULL,
        throw_type TEXT NOT NULL DEFAULT 'mound_no_trackman',
        handedness TEXT NOT NULL,
        pitch_event_id TEXT,
        trackman_pitch_label TEXT,
        trackman_pitch_json JSONB,
        analysis_status TEXT NOT NULL DEFAULT 'uploaded',
        analysis_message TEXT,
        calibration_json JSONB,
        events_json JSONB,
        metrics_json JSONB,
        graph_json JSONB,
        created_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS motion_capture_videos (
        id BIGSERIAL PRIMARY KEY,
        throw_id BIGINT NOT NULL REFERENCES motion_capture_throws(id) ON DELETE CASCADE,
        view_type TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes BIGINT NOT NULL,
        r2_key TEXT NOT NULL,
        width_px INTEGER,
        height_px INTEGER,
        duration_sec DOUBLE PRECISION,
        frame_rate DOUBLE PRECISION,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_motion_capture_throws_scope_player_date ON motion_capture_throws (organization_id, school_code, player_id, throw_date DESC, created_at DESC);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_motion_capture_throws_pitch_event ON motion_capture_throws (organization_id, school_code, pitch_event_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_motion_capture_videos_throw ON motion_capture_videos (throw_id);`);
    global.__pcuMotionCaptureDbReady = true;
  })();
  await global.__pcuMotionCaptureDbReadyPromise;
}

function mapVideoRow(row: {
  id: string | number;
  throw_id: string | number;
  view_type: string;
  file_name: string;
  content_type: string;
  size_bytes: string | number;
  r2_key: string;
  created_at: string;
}): MotionCaptureVideoRow {
  return {
    id: Number(row.id),
    throwId: Number(row.throw_id),
    viewType: String(row.view_type) === 'behind' ? 'behind' : 'side',
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes ?? 0),
    r2Key: row.r2_key,
    createdAt: row.created_at,
  };
}

export async function listMotionCaptureThrows(input: {
  organizationId: number;
  schoolCode: string;
  playerId?: number | null;
  throwDate?: string | null;
}): Promise<MotionCaptureThrowRow[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureMotionCaptureDbReady();
  const pool = getDbPool();
  const values: Array<string | number> = [input.organizationId, normalizeSchoolCode(input.schoolCode)];
  const filters = [`mct.organization_id = $1`, `mct.school_code = $2`];
  if (Number(input.playerId ?? 0) > 0) {
    values.push(Number(input.playerId));
    filters.push(`mct.player_id = $${values.length}`);
  }
  const throwDate = String(input.throwDate ?? '').trim();
  if (throwDate) {
    values.push(throwDate);
    filters.push(`mct.throw_date = $${values.length}::date`);
  }

  const result = await pool.query<{
    id: string;
    organization_id: number;
    school_code: string;
    player_id: number;
    player_name: string;
    player_height: string | null;
    player_throws_hand: string | null;
    throw_date: string;
    throw_type: string;
    handedness: string;
    pitch_event_id: string | null;
    trackman_pitch_label: string | null;
    trackman_pitch_json: Record<string, unknown> | null;
    analysis_status: string;
    analysis_message: string | null;
    calibration_json: Record<string, unknown> | null;
    events_json: Record<string, unknown> | null;
    metrics_json: Record<string, unknown> | null;
    graph_json: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  }>(
    `
      SELECT
        mct.id::text,
        mct.organization_id,
        mct.school_code,
        mct.player_id,
        p.full_name AS player_name,
        p.height AS player_height,
        p.throws_hand AS player_throws_hand,
        mct.throw_date::text,
        mct.throw_type,
        mct.handedness,
        mct.pitch_event_id,
        mct.trackman_pitch_label,
        mct.trackman_pitch_json,
        mct.analysis_status,
        mct.analysis_message,
        mct.calibration_json,
        mct.events_json,
        mct.metrics_json,
        mct.graph_json,
        mct.created_at::text,
        mct.updated_at::text
      FROM motion_capture_throws mct
      JOIN players p ON p.id = mct.player_id
      WHERE ${filters.join(' AND ')}
      ORDER BY mct.throw_date DESC, mct.created_at DESC
      LIMIT 100
    `,
    values
  );

  const throwIds = result.rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
  const videosByThrow = new Map<number, MotionCaptureVideoRow[]>();
  if (throwIds.length) {
    const videoResult = await pool.query<{
      id: string;
      throw_id: string;
      view_type: string;
      file_name: string;
      content_type: string;
      size_bytes: string;
      r2_key: string;
      created_at: string;
    }>(
      `
        SELECT id::text, throw_id::text, view_type, file_name, content_type, size_bytes::text, r2_key, created_at::text
        FROM motion_capture_videos
        WHERE throw_id = ANY($1::bigint[])
        ORDER BY view_type ASC, created_at ASC
      `,
      [throwIds]
    );
    for (const row of videoResult.rows) {
      const video = mapVideoRow(row);
      const current = videosByThrow.get(video.throwId) ?? [];
      current.push(video);
      videosByThrow.set(video.throwId, current);
    }
  }

  return result.rows.map((row) => ({
    id: Number(row.id),
    organizationId: row.organization_id,
    schoolCode: row.school_code,
    playerId: row.player_id,
    playerName: row.player_name,
    playerHeight: row.player_height,
    playerThrowsHand: row.player_throws_hand,
    throwDate: row.throw_date,
    throwType: row.throw_type,
    handedness: normalizeHandedness(row.handedness),
    pitchEventId: row.pitch_event_id,
    trackmanPitchLabel: row.trackman_pitch_label,
    trackmanPitchJson: row.trackman_pitch_json,
    analysisStatus: row.analysis_status,
    analysisMessage: row.analysis_message,
    calibrationJson: row.calibration_json,
    eventsJson: row.events_json,
    metricsJson: row.metrics_json,
    graphJson: row.graph_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    videos: videosByThrow.get(Number(row.id)) ?? [],
  }));
}

export async function createMotionCaptureThrow(input: {
  organizationId: number;
  schoolCode: string;
  playerId: number;
  throwDate: string;
  throwType: string;
  handedness: string;
  pitchEventId?: string | null;
  trackmanPitchLabel?: string | null;
  trackmanPitchJson?: Record<string, unknown> | null;
  createdByUserId?: number | null;
}): Promise<number> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  await ensureMotionCaptureDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO motion_capture_throws (
        organization_id,
        school_code,
        player_id,
        throw_date,
        throw_type,
        handedness,
        pitch_event_id,
        trackman_pitch_label,
        trackman_pitch_json,
        analysis_status,
        analysis_message,
        calibration_json,
        created_by_user_id
      )
      VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9::jsonb, 'uploaded', $10, $11::jsonb, $12)
      RETURNING id::text
    `,
    [
      input.organizationId,
      normalizeSchoolCode(input.schoolCode),
      input.playerId,
      input.throwDate,
      String(input.throwType ?? '').trim() || (input.pitchEventId ? 'trackman_pitch' : 'mound_no_trackman'),
      normalizeHandedness(input.handedness),
      String(input.pitchEventId ?? '').trim() || null,
      String(input.trackmanPitchLabel ?? '').trim() || null,
      toJson(input.trackmanPitchJson ?? null),
      'Video uploaded. Motion-capture processing has not run yet.',
      toJson({ behindRubberWidthIn: 24, scaleSource: 'pitching_rubber', playerHeightFallback: true }),
      input.createdByUserId && Number(input.createdByUserId) > 0 ? Number(input.createdByUserId) : null,
    ]
  );
  return Number(result.rows[0]?.id ?? 0);
}

export async function addMotionCaptureVideo(input: {
  throwId: number;
  viewType: MotionCaptureViewType;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  r2Key: string;
}): Promise<MotionCaptureVideoRow> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  await ensureMotionCaptureDbReady();
  const pool = getDbPool();
  const result = await pool.query<{
    id: string;
    throw_id: string;
    view_type: string;
    file_name: string;
    content_type: string;
    size_bytes: string;
    r2_key: string;
    created_at: string;
  }>(
    `
      INSERT INTO motion_capture_videos (throw_id, view_type, file_name, content_type, size_bytes, r2_key)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id::text, throw_id::text, view_type, file_name, content_type, size_bytes::text, r2_key, created_at::text
    `,
    [input.throwId, input.viewType, input.fileName, input.contentType, input.sizeBytes, input.r2Key]
  );
  return mapVideoRow(result.rows[0]);
}

export async function updatePlayerThrowsHand(input: {
  organizationId: number;
  playerId: number;
  handedness: string;
}): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await ensureTrainingDbReady();
  const pool = getDbPool();
  await pool.query(
    `
      UPDATE players
      SET throws_hand = $1, updated_at = NOW()
      WHERE id = $2 AND organization_id = $3
    `,
    [normalizeHandedness(input.handedness), input.playerId, input.organizationId]
  );
}

export async function updateMotionCaptureAnalysis(input: {
  organizationId: number;
  throwId: number;
  analysisStatus: string;
  analysisMessage?: string | null;
  eventsJson?: Record<string, unknown> | null | undefined;
  metricsJson?: Record<string, unknown> | null | undefined;
  graphJson?: Record<string, unknown> | null | undefined;
  calibrationJson?: Record<string, unknown> | null | undefined;
}): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  await ensureMotionCaptureDbReady();
  const pool = getDbPool();
  const result = await pool.query(
    `
      UPDATE motion_capture_throws
      SET
        analysis_status = $1,
        analysis_message = $2,
        events_json = CASE WHEN $3::boolean THEN $4::jsonb ELSE events_json END,
        metrics_json = CASE WHEN $5::boolean THEN $6::jsonb ELSE metrics_json END,
        graph_json = CASE WHEN $7::boolean THEN $8::jsonb ELSE graph_json END,
        calibration_json = CASE WHEN $9::boolean THEN COALESCE(calibration_json, '{}'::jsonb) || $10::jsonb ELSE calibration_json END,
        updated_at = NOW()
      WHERE id = $11 AND organization_id = $12
    `,
    [
      String(input.analysisStatus ?? 'analyzed'),
      input.analysisMessage ?? null,
      input.eventsJson !== undefined,
      toJson(input.eventsJson ?? null),
      input.metricsJson !== undefined,
      toJson(input.metricsJson ?? null),
      input.graphJson !== undefined,
      toJson(input.graphJson ?? null),
      input.calibrationJson !== undefined,
      toJson(input.calibrationJson ?? null),
      input.throwId,
      input.organizationId,
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getMotionCaptureVideoForAccess(input: {
  organizationId: number;
  videoId: number;
}): Promise<(MotionCaptureVideoRow & { playerId: number }) | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureMotionCaptureDbReady();
  const pool = getDbPool();
  const result = await pool.query<{
    id: string;
    throw_id: string;
    view_type: string;
    file_name: string;
    content_type: string;
    size_bytes: string;
    r2_key: string;
    created_at: string;
    player_id: number;
  }>(
    `
      SELECT v.id::text, v.throw_id::text, v.view_type, v.file_name, v.content_type, v.size_bytes::text, v.r2_key, v.created_at::text, t.player_id
      FROM motion_capture_videos v
      JOIN motion_capture_throws t ON t.id = v.throw_id
      WHERE v.id = $1 AND t.organization_id = $2
      LIMIT 1
    `,
    [input.videoId, input.organizationId]
  );
  return result.rows[0] ? { ...mapVideoRow(result.rows[0]), playerId: Number(result.rows[0].player_id) } : null;
}

export async function getMotionCaptureThrowForAccess(input: {
  organizationId: number;
  throwId: number;
}): Promise<{ throwId: number; playerId: number } | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureMotionCaptureDbReady();
  const pool = getDbPool();
  const result = await pool.query<{ id: string; player_id: number }>(
    `
      SELECT id::text, player_id
      FROM motion_capture_throws
      WHERE id = $1 AND organization_id = $2
      LIMIT 1
    `,
    [input.throwId, input.organizationId]
  );
  const row = result.rows[0];
  return row ? { throwId: Number(row.id), playerId: Number(row.player_id) } : null;
}

export async function deleteMotionCaptureThrow(input: {
  organizationId: number;
  throwId: number;
}): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  await ensureMotionCaptureDbReady();
  const pool = getDbPool();
  const videos = await pool.query<{ r2_key: string }>(
    `
      SELECT v.r2_key
      FROM motion_capture_videos v
      JOIN motion_capture_throws t ON t.id = v.throw_id
      WHERE t.id = $1 AND t.organization_id = $2
    `,
    [input.throwId, input.organizationId]
  );
  const deleted = await pool.query(
    `DELETE FROM motion_capture_throws WHERE id = $1 AND organization_id = $2`,
    [input.throwId, input.organizationId]
  );
  if ((deleted.rowCount ?? 0) < 1) return false;
  await Promise.all(videos.rows.map((row) => deleteObjectFromR2(row.r2_key)));
  return true;
}

export async function listTrackmanPitchOptionsForMotionCapture(input: {
  schoolCode: string;
  playerName: string;
  throwDate: string;
}): Promise<TrackmanPitchOption[]> {
  if (!isDatabaseConfigured()) return [];
  const schoolCode = normalizeSchoolCode(input.schoolCode);
  const playerName = String(input.playerName ?? '').trim();
  const throwDate = String(input.throwDate ?? '').trim();
  if (!playerName || !throwDate) return [];
  const pool = getDbPool();
  const columnsResult = await pool.query<{ column_name: string }>(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'pitch_events'
    `
  );
  const columns = new Set(columnsResult.rows.map((row) => row.column_name));
  if (!columns.size) return [];

  const pick = (...names: string[]) => names.find((name) => columns.has(name)) ?? null;
  const pitcherCol = pick('pitcher', 'Pitcher', 'pitcher_name', 'PitcherName', 'Name');
  const schoolCol = pick('school_code', 'SchoolCode', 'school');
  const dateCol = pick('date', 'Date', 'pitch_date', 'game_date', 'session_date');
  if (!pitcherCol || !dateCol) return [];

  const idCol = pick('pitch_uid', 'PitchUID', 'pitch_id', 'PitchID', 'id');
  const pitchNoCol = pick('pitch_no', 'PitchNo', 'pitch_number', 'PitchNumber');
  const pitchTypeCol = pick('pitch_type', 'TaggedPitchType', 'taggedpitchtype', 'AutoPitchType');
  const veloCol = pick('RelSpeed', 'relspeed', 'release_speed', 'velocity');
  const timeCol = pick('time', 'Time', 'pitch_time', 'PitchTime');

  const selectParts = [
    idCol ? `"${idCol}"::text AS pitch_event_id` : `ROW_NUMBER() OVER ()::text AS pitch_event_id`,
    pitchNoCol ? `"${pitchNoCol}"::text AS pitch_no` : `NULL::text AS pitch_no`,
    pitchTypeCol ? `"${pitchTypeCol}"::text AS pitch_type` : `NULL::text AS pitch_type`,
    veloCol ? `NULLIF(REGEXP_REPLACE("${veloCol}"::text, '[^0-9.\\-]+', '', 'g'), '')::double precision AS velocity_mph` : `NULL::double precision AS velocity_mph`,
    timeCol ? `"${timeCol}"::text AS pitch_time` : `NULL::text AS pitch_time`,
  ];
  const values = [throwDate, playerName];
  const filters = [`"${dateCol}"::date = $1::date`, `LOWER(REGEXP_REPLACE("${pitcherCol}"::text, '[^a-z0-9]+', '', 'gi')) = LOWER(REGEXP_REPLACE($2, '[^a-z0-9]+', '', 'gi'))`];
  if (schoolCol) {
    values.push(schoolCode);
    filters.push(`UPPER(TRIM("${schoolCol}"::text)) = $3`);
  }
  const result = await pool.query<{
    pitch_event_id: string;
    pitch_no: string | null;
    pitch_type: string | null;
    velocity_mph: number | null;
    pitch_time: string | null;
  }>(
    `
      SELECT ${selectParts.join(', ')}
      FROM pitch_events
      WHERE ${filters.join(' AND ')}
      ORDER BY ${timeCol ? `"${timeCol}"` : pitchNoCol ? `"${pitchNoCol}"` : idCol ? `"${idCol}"` : '1'} ASC
      LIMIT 200
    `,
    values
  );
  return result.rows.map((row, index) => {
    const parts = [
      row.pitch_no ? `#${row.pitch_no}` : `Pitch ${index + 1}`,
      row.pitch_type || null,
      Number.isFinite(Number(row.velocity_mph)) ? `${Number(row.velocity_mph).toFixed(1)} mph` : null,
      row.pitch_time || null,
    ].filter(Boolean);
    return {
      pitchEventId: row.pitch_event_id,
      pitchNo: row.pitch_no,
      pitchType: row.pitch_type,
      velocityMph: row.velocity_mph === null ? null : Number(row.velocity_mph),
      pitchTime: row.pitch_time,
      label: parts.join(' - '),
    };
  });
}
