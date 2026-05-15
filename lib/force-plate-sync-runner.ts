import { listPlayerChoicesByOrganization } from './training-db';
import { fetchValdForceDecksSnapshot, type ValdSnapshot } from './vald-forceplates';
import { saveForcePlateSnapshot } from './force-plate-cache-db';
import {
  getForcePlateSyncState,
  markForcePlateSyncRunCompleted,
  markForcePlateSyncRunStarted,
  upsertForcePlateSnapshotToNeon,
} from './force-plate-neon-db';

function toFirstLast(value: string): string {
  const raw = String(value ?? '').trim();
  if (!raw.includes(',')) return raw;
  const [last, ...rest] = raw.split(',').map((x) => x.trim());
  const first = rest.join(' ').trim();
  return first && last ? `${first} ${last}` : raw;
}

export async function runForcePlateSync(args: {
  organizationId: number;
  schoolCode: string;
  assignedCoachUserId?: number | null;
  forceFullSync?: boolean;
}): Promise<{ ok: true; playerCount: number; fetchedAt: string; lookbackDaysUsed: number; forceFullSync: boolean } | { ok: false; error: string }> {
  const syncTrialFetchLimit = Math.max(1, Number(process.env.FORCE_PLATE_SYNC_TRIAL_FETCH_LIMIT ?? 100));
  const fullSyncLookbackDays = Math.max(30, Number(process.env.FORCE_PLATE_SYNC_LOOKBACK_DAYS ?? 3650));
  const incrementalPaddingDays = Math.max(1, Number(process.env.FORCE_PLATE_SYNC_PADDING_DAYS ?? 2));
  const maxIncrementalLookbackDays = Math.max(7, Number(process.env.FORCE_PLATE_SYNC_MAX_INCREMENTAL_LOOKBACK_DAYS ?? 180));
  const syncRecentTestLimit = Math.max(100, Number(process.env.FORCE_PLATE_SYNC_RECENT_TEST_LIMIT ?? 10000));
  const syncWindowDays = Math.max(7, Number(process.env.FORCE_PLATE_SYNC_WINDOW_DAYS ?? 60));
  const forceFullSync = Boolean(args.forceFullSync);

  await markForcePlateSyncRunStarted({ organizationId: args.organizationId, schoolCode: args.schoolCode });
  try {
    const playerChoices = await listPlayerChoicesByOrganization({
      organizationId: args.organizationId,
      assignedCoachUserId: args.assignedCoachUserId ?? null,
    });
    const names = Array.from(new Set(playerChoices.map((player) => toFirstLast(String(player.fullName ?? '').trim())).filter(Boolean)));
    if (!names.length) throw new Error('No players found for sync.');

    const syncState = await getForcePlateSyncState({ organizationId: args.organizationId, schoolCode: args.schoolCode });
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

    const write = await saveForcePlateSnapshot({
      organizationId: args.organizationId,
      schoolCode: args.schoolCode,
      snapshot,
    });
    if (!write.ok) throw new Error(write.error);

    const writeNeon = await upsertForcePlateSnapshotToNeon({
      organizationId: args.organizationId,
      schoolCode: args.schoolCode,
      snapshot,
    });
    if (!writeNeon.ok) throw new Error(writeNeon.error);

    await markForcePlateSyncRunCompleted({
      organizationId: args.organizationId,
      schoolCode: args.schoolCode,
      ok: true,
      syncedAt: snapshot.fetchedAt,
    });
    return {
      ok: true,
      playerCount: snapshot.players.length,
      fetchedAt: snapshot.fetchedAt,
      lookbackDaysUsed: syncLookbackDays,
      forceFullSync,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Force plate sync failed.';
    await markForcePlateSyncRunCompleted({
      organizationId: args.organizationId,
      schoolCode: args.schoolCode,
      ok: false,
      error: message,
    });
    return { ok: false, error: message };
  }
}
