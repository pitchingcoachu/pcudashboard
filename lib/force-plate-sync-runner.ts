import { listPlayerChoicesByOrganization } from './training-db';
import { fetchValdForceDecksSnapshot, type ValdSnapshot } from './vald-forceplates';
import { saveForcePlateSnapshot } from './force-plate-cache-db';
import {
  getForcePlateSyncState,
  listForcePlateHistoricallySearchedPlayerNorms,
  markForcePlatePlayerHistoricalSearch,
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

function normalizePlayerName(value: string): string {
  return toFirstLast(value)
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function backfillNewForcePlatePlayer(args: {
  organizationId: number;
  schoolCode: string;
  playerName: string;
}): Promise<{ ok: boolean; testCount: number; metricRowCount: number; error?: string }> {
  const playerName = toFirstLast(args.playerName);
  const playerNameNorm = normalizePlayerName(playerName);
  const lookbackDays = Math.max(30, Number(process.env.FORCE_PLATE_SYNC_LOOKBACK_DAYS ?? 3650));
  try {
    const snapshot = await fetchValdForceDecksSnapshot([playerName], {
      trialFetchLimitOverride: 10000,
      trialFetchConcurrencyOverride: 4,
      lookbackDaysOverride: lookbackDays,
      recentTestLimitOverride: 10000,
      testsWindowDaysOverride: 60,
      disableInMemoryCache: true,
    });
    const player = snapshot.players[0];
    if (!player?.profileId) throw new Error('No matching VALD profile was found.');
    const write = await upsertForcePlateSnapshotToNeon({
      organizationId: args.organizationId,
      schoolCode: args.schoolCode,
      snapshot,
    });
    if (!write.ok) throw new Error(write.error);
    await markForcePlatePlayerHistoricalSearch({
      organizationId: args.organizationId,
      schoolCode: args.schoolCode,
      playerNameNorm,
      ok: true,
    });
    return { ok: true, testCount: write.testCount, metricRowCount: write.metricRowCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Historical VALD player search failed.';
    await markForcePlatePlayerHistoricalSearch({
      organizationId: args.organizationId,
      schoolCode: args.schoolCode,
      playerNameNorm,
      ok: false,
      error: message,
    });
    return { ok: false, testCount: 0, metricRowCount: 0, error: message };
  }
}

export async function runForcePlateSync(args: {
  organizationId: number;
  schoolCode: string;
  assignedCoachUserId?: number | null;
  forceFullSync?: boolean;
  maxRunSecondsOverride?: number | null;
  playerBatchSizeOverride?: number | null;
  trialFetchLimitOverride?: number | null;
  multiPlayerTrialFetchLimitOverride?: number | null;
  trialFetchConcurrencyOverride?: number | null;
  lookbackDaysOverride?: number | null;
  recentTestLimitOverride?: number | null;
  testsWindowDaysOverride?: number | null;
}): Promise<{
  ok: true;
  playerCount: number;
  testCount: number;
  metricRowCount: number;
  fetchedAt: string;
  lookbackDaysUsed: number;
  forceFullSync: boolean;
} | { ok: false; error: string }> {
  const syncTrialFetchLimit = Math.max(0, Number(args.trialFetchLimitOverride ?? process.env.FORCE_PLATE_SYNC_TRIAL_FETCH_LIMIT ?? 100));
  const fullSyncLookbackDays = Math.max(30, Number(process.env.FORCE_PLATE_SYNC_LOOKBACK_DAYS ?? 3650));
  const incrementalPaddingDays = Math.max(1, Number(process.env.FORCE_PLATE_SYNC_PADDING_DAYS ?? 2));
  const minIncrementalLookbackDays = Math.max(7, Number(process.env.FORCE_PLATE_SYNC_MIN_INCREMENTAL_LOOKBACK_DAYS ?? 60));
  const maxIncrementalLookbackDays = Math.max(7, Number(process.env.FORCE_PLATE_SYNC_MAX_INCREMENTAL_LOOKBACK_DAYS ?? 180));
  const syncRecentTestLimit = Math.max(25, Number(args.recentTestLimitOverride ?? process.env.FORCE_PLATE_SYNC_RECENT_TEST_LIMIT ?? 10000));
  const syncWindowDays = Math.max(1, Number(args.testsWindowDaysOverride ?? process.env.FORCE_PLATE_SYNC_WINDOW_DAYS ?? 60));
  const playerBatchSize = Math.max(1, Number(args.playerBatchSizeOverride ?? process.env.FORCE_PLATE_SYNC_PLAYER_BATCH_SIZE ?? 3));
  const maxRunSeconds = Math.max(10, Number(args.maxRunSecondsOverride ?? process.env.FORCE_PLATE_SYNC_MAX_RUN_SECONDS ?? 90));
  const forceFullSync = Boolean(args.forceFullSync);

  await markForcePlateSyncRunStarted({ organizationId: args.organizationId, schoolCode: args.schoolCode });
  let lastKnownCursor: number | null = null;
  try {
    const playerChoices = await listPlayerChoicesByOrganization({
      organizationId: args.organizationId,
      assignedCoachUserId: args.assignedCoachUserId ?? null,
    });
    const names = Array.from(new Set(playerChoices.map((player) => toFirstLast(String(player.fullName ?? '').trim())).filter(Boolean)));
    if (!names.length) throw new Error('No players found for sync.');
    const historicallySearched = await listForcePlateHistoricallySearchedPlayerNorms({
      organizationId: args.organizationId,
      schoolCode: args.schoolCode,
    });

    const syncState = await getForcePlateSyncState({ organizationId: args.organizationId, schoolCode: args.schoolCode });
    const nowMs = Date.now();
    const lastSyncedMs = syncState?.lastSyncedAt ? new Date(syncState.lastSyncedAt).getTime() : NaN;
    const derivedDays =
      Number.isFinite(lastSyncedMs) && lastSyncedMs > 0
        ? Math.ceil((nowMs - lastSyncedMs) / 86_400_000) + incrementalPaddingDays
        : fullSyncLookbackDays;
    const syncLookbackDays = Number.isFinite(Number(args.lookbackDaysOverride)) && Number(args.lookbackDaysOverride) > 0
      ? Math.max(1, Number(args.lookbackDaysOverride))
      : forceFullSync
      ? fullSyncLookbackDays
      : Math.max(
          minIncrementalLookbackDays,
          Math.min(maxIncrementalLookbackDays, derivedDays > 0 ? derivedDays : fullSyncLookbackDays)
        );

    const orderedNames = [...names].sort((a, b) => a.localeCompare(b));
    const startCursor = Math.max(0, Number(syncState?.playerCursor ?? 0)) % orderedNames.length;
    lastKnownCursor = startCursor;
    const effectiveBatchSize = forceFullSync ? orderedNames.length : Math.min(playerBatchSize, orderedNames.length);
    const batchNames: string[] = [];
    for (let i = 0; i < effectiveBatchSize; i += 1) {
      batchNames.push(orderedNames[(startCursor + i) % orderedNames.length]);
    }
    const newPlayerNames = batchNames.filter((name) => !historicallySearched.has(normalizePlayerName(name)));

    const deadlineMs = Date.now() + maxRunSeconds * 1000;
    const snapshotPlayers: ValdSnapshot['players'] = [];
    let fetchedAt = new Date(0).toISOString();
    let processed = 0;
    if (syncTrialFetchLimit === 0 && batchNames.length) {
      try {
        const batch = await fetchValdForceDecksSnapshot(batchNames, {
          trialFetchLimitOverride: syncTrialFetchLimit,
          multiPlayerTrialFetchLimitOverride: args.multiPlayerTrialFetchLimitOverride ?? 0,
          trialFetchConcurrencyOverride: args.trialFetchConcurrencyOverride ?? undefined,
          lookbackDaysOverride: syncLookbackDays,
          recentTestLimitOverride: syncRecentTestLimit,
          testsWindowDaysOverride: syncWindowDays,
          disableInMemoryCache: true,
        });
        snapshotPlayers.push(...batch.players);
        fetchedAt = batch.fetchedAt;
      } catch (error) {
        console.error('[force-plate-sync] batch sync failed', {
          playerCount: batchNames.length,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        processed = batchNames.length;
      }
    } else {
      for (const name of batchNames) {
        if (Date.now() >= deadlineMs) break;
        try {
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
        } catch (error) {
          console.error('[force-plate-sync] player sync failed', {
            name,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          processed += 1;
        }
      }
    }
    if (!forceFullSync && syncLookbackDays < fullSyncLookbackDays && newPlayerNames.length) {
      try {
        const historical = await fetchValdForceDecksSnapshot(newPlayerNames, {
          trialFetchLimitOverride: 10000,
          multiPlayerTrialFetchLimitOverride: 10000,
          trialFetchConcurrencyOverride: 4,
          lookbackDaysOverride: fullSyncLookbackDays,
          recentTestLimitOverride: 10000,
          testsWindowDaysOverride: 60,
          disableInMemoryCache: true,
        });
        const historicalByName = new Map(historical.players.map((player) => [normalizePlayerName(player.playerName), player]));
        for (let index = 0; index < snapshotPlayers.length; index += 1) {
          const replacement = historicalByName.get(normalizePlayerName(snapshotPlayers[index].playerName));
          if (replacement?.profileId) snapshotPlayers[index] = replacement;
        }
        for (const name of newPlayerNames) {
          const player = historicalByName.get(normalizePlayerName(name));
          await markForcePlatePlayerHistoricalSearch({
            organizationId: args.organizationId,
            schoolCode: args.schoolCode,
            playerNameNorm: normalizePlayerName(name),
            ok: Boolean(player?.profileId),
            error: player?.profileId ? null : 'No matching VALD profile was found.',
          });
        }
        if (String(historical.fetchedAt) > fetchedAt) fetchedAt = historical.fetchedAt;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Historical VALD player search failed.';
        console.error('[force-plate-sync] new-player historical search failed', {
          playerCount: newPlayerNames.length,
          error: message,
        });
        for (const name of newPlayerNames) {
          await markForcePlatePlayerHistoricalSearch({
            organizationId: args.organizationId,
            schoolCode: args.schoolCode,
            playerNameNorm: normalizePlayerName(name),
            ok: false,
            error: message,
          });
        }
      }
    }
    const snapshot: ValdSnapshot = {
      fetchedAt: fetchedAt === new Date(0).toISOString() ? new Date().toISOString() : fetchedAt,
      tenantId: '',
      players: snapshotPlayers,
    };
    const progressedCursor = (startCursor + Math.max(1, processed)) % orderedNames.length;
    lastKnownCursor = progressedCursor;

    const snapshotMetricRowCount = snapshot.players.reduce((sum, player) => sum + player.metricRows.length, 0);
    if (snapshotMetricRowCount <= 50_000) {
      const write = await saveForcePlateSnapshot({
        organizationId: args.organizationId,
        schoolCode: args.schoolCode,
        snapshot,
      });
      if (!write.ok) throw new Error(write.error);
    } else {
      console.info('[force-plate-sync] skipped oversized legacy snapshot cache write', {
        playerCount: snapshot.players.length,
        metricRowCount: snapshotMetricRowCount,
      });
    }

    let writeNeon: { ok: true; playerCount: number; testCount: number; metricRowCount: number } | { ok: false; error: string };
    if (snapshotMetricRowCount > 50_000) {
      let playerCount = 0;
      let testCount = 0;
      let metricRowCount = 0;
      for (const player of snapshot.players) {
        const playerWrite = await upsertForcePlateSnapshotToNeon({
          organizationId: args.organizationId,
          schoolCode: args.schoolCode,
          snapshot: { fetchedAt: snapshot.fetchedAt, tenantId: snapshot.tenantId, players: [player] },
        });
        if (!playerWrite.ok) throw new Error(`${player.playerName}: ${playerWrite.error}`);
        playerCount += playerWrite.playerCount;
        testCount += playerWrite.testCount;
        metricRowCount += playerWrite.metricRowCount;
      }
      writeNeon = { ok: true, playerCount, testCount, metricRowCount };
    } else {
      writeNeon = await upsertForcePlateSnapshotToNeon({
        organizationId: args.organizationId,
        schoolCode: args.schoolCode,
        snapshot,
      });
      if (!writeNeon.ok) throw new Error(writeNeon.error);
    }
    if (writeNeon.testCount === 0 || writeNeon.metricRowCount === 0) {
      const message = `Force plate sync wrote no useful VALD test data for ${processed} processed player(s).`;
      await markForcePlateSyncRunCompleted({
        organizationId: args.organizationId,
        schoolCode: args.schoolCode,
        ok: false,
        error: message,
        nextPlayerCursor: progressedCursor,
      });
      return { ok: false, error: message };
    }

    await markForcePlateSyncRunCompleted({
      organizationId: args.organizationId,
      schoolCode: args.schoolCode,
      ok: true,
      syncedAt: snapshot.fetchedAt,
      nextPlayerCursor: progressedCursor,
    });
    return {
      ok: true,
      playerCount: snapshot.players.length,
      testCount: writeNeon.testCount,
      metricRowCount: writeNeon.metricRowCount,
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
      nextPlayerCursor: lastKnownCursor ?? undefined,
    });
    return { ok: false, error: message };
  }
}
