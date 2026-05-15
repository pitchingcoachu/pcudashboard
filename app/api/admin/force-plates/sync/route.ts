import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSessionFromCookies } from '../../../../../lib/auth';
import { canUseProgrammingData, resolveProgrammingOrganizationId, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { listPlayerChoicesByOrganization } from '../../../../../lib/training-db';
import { fetchValdForceDecksSnapshot, type ValdSnapshot } from '../../../../../lib/vald-forceplates';
import { saveForcePlateSnapshot } from '../../../../../lib/force-plate-cache-db';
import {
  getForcePlateSyncState,
  markForcePlateSyncRunCompleted,
  markForcePlateSyncRunStarted,
  upsertForcePlateSnapshotToNeon,
} from '../../../../../lib/force-plate-neon-db';

function toFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',').map((x) => x.trim());
  const first = rest.join(' ').trim();
  return first && last ? `${first} ${last}` : raw;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = getSessionFromCookies(cookieStore);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (session.role === 'player') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (!canUseProgrammingData(session)) {
    return NextResponse.json({ error: 'Programming access required.' }, { status: 403 });
  }
  const schoolCode = resolveProgrammingSchoolCode(session);
  if (schoolCode !== 'PCU') {
    return NextResponse.json({ error: 'Force Plate Sync is enabled only for PCU.' }, { status: 400 });
  }

  const organizationId = resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) {
    return NextResponse.json({ error: 'Invalid programming organization.' }, { status: 400 });
  }

  const playerChoices = await listPlayerChoicesByOrganization({
    organizationId,
    assignedCoachUserId: session.role === 'coach' ? (session.userId ?? 0) : null,
  });
  const names = Array.from(new Set(playerChoices.map((player) => toFirstLast(String(player.fullName ?? '').trim())).filter(Boolean)));
  if (!names.length) return NextResponse.json({ error: 'No players found for sync.' }, { status: 400 });

  const syncTrialFetchLimit = Math.max(1, Number(process.env.FORCE_PLATE_SYNC_TRIAL_FETCH_LIMIT ?? 100));
  const fullSyncLookbackDays = Math.max(30, Number(process.env.FORCE_PLATE_SYNC_LOOKBACK_DAYS ?? 3650));
  const incrementalPaddingDays = Math.max(1, Number(process.env.FORCE_PLATE_SYNC_PADDING_DAYS ?? 2));
  const maxIncrementalLookbackDays = Math.max(7, Number(process.env.FORCE_PLATE_SYNC_MAX_INCREMENTAL_LOOKBACK_DAYS ?? 180));
  const syncRecentTestLimit = Math.max(100, Number(process.env.FORCE_PLATE_SYNC_RECENT_TEST_LIMIT ?? 10000));
  const syncWindowDays = Math.max(7, Number(process.env.FORCE_PLATE_SYNC_WINDOW_DAYS ?? 60));
  await markForcePlateSyncRunStarted({ organizationId, schoolCode });

  const url = new URL(request.url);
  const forceFullSync = String(url.searchParams.get('full') ?? '').trim() === '1';

  const syncState = await getForcePlateSyncState({ organizationId, schoolCode });
  const nowMs = Date.now();
  const lastSyncedMs = syncState?.lastSyncedAt ? new Date(syncState.lastSyncedAt).getTime() : NaN;
  const derivedDays =
    Number.isFinite(lastSyncedMs) && lastSyncedMs > 0
      ? Math.ceil((nowMs - lastSyncedMs) / 86_400_000) + incrementalPaddingDays
      : fullSyncLookbackDays;
  const syncLookbackDays = forceFullSync
    ? fullSyncLookbackDays
    : Math.max(
        incrementalPaddingDays + 1,
        Math.min(maxIncrementalLookbackDays, derivedDays > 0 ? derivedDays : fullSyncLookbackDays)
      );

  try {
  const snapshotPlayers: ValdSnapshot['players'] = [];
  let fetchedAt = new Date(0).toISOString();
  for (const name of names) {
    const one = await fetchValdForceDecksSnapshot([name], {
      trialFetchLimitOverride: syncTrialFetchLimit,
      lookbackDaysOverride: syncLookbackDays,
      recentTestLimitOverride: syncRecentTestLimit,
      testsWindowDaysOverride: syncWindowDays,
      disableInMemoryCache: true,
    });
    const row = one.players[0];
    if (row) snapshotPlayers.push(row);
    if (String(one.fetchedAt) > fetchedAt) fetchedAt = one.fetchedAt;
  }
  const snapshot: ValdSnapshot = {
    fetchedAt,
    tenantId: '',
    players: snapshotPlayers,
  };
  const write = await saveForcePlateSnapshot({ organizationId, schoolCode, snapshot });
  if (!write.ok) throw new Error(write.error);
  const writeNeon = await upsertForcePlateSnapshotToNeon({ organizationId, schoolCode, snapshot });
  if (!writeNeon.ok) throw new Error(writeNeon.error);
  await markForcePlateSyncRunCompleted({ organizationId, schoolCode, ok: true, syncedAt: snapshot.fetchedAt });

  return NextResponse.json({
    ok: true,
    playerCount: snapshot.players.length,
    fetchedAt: snapshot.fetchedAt,
    lookbackDaysUsed: syncLookbackDays,
    forceFullSync,
  });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Force plate sync failed.';
    await markForcePlateSyncRunCompleted({ organizationId, schoolCode, ok: false, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
