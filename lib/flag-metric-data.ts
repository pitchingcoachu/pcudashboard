import { getDbPool } from './auth-db';

type FlagDomain = 'pitching' | 'hitting';

const numericSql = (column: string) => `(regexp_match(COALESCE(${column}::text, ''), '[-+]?[0-9]*\\.?[0-9]+'))[1]::double precision`;

export async function loadFlagMetricPoints(input: {
  schoolCode: string;
  startDate: string;
  endDate: string;
  domains: FlagDomain[];
}): Promise<{ pitching: Array<Record<string, unknown>>; hitting: Array<Record<string, unknown>> }> {
  const schoolCode = String(input.schoolCode ?? '').trim().toUpperCase();
  const isPro = schoolCode === 'PRO';
  const table = isPro ? 'public.pro_pitch_events' : 'public.pitch_events';
  const sessionType = isPro ? `COALESCE(NULLIF(TRIM(session_type), ''), 'Unknown')` : `COALESCE(NULLIF(TRIM(session_type), ''), NULLIF(TRIM(sessiontype), ''), 'Unknown')`;
  const batSpeed = numericSql(isPro ? 'bat_speed' : 'batspeed');
  const where = [`school_code = $1`, `session_date >= $2::date`, `session_date <= $3::date`];
  if (schoolCode === 'LEAGUE') where.push(`UPPER(regexp_replace(COALESCE(NULLIF(TRIM(pitcherteam), ''), ''), '[^A-Za-z0-9]', '', 'g')) NOT IN ('TRIAL', 'DASHBOARDTRIAL')`);

  const queryDomain = async (domain: FlagDomain) => {
    const playerColumn = domain === 'pitching' ? 'pitcher' : 'batter';
    const player = `COALESCE(NULLIF(TRIM(${playerColumn}), ''), '')`;
    const velocity = numericSql('relspeed');
    const ivb = numericSql('inducedvertbreak');
    const hb = numericSql('horzbreak');
    const releaseHeight = numericSql('relheight');
    const releaseSide = numericSql('relside');
    const extension = numericSql('extension');
    const spinRate = numericSql('spinrate');
    const exitVelocity = numericSql('exitspeed');
    const launchAngle = numericSql('angle');
    const result = await getDbPool().query<Record<string, unknown>>(`
      SELECT
        ${player} AS ${domain === 'pitching' ? 'pitcher' : 'batter'},
        session_date::text AS session_date,
        COALESCE(NULLIF(TRIM(taggedpitchtype), ''), 'Undefined') AS pitch_type,
        ${sessionType} AS session_type,
        AVG(${velocity}) AS velocity, COUNT(${velocity})::int AS velocity_n,
        AVG(${ivb}) AS ivb, COUNT(${ivb})::int AS ivb_n,
        AVG(${hb}) AS hb, COUNT(${hb})::int AS hb_n,
        AVG(${releaseHeight}) AS release_height, COUNT(${releaseHeight})::int AS release_height_n,
        AVG(${releaseSide}) AS release_side, COUNT(${releaseSide})::int AS release_side_n,
        AVG(${extension}) AS extension, COUNT(${extension})::int AS extension_n,
        AVG(${spinRate}) AS spin_rate, COUNT(${spinRate})::int AS spin_rate_n,
        AVG(${exitVelocity}) AS exit_velocity, COUNT(${exitVelocity})::int AS exit_velocity_n,
        AVG(${launchAngle}) AS launch_angle, COUNT(${launchAngle})::int AS launch_angle_n,
        AVG(${batSpeed}) AS bat_speed, COUNT(${batSpeed})::int AS bat_speed_n
      FROM ${table}
      WHERE ${where.join(' AND ')} AND ${player} <> ''
      GROUP BY ${player}, session_date, COALESCE(NULLIF(TRIM(taggedpitchtype), ''), 'Undefined'), ${sessionType}
      ORDER BY session_date DESC
    `, [schoolCode, input.startDate, input.endDate]);
    return result.rows;
  };

  const [pitching, hitting] = await Promise.all([
    input.domains.includes('pitching') ? queryDomain('pitching') : Promise.resolve([]),
    input.domains.includes('hitting') ? queryDomain('hitting') : Promise.resolve([]),
  ]);
  return { pitching, hitting };
}
