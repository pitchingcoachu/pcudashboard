import { timingSafeEqual } from 'node:crypto';
import { getDbPool, isDatabaseConfigured } from './auth-db';
import { classifyMissDirection, ensureIntendedZoneSchema } from './training-db';

type JsonObject = Record<string, unknown>;

export type TrackmanVector3 = { x: number; y: number; z: number };

export type TrackmanFlightData = {
  position: TrackmanVector3;
  velocity: TrackmanVector3;
  acceleration: TrackmanVector3;
  releaseSideFt: number | null;
  releaseHeightFt: number | null;
  releaseExtensionFt: number | null;
};

export type TrackmanEventGridEnvelope = {
  eventType?: string;
  data?: unknown;
  eventTime?: string;
  id?: string;
};

export type NormalizedTrackmanPitch = {
  sessionId: string;
  playId: string;
  trackId: string | null;
  trackedAt: string | null;
  receivedAt: string | null;
  plateLocSideFt: number | null;
  plateLocHeightFt: number | null;
  relSpeedMph: number | null;
  inducedVertBreakIn: number | null;
  horzBreakIn: number | null;
  pitchType: string | null;
  pitcherThrows: string | null;
  taggedPitcherName: string | null;
  flightData: TrackmanFlightData | null;
};

let schemaReady: Promise<void> | null = null;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null;
}

function field(value: JsonObject | null, ...names: string[]): unknown {
  if (!value) return undefined;
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(value, name)) return value[name];
  }
  return undefined;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function vector3Value(value: unknown): TrackmanVector3 | null {
  const source = object(value);
  const x = numberValue(field(source, 'X', 'x'));
  const y = numberValue(field(source, 'Y', 'y'));
  const z = numberValue(field(source, 'Z', 'z'));
  return x === null || y === null || z === null ? null : { x, y, z };
}

function isoValue(value: unknown): string | null {
  const raw = textValue(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function unwrapTrackmanEvents(body: unknown): TrackmanEventGridEnvelope[] {
  const items = Array.isArray(body) ? body : [body];
  return items
    .map((item) => object(item))
    .filter((item): item is JsonObject => Boolean(item))
    .map((item) => {
      const hasEnvelope = field(item, 'eventType', 'EventType') !== undefined && field(item, 'data', 'Data') !== undefined;
      return hasEnvelope
        ? {
            eventType: textValue(field(item, 'eventType', 'EventType')) ?? undefined,
            data: field(item, 'data', 'Data'),
            eventTime: textValue(field(item, 'eventTime', 'EventTime')) ?? undefined,
            id: textValue(field(item, 'id', 'Id')) ?? undefined,
          }
        : { data: item };
    });
}

export function getTrackmanValidationCode(events: TrackmanEventGridEnvelope[]): string | null {
  for (const event of events) {
    const data = object(event.data);
    const code = textValue(field(data, 'validationCode', 'ValidationCode'));
    if (code && String(event.eventType ?? '').toLowerCase().includes('subscriptionvalidation')) return code;
  }
  return null;
}

/** The secret is carried in the URL TrackMan configures. Event Grid does not
 * provide a customer-controlled signature for this feed, so an unguessable
 * URL token keeps arbitrary internet callers out of the ingestion routes. */
export function isTrackmanWebhookAuthorized(request: Request): boolean {
  const expected = String(process.env.TRACKMAN_WEBHOOK_TOKEN ?? '').trim();
  const supplied = new URL(request.url).searchParams.get('token')?.trim() ?? '';
  if (!expected || !supplied) return false;
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

export function normalizeTrackmanPitch(payload: unknown): NormalizedTrackmanPitch | null {
  const root = object(payload);
  if (!root) return null;
  const kind = textValue(field(root, 'Kind', 'kind'));
  const sessionId = textValue(field(root, 'SessionId', 'sessionId'));
  const playId = textValue(field(root, 'PlayId', 'playId', 'PlayID', 'playID'));
  const pitch = object(field(root, 'Pitch', 'pitch'));
  if (kind?.toLowerCase() !== 'pitch' || !sessionId || !playId || !pitch) return null;

  const release = object(field(pitch, 'Release', 'release'));
  const location = object(field(pitch, 'Location', 'location'));
  const movement = object(field(pitch, 'Movement', 'movement'));
  const nineP = object(field(pitch, 'NineP', 'nineP'));
  const pitchTag = object(field(root, 'PitchTag', 'pitchTag'));
  const players = object(field(root, 'Players', 'players'));
  const pitcher = object(field(players, 'Pitcher', 'pitcher'));

  // Despite the short field names, TrackMan's live B1 webhook sends these in
  // baseball display units: Location is feet, Release.Speed is mph, and both
  // Movement values are inches. The Data API uses the same display units.
  const sideFeet = numberValue(field(location, 'Side', 'side'));
  const heightFeet = numberValue(field(location, 'Height', 'height'));
  const speedMph = numberValue(field(release, 'Speed', 'speed'));
  const inducedVerticalInches = numberValue(field(movement, 'InducedVertical', 'inducedVertical'));
  const horizontalInches = numberValue(field(movement, 'Horizontal', 'horizontal'));
  const position = vector3Value(field(nineP, 'X0', 'x0'));
  const velocity = vector3Value(field(nineP, 'V0', 'v0'));
  const acceleration = vector3Value(field(nineP, 'A0', 'a0'));

  return {
    sessionId,
    playId,
    trackId: textValue(field(root, 'TrackId', 'trackId')),
    trackedAt: isoValue(field(root, 'TrackStartTime', 'trackStartTime', 'Time', 'time')),
    receivedAt: null,
    plateLocSideFt: sideFeet,
    plateLocHeightFt: heightFeet,
    relSpeedMph: speedMph,
    inducedVertBreakIn: inducedVerticalInches,
    horzBreakIn: horizontalInches,
    pitchType: textValue(field(pitchTag, 'TaggedPitchType', 'taggedPitchType')),
    pitcherThrows: textValue(field(pitcher, 'PitchingHandedness', 'pitchingHandedness')),
    taggedPitcherName: textValue(field(pitcher, 'NameRef', 'nameRef')),
    flightData:
      position && velocity && acceleration
        ? {
            position,
            velocity,
            acceleration,
            releaseSideFt: numberValue(field(release, 'Side', 'side')),
            releaseHeightFt: numberValue(field(release, 'Height', 'height')),
            releaseExtensionFt: numberValue(field(release, 'Extension', 'extension')),
          }
        : null,
  };
}

async function ensureTrackmanLiveSchema(): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  if (!schemaReady) {
    schemaReady = (async () => {
      const pool = getDbPool();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS trackman_live_sessions (
          session_id TEXT PRIMARY KEY,
          session_type TEXT,
          state TEXT,
          venue_name TEXT,
          field_name TEXT,
          started_at TIMESTAMPTZ,
          ended_at TIMESTAMPTZ,
          event_time TIMESTAMPTZ,
          raw_payload JSONB NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS trackman_live_ball_events (
          play_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          track_id TEXT,
          kind TEXT NOT NULL,
          tracked_at TIMESTAMPTZ,
          plate_loc_side_ft DOUBLE PRECISION,
          plate_loc_height_ft DOUBLE PRECISION,
          rel_speed_mph DOUBLE PRECISION,
          induced_vert_break_in DOUBLE PRECISION,
          horz_break_in DOUBLE PRECISION,
          pitch_type TEXT,
          pitcher_throws TEXT,
          tagged_pitcher_name TEXT,
          raw_payload JSONB NOT NULL,
          received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_trackman_live_ball_events_session_time
         ON trackman_live_ball_events (session_id, tracked_at, received_at);`
      );
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  await schemaReady;
}

export async function storeTrackmanSession(payload: unknown, envelopeTime?: string): Promise<boolean> {
  const root = object(payload);
  const sessionId = textValue(field(root, 'SessionId', 'sessionId'));
  if (!root || !sessionId) return false;
  await ensureTrackmanLiveSchema();

  const location = object(field(root, 'Location', 'location'));
  const venue = object(field(location, 'Venue', 'venue'));
  const fieldLocation = object(field(location, 'Field', 'field'));
  const sessionState = object(field(root, 'SessionState', 'sessionState'));
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO trackman_live_sessions
       (session_id, session_type, state, venue_name, field_name, started_at, ended_at, event_time, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     ON CONFLICT (session_id) DO UPDATE SET
       session_type = COALESCE(EXCLUDED.session_type, trackman_live_sessions.session_type),
       state = COALESCE(EXCLUDED.state, trackman_live_sessions.state),
       venue_name = COALESCE(EXCLUDED.venue_name, trackman_live_sessions.venue_name),
       field_name = COALESCE(EXCLUDED.field_name, trackman_live_sessions.field_name),
       started_at = COALESCE(EXCLUDED.started_at, trackman_live_sessions.started_at),
       ended_at = COALESCE(EXCLUDED.ended_at, trackman_live_sessions.ended_at),
       event_time = COALESCE(EXCLUDED.event_time, trackman_live_sessions.event_time),
       raw_payload = EXCLUDED.raw_payload,
       updated_at = NOW()`,
    [
      sessionId,
      textValue(field(root, 'SessionType', 'sessionType')),
      textValue(field(sessionState, 'State', 'state')),
      textValue(field(venue, 'Name', 'name')),
      textValue(field(fieldLocation, 'Name', 'name')),
      isoValue(field(sessionState, 'SessionStartedUtc', 'sessionStartedUtc')),
      isoValue(field(sessionState, 'SessionEndedUtc', 'sessionEndedUtc')),
      isoValue(field(root, 'Time', 'time')) ?? isoValue(envelopeTime),
      JSON.stringify(root),
    ]
  );
  return true;
}

export async function storeTrackmanBallEvent(payload: unknown): Promise<boolean> {
  const normalized = normalizeTrackmanPitch(payload);
  const root = object(payload);
  const sessionId = normalized?.sessionId ?? textValue(field(root, 'SessionId', 'sessionId'));
  const playId = normalized?.playId ?? textValue(field(root, 'PlayId', 'playId', 'PlayID', 'playID'));
  const pitchTag = object(field(root, 'PitchTag', 'pitchTag'));
  const players = object(field(root, 'Players', 'players'));
  const pitcher = object(field(players, 'Pitcher', 'pitcher'));
  const pitchType = normalized?.pitchType ?? textValue(field(pitchTag, 'TaggedPitchType', 'taggedPitchType'));
  const pitcherThrows = normalized?.pitcherThrows ?? textValue(field(pitcher, 'PitchingHandedness', 'pitchingHandedness'));
  const taggedPitcherName = normalized?.taggedPitcherName ?? textValue(field(pitcher, 'NameRef', 'nameRef'));
  const isPlayMetadata = Boolean(pitchTag || players || field(root, 'TaggerBehavior', 'taggerBehavior'));
  if (!root || !sessionId || !playId || (!normalized && !isPlayMetadata)) return false;
  await ensureTrackmanLiveSchema();
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO trackman_live_ball_events
       (play_id, session_id, track_id, kind, tracked_at, plate_loc_side_ft, plate_loc_height_ft,
        rel_speed_mph, induced_vert_break_in, horz_break_in, pitch_type, pitcher_throws,
        tagged_pitcher_name, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
     ON CONFLICT (play_id) DO UPDATE SET
       session_id = EXCLUDED.session_id,
       kind = CASE WHEN EXCLUDED.kind = 'Pitch' THEN 'Pitch' ELSE trackman_live_ball_events.kind END,
       track_id = COALESCE(EXCLUDED.track_id, trackman_live_ball_events.track_id),
       tracked_at = COALESCE(EXCLUDED.tracked_at, trackman_live_ball_events.tracked_at),
       plate_loc_side_ft = COALESCE(EXCLUDED.plate_loc_side_ft, trackman_live_ball_events.plate_loc_side_ft),
       plate_loc_height_ft = COALESCE(EXCLUDED.plate_loc_height_ft, trackman_live_ball_events.plate_loc_height_ft),
       rel_speed_mph = COALESCE(EXCLUDED.rel_speed_mph, trackman_live_ball_events.rel_speed_mph),
       induced_vert_break_in = COALESCE(EXCLUDED.induced_vert_break_in, trackman_live_ball_events.induced_vert_break_in),
       horz_break_in = COALESCE(EXCLUDED.horz_break_in, trackman_live_ball_events.horz_break_in),
       pitch_type = COALESCE(EXCLUDED.pitch_type, trackman_live_ball_events.pitch_type),
       pitcher_throws = COALESCE(EXCLUDED.pitcher_throws, trackman_live_ball_events.pitcher_throws),
       tagged_pitcher_name = COALESCE(EXCLUDED.tagged_pitcher_name, trackman_live_ball_events.tagged_pitcher_name),
       raw_payload = trackman_live_ball_events.raw_payload || EXCLUDED.raw_payload,
       updated_at = NOW()`,
    [
      playId,
      sessionId,
      normalized?.trackId ?? null,
      normalized ? 'Pitch' : 'Metadata',
      normalized?.trackedAt ?? isoValue(field(root, 'Time', 'time')),
      normalized?.plateLocSideFt ?? null,
      normalized?.plateLocHeightFt ?? null,
      normalized?.relSpeedMph ?? null,
      normalized?.inducedVertBreakIn ?? null,
      normalized?.horzBreakIn ?? null,
      pitchType,
      pitcherThrows,
      taggedPitcherName,
      JSON.stringify(root),
    ]
  );
  // Metadata may arrive after the ball was already matched on the live page.
  // Fill those descriptive fields without overwriting Data API/coach values.
  if (pitchType || pitcherThrows || taggedPitcherName) {
    await ensureIntendedZoneSchema();
    await pool.query(
      `UPDATE intended_zone_pitches
       SET pitch_type = COALESCE(pitch_type, $2),
           tagged_pitcher_name = COALESCE(tagged_pitcher_name, $3)
       WHERE trackman_play_id = $1`,
      [playId, pitchType, taggedPitcherName]
    );
    if (pitcherThrows) {
      const matched = await pool.query<{
        id: number;
        intended_side_ft: number;
        intended_height_ft: number;
        target_radius_ft: number;
        plate_loc_side: number;
        plate_loc_height: number;
      }>(
        `SELECT id, intended_side_ft, intended_height_ft, target_radius_ft, plate_loc_side, plate_loc_height
         FROM intended_zone_pitches
         WHERE trackman_play_id = $1 AND plate_loc_side IS NOT NULL AND plate_loc_height IS NOT NULL`,
        [playId]
      );
      for (const row of matched.rows) {
        await pool.query(`UPDATE intended_zone_pitches SET miss_direction = $2 WHERE id = $1`, [
          row.id,
          classifyMissDirection({
            missSideFt: Number(row.plate_loc_side) - Number(row.intended_side_ft),
            missHeightFt: Number(row.plate_loc_height) - Number(row.intended_height_ft),
            targetRadiusFt: Number(row.target_radius_ft),
            pitcherThrows,
          }),
        ]);
      }
    }
  }
  return true;
}

export async function listLiveTrackmanSessions(): Promise<
  Array<{ sessionId: string; gameDateUtc: string; gameDateLocal: string; sessionType: string; location: string | null; state: string | null }>
> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrackmanLiveSchema();
  const result = await getDbPool().query(
    `SELECT session_id, session_type, state, venue_name, field_name,
            COALESCE(started_at, event_time, received_at) AS session_time
     FROM trackman_live_sessions
     WHERE COALESCE(started_at, event_time, received_at) >= NOW() - INTERVAL '2 days'
     ORDER BY COALESCE(started_at, event_time, received_at) DESC`
  );
  return result.rows.map((row) => {
    const date = new Date(row.session_time);
    return {
      sessionId: row.session_id,
      gameDateUtc: date.toISOString(),
      gameDateLocal: date.toISOString(),
      sessionType: row.session_type ?? 'Practice',
      location: [row.venue_name, row.field_name].filter(Boolean).join(' — ') || null,
      state: row.state ?? null,
    };
  });
}

export async function listBufferedTrackmanPitches(sessionId: string): Promise<NormalizedTrackmanPitch[]> {
  if (!isDatabaseConfigured()) return [];
  await ensureTrackmanLiveSchema();
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT play_id, session_id, track_id, tracked_at, received_at, plate_loc_side_ft, plate_loc_height_ft,
            rel_speed_mph, induced_vert_break_in, horz_break_in, pitch_type, pitcher_throws, tagged_pitcher_name,
            raw_payload
     FROM trackman_live_ball_events
     WHERE session_id = $1 AND kind = 'Pitch'
     ORDER BY COALESCE(tracked_at, received_at) ASC, received_at ASC`,
    [sessionId]
  );
  const repairedRows = result.rows.map((row) => {
    // Re-normalizing the durable raw event makes the unit fix self-healing for
    // pitches received before this correction was deployed. Force Kind because
    // a later metadata event may have replaced that top-level property when the
    // two payloads were merged.
    const raw = object(row.raw_payload);
    const normalized = normalizeTrackmanPitch(raw ? { ...raw, Kind: 'Pitch' } : null);
    const storedNumbers = {
      plateLocSideFt: row.plate_loc_side_ft === null ? null : Number(row.plate_loc_side_ft),
      plateLocHeightFt: row.plate_loc_height_ft === null ? null : Number(row.plate_loc_height_ft),
      relSpeedMph: row.rel_speed_mph === null ? null : Number(row.rel_speed_mph),
      inducedVertBreakIn: row.induced_vert_break_in === null ? null : Number(row.induced_vert_break_in),
      horzBreakIn: row.horz_break_in === null ? null : Number(row.horz_break_in),
    };
    const pitch: NormalizedTrackmanPitch = {
      sessionId: row.session_id,
      playId: row.play_id,
      trackId: normalized?.trackId ?? row.track_id,
      trackedAt: normalized?.trackedAt ?? (row.tracked_at ? new Date(row.tracked_at).toISOString() : null),
      receivedAt: row.received_at ? new Date(row.received_at).toISOString() : null,
      plateLocSideFt: normalized?.plateLocSideFt ?? storedNumbers.plateLocSideFt,
      plateLocHeightFt: normalized?.plateLocHeightFt ?? storedNumbers.plateLocHeightFt,
      relSpeedMph: normalized?.relSpeedMph ?? storedNumbers.relSpeedMph,
      inducedVertBreakIn: normalized?.inducedVertBreakIn ?? storedNumbers.inducedVertBreakIn,
      horzBreakIn: normalized?.horzBreakIn ?? storedNumbers.horzBreakIn,
      pitchType: normalized?.pitchType ?? row.pitch_type,
      pitcherThrows: normalized?.pitcherThrows ?? row.pitcher_throws,
      taggedPitcherName: normalized?.taggedPitcherName ?? row.tagged_pitcher_name,
      flightData: normalized?.flightData ?? null,
    };
    const repaired = Boolean(
      normalized &&
        (Object.keys(storedNumbers) as Array<keyof typeof storedNumbers>).some((key) => {
          const before = storedNumbers[key];
          const after = normalized[key];
          if (before === null || after === null) return before !== after;
          return Math.abs(before - after) > 0.000001;
        })
    );
    return { pitch, repaired };
  });

  // Persist corrected values as well as returning them, so all later readers
  // see the repaired event and not only this live-page poll.
  await Promise.all(
    repairedRows
      .filter(({ repaired }) => repaired)
      .map(({ pitch }) =>
        pool.query(
          `UPDATE trackman_live_ball_events SET
             track_id = COALESCE($2, track_id),
             tracked_at = COALESCE($3, tracked_at),
             plate_loc_side_ft = $4,
             plate_loc_height_ft = $5,
             rel_speed_mph = $6,
             induced_vert_break_in = $7,
             horz_break_in = $8,
             updated_at = NOW()
           WHERE play_id = $1`,
          [
            pitch.playId,
            pitch.trackId,
            pitch.trackedAt,
            pitch.plateLocSideFt,
            pitch.plateLocHeightFt,
            pitch.relSpeedMph,
            pitch.inducedVertBreakIn,
            pitch.horzBreakIn,
          ]
        )
      )
  );

  return repairedRows.map(({ pitch }) => pitch);
}
