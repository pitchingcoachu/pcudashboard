import type { PoolClient } from 'pg';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from './auth-db';

export type SessionTypeValue = 'bullpen' | 'regular';

export type BookingSlot = {
  id: number;
  sessionType: SessionTypeValue;
  startsAt: string;
  capacity: number;
  location: string;
  status: 'open' | 'closed' | 'cancelled';
  bookedCount: number;
  myBookingId: number | null;
  attendees: Array<{ bookingId: number; playerId: number; playerName: string }>;
};

let bookingTablesReady = false;

export async function ensureBookingTables(): Promise<void> {
  if (bookingTablesReady || !isDatabaseConfigured()) return;
  await ensureAuthDbReady();
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_slots (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 100),
      location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
      created_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (ends_at >= starts_at)
    );
  `);
  // Migrate away from the old coach/session-type-catalog schema, if present.
  await pool.query(`ALTER TABLE booking_slots ADD COLUMN IF NOT EXISTS session_type TEXT;`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='booking_slots' AND column_name='session_type_id')
         AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='booking_session_types') THEN
        UPDATE booking_slots s SET session_type = CASE WHEN LOWER(t.name) = 'bullpen' THEN 'bullpen' ELSE 'regular' END
        FROM booking_session_types t WHERE t.id = s.session_type_id AND s.session_type IS NULL;
      END IF;
    END $$;
  `);
  await pool.query(`UPDATE booking_slots SET session_type='regular' WHERE session_type IS NULL;`);
  await pool.query(`ALTER TABLE booking_slots ALTER COLUMN session_type SET NOT NULL;`);
  await pool.query(`ALTER TABLE booking_slots ALTER COLUMN session_type SET DEFAULT 'regular';`);
  // The original table was created with CHECK (ends_at > starts_at); bullpen/point-in-time
  // slots now use ends_at = starts_at, so relax this to >= if the old stricter constraint is present.
  await pool.query(`ALTER TABLE booking_slots DROP CONSTRAINT IF EXISTS booking_slots_check;`);
  await pool.query(`ALTER TABLE booking_slots ADD CONSTRAINT booking_slots_check CHECK (ends_at >= starts_at);`);
  await pool.query(`ALTER TABLE booking_slots DROP CONSTRAINT IF EXISTS booking_slots_session_type_check;`);
  await pool.query(`ALTER TABLE booking_slots ADD CONSTRAINT booking_slots_session_type_check CHECK (session_type IN ('bullpen','regular'));`);
  await pool.query(`ALTER TABLE booking_slots DROP CONSTRAINT IF EXISTS booking_slots_coach_user_id_fkey;`);
  await pool.query(`ALTER TABLE booking_slots DROP CONSTRAINT IF EXISTS booking_slots_session_type_id_fkey;`);
  await pool.query(`ALTER TABLE booking_slots DROP COLUMN IF EXISTS coach_user_id;`);
  await pool.query(`ALTER TABLE booking_slots DROP COLUMN IF EXISTS session_type_id;`);
  await pool.query(`DROP INDEX IF EXISTS uq_booking_slot_identity;`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_slot_identity ON booking_slots (organization_id, session_type, starts_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_booking_slots_org_start ON booking_slots (organization_id, starts_at);`);
  await pool.query(`DROP TABLE IF EXISTS booking_session_types;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS session_bookings (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      slot_id BIGINT NOT NULL REFERENCES booking_slots(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      player_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'attended', 'no_show')),
      booked_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      cancelled_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      cancelled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_session_booking_active_player ON session_bookings (slot_id, player_id) WHERE status IN ('booked', 'attended');`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_session_bookings_slot_status ON session_bookings (slot_id, status);`);
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS min_booking_lead_hours INTEGER NOT NULL DEFAULT 4;`);
  bookingTablesReady = true;
}

export async function getMinBookingLeadHours(organizationId: number): Promise<number> {
  await ensureBookingTables();
  const result = await getDbPool().query<{ min_booking_lead_hours: number }>(
    `SELECT min_booking_lead_hours FROM organizations WHERE id=$1`, [organizationId]
  );
  return Number(result.rows[0]?.min_booking_lead_hours ?? 4);
}

export async function setMinBookingLeadHours(organizationId: number, hours: number): Promise<number> {
  await ensureBookingTables();
  const clamped = Math.min(336, Math.max(0, Math.round(hours)));
  await getDbPool().query(`UPDATE organizations SET min_booking_lead_hours=$2, updated_at=NOW() WHERE id=$1`, [organizationId, clamped]);
  return clamped;
}

export async function listBookingPlayers(organizationId: number): Promise<Array<{ id: number; name: string; userId: number | null }>> {
  await ensureBookingTables();
  const result = await getDbPool().query(
    `SELECT id, full_name, user_id FROM players WHERE organization_id=$1
     AND LOWER(COALESCE(NULLIF(TRIM(status),''),'active'))='active' ORDER BY full_name`, [organizationId]
  );
  return result.rows.map((row) => ({ id: Number(row.id), name: row.full_name, userId: row.user_id ? Number(row.user_id) : null }));
}

export async function createBookingSlots(input: {
  organizationId: number; userId: number; sessionType: SessionTypeValue;
  starts: Array<{ startsAt: string; endsAt: string }>; capacity: number; location?: string;
}): Promise<number> {
  await ensureBookingTables();
  const pool = getDbPool();
  let created = 0;
  for (const item of input.starts) {
    const result = await pool.query(
      `INSERT INTO booking_slots (organization_id,session_type,starts_at,ends_at,capacity,location,created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id,session_type,starts_at) DO NOTHING RETURNING id`,
      [input.organizationId, input.sessionType, item.startsAt, item.endsAt, input.capacity,
        input.location?.trim() || '', input.userId || null]
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

export async function listBookingSlots(input: {
  organizationId: number; startDate: string; endDate: string; playerId: number | null; staff: boolean;
}): Promise<BookingSlot[]> {
  await ensureBookingTables();
  // Regular Training slots on the same clock hour (Phoenix-local) share one capacity pool.
  // Bullpen slots are never pooled -- each keeps its own independent capacity/booked count.
  // A bullpen booking also counts as 1 phantom booking against the Regular Training pool for
  // the hour that starts ~1 hour before the bullpen time (the player will already be arriving then).
  const result = await getDbPool().query(
    `WITH base AS (
       SELECT s.id, s.session_type, s.starts_at, s.capacity, s.location, s.status,
         DATE_TRUNC('hour', s.starts_at AT TIME ZONE 'America/Phoenix') AS hour_bucket,
         COUNT(b.id) FILTER (WHERE b.status IN ('booked','attended'))::int AS own_booked_count,
         MAX(b.id) FILTER (WHERE b.player_id=$4 AND b.status IN ('booked','attended')) AS my_booking_id,
         COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('bookingId',b.id,'playerId',b.player_id,'playerName',p.full_name)
           ORDER BY p.full_name) FILTER (WHERE b.id IS NOT NULL AND b.status IN ('booked','attended')), '[]'::jsonb) AS attendees
       FROM booking_slots s
       LEFT JOIN session_bookings b ON b.slot_id=s.id AND b.status IN ('booked','attended') LEFT JOIN players p ON p.id=b.player_id
       WHERE s.organization_id=$1 AND s.starts_at >= ($2::date AT TIME ZONE 'America/Phoenix')
         AND s.starts_at < (($3::date + 1) AT TIME ZONE 'America/Phoenix')
         ${input.staff ? '' : "AND s.ends_at>NOW() AND (s.status='open' OR EXISTS (SELECT 1 FROM session_bookings own WHERE own.slot_id=s.id AND own.player_id=$4 AND own.status IN ('booked','attended')))"}
       GROUP BY s.id,s.session_type,s.starts_at,s.capacity,s.location,s.status
     ),
     bullpen_spillover AS (
       SELECT DATE_TRUNC('hour', (s.starts_at AT TIME ZONE 'America/Phoenix') - INTERVAL '1 hour') AS hour_bucket,
         COUNT(b.id)::int AS spillover_count
       FROM booking_slots s JOIN session_bookings b ON b.slot_id=s.id AND b.status IN ('booked','attended')
       WHERE s.organization_id=$1 AND s.session_type='bullpen'
       GROUP BY 1
     )
     SELECT base.id, base.session_type, base.starts_at, base.capacity, base.location, base.status, base.my_booking_id, base.attendees,
       CASE WHEN base.session_type='regular'
         THEN SUM(base.own_booked_count) OVER (PARTITION BY base.session_type, base.hour_bucket)
           + COALESCE(MAX(spill.spillover_count) OVER (PARTITION BY base.session_type, base.hour_bucket), 0)
         ELSE base.own_booked_count END AS booked_count
     FROM base LEFT JOIN bullpen_spillover spill ON spill.hour_bucket=base.hour_bucket
     ORDER BY base.starts_at`,
    [input.organizationId, input.startDate, input.endDate, input.playerId ?? 0]
  );
  return result.rows.map((row) => ({
    id: Number(row.id), sessionType: row.session_type as SessionTypeValue,
    startsAt: new Date(row.starts_at).toISOString(), capacity: Number(row.capacity),
    location: row.location ?? '', status: row.status, bookedCount: Number(row.booked_count),
    myBookingId: row.my_booking_id ? Number(row.my_booking_id) : null, attendees: input.staff ? row.attendees : [],
  }));
}

const MAX_ADVANCE_BOOKING_DAYS = 60;

async function resolvePlayer(client: PoolClient, organizationId: number, playerId: number) {
  const result = await client.query(`SELECT id, user_id, full_name FROM players WHERE id=$1 AND organization_id=$2 LIMIT 1`, [playerId, organizationId]);
  if (!result.rows[0]) throw new Error('Player not found.');
  return result.rows[0] as { id: number; user_id: number | null; full_name: string };
}

type BookSlotResult = {
  bookingId: number; playerUserId: number | null; playerName: string;
  sessionType: SessionTypeValue; startsAt: string;
};

/**
 * Core "book this slot for this player" logic, callable within an existing transaction so
 * reschedule/recurring-booking flows can compose it with other locked operations. Caller owns
 * BEGIN/COMMIT/ROLLBACK. Excludes a booking id (`excludeBookingId`) from the conflict/capacity
 * checks so a reschedule can re-book the same or an overlapping-adjacent slot cleanly.
 */
async function bookSlotWithClient(
  client: PoolClient,
  input: { organizationId: number; slotId: number; playerId: number; bookedByUserId: number; excludeBookingId?: number; override?: boolean }
): Promise<BookSlotResult> {
  const slotResult = await client.query(
    `SELECT id,capacity,status,starts_at,ends_at,session_type FROM booking_slots WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
    [input.slotId, input.organizationId]
  );
  const slot = slotResult.rows[0];
  if (!slot || slot.status !== 'open') throw new Error('This time is no longer available.');
  if (new Date(slot.starts_at).getTime() <= Date.now()) throw new Error('This session has already started.');
  if (new Date(slot.starts_at).getTime() > Date.now() + MAX_ADVANCE_BOOKING_DAYS * 86400000) {
    throw new Error(`This time is more than ${MAX_ADVANCE_BOOKING_DAYS} days out — booking opens closer to the date.`);
  }
  if (!input.override) {
    const orgResult = await client.query<{ min_booking_lead_hours: number }>(
      `SELECT min_booking_lead_hours FROM organizations WHERE id=$1`, [input.organizationId]
    );
    const leadHours = Number(orgResult.rows[0]?.min_booking_lead_hours ?? 4);
    if (leadHours > 0 && new Date(slot.starts_at).getTime() < Date.now() + leadHours * 3600000) {
      throw new Error(`This time must be booked at least ${leadHours} hour${leadHours === 1 ? '' : 's'} in advance.`);
    }
  }
  const player = await resolvePlayer(client, input.organizationId, input.playerId);
  const conflict = await client.query(
    `SELECT 1 FROM session_bookings existing_booking JOIN booking_slots existing_slot ON existing_slot.id=existing_booking.slot_id
     WHERE existing_booking.player_id=$1 AND existing_booking.status IN ('booked','attended')
       AND existing_booking.id <> $4
       AND existing_slot.starts_at < $3::timestamptz AND existing_slot.ends_at > $2::timestamptz LIMIT 1`,
    [input.playerId, slot.starts_at, slot.ends_at, input.excludeBookingId ?? 0]
  );
  if (conflict.rows[0]) throw new Error('This player already has a session during that time.');

  if (slot.session_type === 'regular') {
    // Regular Training slots on the same clock hour share one capacity pool -- lock every
    // sibling slot in that hour bucket (not just this row) before counting, so two concurrent
    // bookings against different half-hour slots in the same hour can't jointly overbook the pool.
    const siblings = await client.query(
      `SELECT id FROM booking_slots
       WHERE organization_id=$1 AND session_type='regular'
         AND DATE_TRUNC('hour', starts_at AT TIME ZONE 'America/Phoenix')
           = DATE_TRUNC('hour', $2::timestamptz AT TIME ZONE 'America/Phoenix')
       ORDER BY id FOR UPDATE`,
      [input.organizationId, slot.starts_at]
    );
    const siblingIds = siblings.rows.map((row) => Number(row.id));
    const count = await client.query(
      `SELECT COUNT(*)::int AS count FROM session_bookings WHERE slot_id = ANY($1::bigint[]) AND status IN ('booked','attended') AND id <> $2`,
      [siblingIds, input.excludeBookingId ?? 0]
    );
    // A bullpen booking an hour later counts as 1 phantom booking against this Regular Training pool.
    const spillover = await client.query(
      `SELECT COUNT(*)::int AS count FROM booking_slots bs JOIN session_bookings bb ON bb.slot_id=bs.id AND bb.status IN ('booked','attended')
       WHERE bs.organization_id=$1 AND bs.session_type='bullpen'
         AND DATE_TRUNC('hour', (bs.starts_at AT TIME ZONE 'America/Phoenix') - INTERVAL '1 hour')
           = DATE_TRUNC('hour', $2::timestamptz AT TIME ZONE 'America/Phoenix')`,
      [input.organizationId, slot.starts_at]
    );
    const totalBooked = Number(count.rows[0]?.count ?? 0) + Number(spillover.rows[0]?.count ?? 0);
    if (totalBooked >= Number(slot.capacity)) throw new Error('This session just filled up.');
  } else {
    const count = await client.query(
      `SELECT COUNT(*)::int AS count FROM session_bookings WHERE slot_id=$1 AND status IN ('booked','attended') AND id <> $2`,
      [input.slotId, input.excludeBookingId ?? 0]
    );
    if (Number(count.rows[0]?.count ?? 0) >= Number(slot.capacity)) throw new Error('This session just filled up.');
  }

  const created = await client.query(
    `INSERT INTO session_bookings (organization_id,slot_id,player_id,player_user_id,booked_by_user_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING id`, [input.organizationId, input.slotId, input.playerId, player.user_id, input.bookedByUserId]
  );
  return {
    bookingId: Number(created.rows[0].id), playerUserId: player.user_id ? Number(player.user_id) : null,
    playerName: player.full_name, sessionType: slot.session_type as SessionTypeValue,
    startsAt: new Date(slot.starts_at).toISOString(),
  };
}

export async function bookSessionSlot(input: { organizationId: number; slotId: number; playerId: number; bookedByUserId: number; override?: boolean }) {
  await ensureBookingTables();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const result = await bookSlotWithClient(client, input);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error && 'code' in error && String((error as { code?: unknown }).code) === '23505') throw new Error('This player is already booked for that session.');
    throw error;
  } finally { client.release(); }
}

export async function rescheduleSessionBooking(input: {
  organizationId: number; bookingId: number; newSlotId: number; userId: number; playerId: number | null; staff: boolean; override?: boolean;
}) {
  await ensureBookingTables();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const existing = await client.query(
      `SELECT b.id, b.player_id, s.starts_at AS old_starts_at, s.session_type AS old_session_type
       FROM session_bookings b JOIN booking_slots s ON s.id=b.slot_id
       WHERE b.id=$1 AND b.organization_id=$2 AND b.status='booked' ${input.staff ? '' : 'AND b.player_id=$3'} FOR UPDATE`,
      input.staff ? [input.bookingId, input.organizationId] : [input.bookingId, input.organizationId, input.playerId ?? 0]
    );
    const old = existing.rows[0];
    if (!old) throw new Error('Booking not found or already cancelled.');

    const result = await bookSlotWithClient(client, {
      organizationId: input.organizationId, slotId: input.newSlotId, playerId: Number(old.player_id),
      bookedByUserId: input.userId, excludeBookingId: Number(old.id), override: input.override,
    });

    await client.query(
      `UPDATE session_bookings SET status='cancelled',cancelled_by_user_id=$2,cancelled_at=NOW(),updated_at=NOW() WHERE id=$1`,
      [old.id, input.userId]
    );

    await client.query('COMMIT');
    return { ...result, oldStartsAt: new Date(old.old_starts_at).toISOString(), oldSessionType: old.old_session_type as SessionTypeValue };
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error && 'code' in error && String((error as { code?: unknown }).code) === '23505') throw new Error('That player is already booked for that session.');
    throw error;
  } finally { client.release(); }
}

export type RecurringBookingResult = { startsAt: string; status: 'booked' | 'unavailable'; reason?: string; bookingId?: number };

export async function bookRecurringWeekly(input: {
  organizationId: number; playerId: number; bookedByUserId: number; firstSlotId: number; weeks: number; override?: boolean;
}): Promise<RecurringBookingResult[]> {
  await ensureBookingTables();
  const pool = getDbPool();
  const firstSlot = await pool.query(
    `SELECT starts_at, session_type FROM booking_slots WHERE id=$1 AND organization_id=$2`,
    [input.firstSlotId, input.organizationId]
  );
  if (!firstSlot.rows[0]) throw new Error('Time not found.');
  if (firstSlot.rows[0].session_type !== 'regular') throw new Error('Recurring weekly booking is only available for Regular Training.');
  const firstStart = new Date(firstSlot.rows[0].starts_at);

  const results: RecurringBookingResult[] = [];
  for (let week = 0; week < input.weeks; week += 1) {
    const targetTime = new Date(firstStart.getTime() + week * 7 * 86400000);
    if (targetTime.getTime() > Date.now() + MAX_ADVANCE_BOOKING_DAYS * 86400000) {
      results.push({ startsAt: targetTime.toISOString(), status: 'unavailable', reason: 'Beyond the 60-day booking window.' });
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const match = await client.query(
        `SELECT id FROM booking_slots WHERE organization_id=$1 AND session_type='regular' AND starts_at=$2::timestamptz`,
        [input.organizationId, targetTime.toISOString()]
      );
      if (!match.rows[0]) {
        await client.query('ROLLBACK');
        results.push({ startsAt: targetTime.toISOString(), status: 'unavailable', reason: 'This time is not published that week.' });
        continue;
      }
      const booked = await bookSlotWithClient(client, {
        organizationId: input.organizationId, slotId: Number(match.rows[0].id), playerId: input.playerId, bookedByUserId: input.bookedByUserId, override: input.override,
      });
      await client.query('COMMIT');
      results.push({ startsAt: booked.startsAt, status: 'booked', bookingId: booked.bookingId });
    } catch (error) {
      await client.query('ROLLBACK');
      results.push({ startsAt: targetTime.toISOString(), status: 'unavailable', reason: error instanceof Error ? error.message : 'Unable to book.' });
    } finally { client.release(); }
  }
  return results;
}

export async function cancelSessionBooking(input: { organizationId: number; bookingId: number; userId: number; playerId: number | null; staff: boolean }) {
  await ensureBookingTables();
  const result = await getDbPool().query(
    `UPDATE session_bookings b SET status='cancelled',cancelled_by_user_id=$3,cancelled_at=NOW(),updated_at=NOW()
     FROM booking_slots s, players p
     WHERE b.id=$1 AND b.organization_id=$2 AND s.id=b.slot_id AND p.id=b.player_id
       AND b.status='booked' ${input.staff ? '' : 'AND b.player_id=$4'}
     RETURNING b.id,b.player_user_id,b.player_id,p.full_name,s.session_type,s.starts_at`,
    [input.bookingId, input.organizationId, input.userId, input.playerId ?? 0]
  );
  if (!result.rows[0]) throw new Error('Booking not found or already cancelled.');
  const row = result.rows[0];
  return {
    bookingId: Number(row.id), playerUserId: row.player_user_id ? Number(row.player_user_id) : null, playerId: Number(row.player_id),
    playerName: row.full_name, sessionType: row.session_type as SessionTypeValue, startsAt: new Date(row.starts_at).toISOString(),
  };
}

export async function updateBookingSlotStatus(input: { organizationId: number; slotId: number; status: 'open' | 'closed' | 'cancelled' }) {
  await ensureBookingTables();
  const result = await getDbPool().query(`UPDATE booking_slots SET status=$3,updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING id`, [input.slotId, input.organizationId, input.status]);
  if (!result.rows[0]) throw new Error('Session slot not found.');
}
