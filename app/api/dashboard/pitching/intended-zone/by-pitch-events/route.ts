import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromRequest } from '../../../../../../lib/auth';
import { resolveProgrammingOrganizationId } from '../../../../../../lib/programming-scope';
import { getIntendedZonePitchesByPitchEventsIds } from '../../../../../../lib/training-db';
import { lookupPitchFlightPhysics } from '../../../../../../lib/pitching-video-lookup';

// POST { pitchEventIds: number[] } -> Intended Target data (target/miss
// location, direction, radius) plus historical flight-replay physics
// (release point + acceleration, pulled straight off pitch_events -- no
// live TrackMan session required) for whichever of those pitches have a
// matching intended_zone_pitches row. Used by the pitch video modal (Edger)
// to power its optional "Intended Target" view -- POST rather than GET
// since a video queue's id list can be long enough to risk a URL length
// limit as a query string.
export async function POST(request: Request) {
  try {
    const cookieStore = await cookies();
    const session = getSessionFromRequest(request, cookieStore);
    if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const organizationId = await resolveProgrammingOrganizationId(session);
    if (organizationId <= 0) return NextResponse.json({ error: 'Session context missing.' }, { status: 400 });

    const body = (await request.json().catch(() => ({}))) as { pitchEventIds?: unknown };
    const pitchEventsIds = Array.isArray(body.pitchEventIds)
      ? body.pitchEventIds.map((value) => Number(value)).filter((id) => Number.isFinite(id) && id > 0)
      : [];
    if (!pitchEventsIds.length) return NextResponse.json({ pitches: {} });

    const [intendedZoneByPitchEventsId, flightByPitchEventsId] = await Promise.all([
      getIntendedZonePitchesByPitchEventsIds({ organizationId, pitchEventsIds }),
      lookupPitchFlightPhysics(pitchEventsIds),
    ]);

    const pitches: Record<
      number,
      {
        intendedSideFt: number;
        intendedHeightFt: number;
        targetRadiusFt: number;
        plateLocSide: number | null;
        plateLocHeight: number | null;
        missDistanceFt: number | null;
        missDirection: string | null;
        pitchType: string | null;
        targetHit: boolean;
        flight: {
          releaseSideFt: number | null;
          releaseHeightFt: number | null;
          releaseExtensionFt: number | null;
          accelerationXFt: number | null;
          accelerationZFt: number | null;
          positionYFt: number | null;
          velocityYFt: number | null;
          accelerationYFt: number | null;
        } | null;
      }
    > = {};

    for (const [pitchEventsId, izPitch] of intendedZoneByPitchEventsId.entries()) {
      const flight = flightByPitchEventsId.get(pitchEventsId) ?? null;
      pitches[pitchEventsId] = {
        intendedSideFt: izPitch.intendedSideFt,
        intendedHeightFt: izPitch.intendedHeightFt,
        targetRadiusFt: izPitch.targetRadiusFt,
        plateLocSide: izPitch.plateLocSide,
        plateLocHeight: izPitch.plateLocHeight,
        missDistanceFt: izPitch.missDistanceFt,
        missDirection: izPitch.missDirection,
        pitchType: izPitch.pitchType,
        targetHit: izPitch.targetHit,
        flight,
      };
    }

    return NextResponse.json({ pitches });
  } catch (error) {
    console.error('[intended-zone by-pitch-events] Unable to load pitch data.', error);
    return NextResponse.json(
      { error: 'Unable to load Intended Target data for this video queue.' },
      { status: 500 },
    );
  }
}
