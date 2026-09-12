import type { PoolClient } from 'pg';
import { ensureAuthDbReady, getDbPool, isDatabaseConfigured } from './auth-db';

export type BookingSessionType = {
  id: number;
  name: string;
  description: string;
  durationMinutes: number;
  defaultCapacity: number;
  location: string;
  active: boolean;
};

export type BookingSlot = {
  id: number;
  sessionTypeId: number;
  sessionTypeName: string;
  description: string;
  coachUserId: number;
  coachName: string;
  startsAt: string;
  endsAt: string;
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
    CREATE TABLE IF NOT EXISTS booking_session_types (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      duration_minutes INTEGER NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 10 AND 480),
      default_capacity INTEGER NOT NULL DEFAULT 1 CHECK (default_capacity BETWEEN 1 AND 100),
      location TEXT NOT NULL DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_session_types_org_name ON booking_session_types (organization_id, LOWER(name));`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS booking_slots (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      session_type_id BIGINT NOT NULL REFERENCES booking_session_types(id) ON DELETE CASCADE,
      coach_user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity BETWEEN 1 AND 100),
      location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'cancelled')),
      created_by_user_id INTEGER REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (ends_at > starts_at)
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_booking_slot_identity ON booking_slots (organization_id, session_type_id, coach_user_id, starts_at);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_booking_slots_org_start ON booking_slots (organization_id, starts_at);`);
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
  bookingTablesReady = true;
}

export async function ensureDefaultSessionTypes(organizationId: number, userId: number, facilityName = 'PCU Facility'): Promise<void> {
  await ensureBookingTables();
  const pool = getDbPool();
  const defaults = [
    ['Bullpen', 'Mound work, pitch execution, and session feedback.', 60, 4, facilityName],
    ['Pitch Design', 'Focused pitch-shape development and testing.', 60, 2, 'Pitch Design Lab'],
    ['Hitting', 'Individual or small-group hitting session.', 60, 4, facilityName],
    ['Assessment', 'Baseline evaluation and player development review.', 60, 1, facilityName],
  ] as const;
  for (const [name, description, duration, capacity, location] of defaults) {
    await pool.query(
      `INSERT INTO booking_session_types (organization_id, name, description, duration_minutes, default_capacity, location, created_by_user_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT DO NOTHING`,
      [organizationId, name, description, duration, capacity, location, userId || null]
    );
  }
}

export async function listBookingSessionTypes(organizationId: number, includeInactive = false): Promise<BookingSessionType[]> {
  await ensureBookingTables();
  const result = await getDbPool().query(
    `SELECT id, name, description, duration_minutes, default_capacity, location, active
     FROM booking_session_types WHERE organization_id = $1 ${includeInactive ? '' : 'AND active = TRUE'} ORDER BY active DESC, name`,
    [organizationId]
  );
  return result.rows.map((row) => ({
    id: Number(row.id), name: row.name, description: row.description ?? '', durationMinutes: Number(row.duration_minutes),
    defaultCapacity: Number(row.default_capacity), location: row.location ?? '', active: Boolean(row.active),
  }));
}

export async function saveBookingSessionType(input: {
  organizationId: number; userId: number; id?: number; name: string; description?: string;
  durationMinutes: number; defaultCapacity: number; location?: string; active?: boolean;
}): Promise<number> {
  await ensureBookingTables();
  const values = [input.organizationId, input.name.trim(), input.description?.trim() ?? '', input.durationMinutes,
    input.defaultCapacity, input.location?.trim() ?? '', input.active !== false, input.userId || null];
  if (input.id) {
    const updated = await getDbPool().query(
      `UPDATE booking_session_types SET name=$2, description=$3, duration_minutes=$4, default_capacity=$5, location=$6,
       active=$7, updated_at=NOW() WHERE id=$9 AND organization_id=$1 RETURNING id`, [...values, input.id]
    );
    if (!updated.rows[0]) throw new Error('Session type not found.');
    return Number(updated.rows[0].id);
  }
  const created = await getDbPool().query(
    `INSERT INTO booking_session_types (organization_id,name,description,duration_minutes,default_capacity,location,active,created_by_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, values
  );
  return Number(created.rows[0].id);
}

export async function listBookingStaff(organizationId: number): Promise<Array<{ id: number; name: string }>> {
  await ensureBookingTables();
  const result = await getDbPool().query(
    `SELECT id, COALESCE(NULLIF(TRIM(name),''), email) AS name FROM auth_users
     WHERE organization_id=$1 AND role IN ('admin','coach') AND COALESCE(is_active,TRUE)=TRUE ORDER BY name`, [organizationId]
  );
  return result.rows.map((row) => ({ id: Number(row.id), name: row.name }));
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
  organizationId: number; userId: number; sessionTypeId: number; coachUserId: number;
  starts: Array<{ startsAt: string; endsAt: string }>; capacity: number; location?: string;
}): Promise<number> {
  await ensureBookingTables();
  const pool = getDbPool();
  const type = await pool.query(`SELECT id, location FROM booking_session_types WHERE id=$1 AND organization_id=$2 AND active=TRUE`, [input.sessionTypeId, input.organizationId]);
  if (!type.rows[0]) throw new Error('Session type not found.');
  const coach = await pool.query(`SELECT id FROM auth_users WHERE id=$1 AND organization_id=$2 AND role IN ('admin','coach') AND COALESCE(is_active,TRUE)=TRUE`, [input.coachUserId, input.organizationId]);
  if (!coach.rows[0]) throw new Error('Coach not found.');
  let created = 0;
  for (const item of input.starts) {
    const result = await pool.query(
      `INSERT INTO booking_slots (organization_id,session_type_id,coach_user_id,starts_at,ends_at,capacity,location,created_by_user_id)
       SELECT $1,$2,$3,$4,$5,$6,$7,$8
       WHERE NOT EXISTS (
         SELECT 1 FROM booking_slots existing WHERE existing.organization_id=$1 AND existing.coach_user_id=$3
           AND existing.status<>'cancelled' AND existing.starts_at < $5::timestamptz AND existing.ends_at > $4::timestamptz
       )
       ON CONFLICT (organization_id,session_type_id,coach_user_id,starts_at) DO NOTHING RETURNING id`,
      [input.organizationId, input.sessionTypeId, input.coachUserId, item.startsAt, item.endsAt, input.capacity,
        input.location?.trim() || type.rows[0].location || '', input.userId || null]
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

export async function listBookingSlots(input: {
  organizationId: number; startDate: string; endDate: string; userId: number; playerId: number | null; staff: boolean;
}): Promise<BookingSlot[]> {
  await ensureBookingTables();
  const result = await getDbPool().query(
    `SELECT s.id, s.session_type_id, t.name AS session_type_name, t.description, s.coach_user_id,
       COALESCE(NULLIF(TRIM(u.name),''),u.email) AS coach_name, s.starts_at, s.ends_at, s.capacity, s.location, s.status,
       COUNT(b.id) FILTER (WHERE b.status IN ('booked','attended'))::int AS booked_count,
       MAX(b.id) FILTER (WHERE b.player_id=$4 AND b.status IN ('booked','attended')) AS my_booking_id,
       COALESCE(JSONB_AGG(JSONB_BUILD_OBJECT('bookingId',b.id,'playerId',b.player_id,'playerName',p.full_name)
         ORDER BY p.full_name) FILTER (WHERE b.id IS NOT NULL AND b.status IN ('booked','attended')), '[]'::jsonb) AS attendees
     FROM booking_slots s JOIN booking_session_types t ON t.id=s.session_type_id JOIN auth_users u ON u.id=s.coach_user_id
     LEFT JOIN session_bookings b ON b.slot_id=s.id AND b.status IN ('booked','attended') LEFT JOIN players p ON p.id=b.player_id
     WHERE s.organization_id=$1 AND s.starts_at >= ($2::date AT TIME ZONE 'America/Phoenix')
       AND s.starts_at < (($3::date + 1) AT TIME ZONE 'America/Phoenix')
       ${input.staff ? '' : "AND t.active=TRUE AND s.ends_at>NOW() AND (s.status='open' OR EXISTS (SELECT 1 FROM session_bookings own WHERE own.slot_id=s.id AND own.player_id=$4 AND own.status IN ('booked','attended')))"}
     GROUP BY s.id,s.session_type_id,s.coach_user_id,s.starts_at,s.ends_at,s.capacity,s.location,s.status,
       t.id,t.name,t.description,u.id,u.name,u.email
     ORDER BY s.starts_at,s.session_type_id`,
    [input.organizationId, input.startDate, input.endDate, input.playerId ?? 0]
  );
  return result.rows.map((row) => ({
    id:Number(row.id), sessionTypeId:Number(row.session_type_id), sessionTypeName:row.session_type_name,
    description:row.description ?? '', coachUserId:Number(row.coach_user_id), coachName:row.coach_name,
    startsAt:new Date(row.starts_at).toISOString(), endsAt:new Date(row.ends_at).toISOString(), capacity:Number(row.capacity),
    location:row.location ?? '', status:row.status, bookedCount:Number(row.booked_count),
    myBookingId:row.my_booking_id ? Number(row.my_booking_id) : null, attendees:input.staff ? row.attendees : [],
  }));
}

async function resolvePlayer(client: PoolClient, organizationId: number, playerId: number) {
  const result = await client.query(`SELECT id, user_id, full_name FROM players WHERE id=$1 AND organization_id=$2 LIMIT 1`, [playerId, organizationId]);
  if (!result.rows[0]) throw new Error('Player not found.');
  return result.rows[0] as { id: number; user_id: number | null; full_name: string };
}

export async function bookSessionSlot(input: { organizationId: number; slotId: number; playerId: number; bookedByUserId: number }) {
  await ensureBookingTables();
  const client = await getDbPool().connect();
  try {
    await client.query('BEGIN');
    const slotResult = await client.query(
      `SELECT s.id,s.capacity,s.status,s.starts_at,s.ends_at,s.coach_user_id,t.name FROM booking_slots s JOIN booking_session_types t ON t.id=s.session_type_id
       WHERE s.id=$1 AND s.organization_id=$2 FOR UPDATE`, [input.slotId,input.organizationId]
    );
    const slot = slotResult.rows[0];
    if (!slot || slot.status !== 'open') throw new Error('This time is no longer available.');
    if (new Date(slot.starts_at).getTime() <= Date.now()) throw new Error('This session has already started.');
    const player = await resolvePlayer(client,input.organizationId,input.playerId);
    const conflict = await client.query(
      `SELECT 1 FROM session_bookings existing_booking JOIN booking_slots existing_slot ON existing_slot.id=existing_booking.slot_id
       WHERE existing_booking.player_id=$1 AND existing_booking.status IN ('booked','attended')
         AND existing_slot.starts_at < $3::timestamptz AND existing_slot.ends_at > $2::timestamptz LIMIT 1`,
      [input.playerId,slot.starts_at,slot.ends_at]
    );
    if(conflict.rows[0]) throw new Error('This player already has a session during that time.');
    const count = await client.query(`SELECT COUNT(*)::int AS count FROM session_bookings WHERE slot_id=$1 AND status IN ('booked','attended')`, [input.slotId]);
    if (Number(count.rows[0]?.count ?? 0) >= Number(slot.capacity)) throw new Error('This session just filled up.');
    const created = await client.query(
      `INSERT INTO session_bookings (organization_id,slot_id,player_id,player_user_id,booked_by_user_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`, [input.organizationId,input.slotId,input.playerId,player.user_id,input.bookedByUserId]
    );
    await client.query('COMMIT');
    return { bookingId:Number(created.rows[0].id), playerUserId:player.user_id ? Number(player.user_id) : null,
      playerName:player.full_name, coachUserId:Number(slot.coach_user_id), sessionName:slot.name,
      startsAt:new Date(slot.starts_at).toISOString() };
  } catch (error) {
    await client.query('ROLLBACK');
    if (typeof error === 'object' && error && 'code' in error && String((error as {code?:unknown}).code)==='23505') throw new Error('This player is already booked for that session.');
    throw error;
  } finally { client.release(); }
}

export async function cancelSessionBooking(input: { organizationId:number; bookingId:number; userId:number; playerId:number|null; staff:boolean }) {
  await ensureBookingTables();
  const result = await getDbPool().query(
    `UPDATE session_bookings b SET status='cancelled',cancelled_by_user_id=$3,cancelled_at=NOW(),updated_at=NOW()
     FROM booking_slots s, booking_session_types t, players p
     WHERE b.id=$1 AND b.organization_id=$2 AND s.id=b.slot_id AND t.id=s.session_type_id AND p.id=b.player_id
       AND b.status='booked' ${input.staff ? '' : 'AND b.player_id=$4'}
     RETURNING b.id,b.player_user_id,b.player_id,p.full_name,s.coach_user_id,s.starts_at,t.name`,
    [input.bookingId,input.organizationId,input.userId,input.playerId ?? 0]
  );
  if (!result.rows[0]) throw new Error('Booking not found or already cancelled.');
  const row=result.rows[0];
  return { bookingId:Number(row.id),playerUserId:row.player_user_id?Number(row.player_user_id):null,playerId:Number(row.player_id),
    playerName:row.full_name,coachUserId:Number(row.coach_user_id),startsAt:new Date(row.starts_at).toISOString(),sessionName:row.name };
}

export async function updateBookingSlotStatus(input:{organizationId:number;slotId:number;status:'open'|'closed'|'cancelled'}) {
  await ensureBookingTables();
  const result=await getDbPool().query(`UPDATE booking_slots SET status=$3,updated_at=NOW() WHERE id=$1 AND organization_id=$2 RETURNING id`,[input.slotId,input.organizationId,input.status]);
  if(!result.rows[0]) throw new Error('Session slot not found.');
}
