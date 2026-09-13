# VALD ForceDecks Drive sync

This is a recovery and archive pipeline. It imports ForceDecks **Test Result Export** CSV files into the existing force-plate tables and archives **Auto Recording Export** force-time CSVs unchanged in R2. The primary daily source is the VALD API.

## One-time setup

1. Create a Google Drive folder dedicated to VALD ForceDecks result exports.
2. Share it as Viewer with `pcu-drive-sync@pearl-player-development.iam.gserviceaccount.com`.
3. Add the folder ID as the GitHub Actions secret `GOOGLE_DRIVE_VALD_FORCEDECKS_FOLDER_ID`.
4. Set the Actions variable `PCU_VALD_DRIVE_SYNC_ENABLED=true`.
5. In ForceDecks, create a Test Result Export Profile containing all results and export those CSVs into the Drive-synced folder when an API recovery is needed.
6. On the ForceDecks Windows computer, point **Auto Recording Export Folder** at a desktop folder synchronized into this Google Drive folder to preserve raw force-time recordings.

The complete API pull runs daily at 6:00 PM America/Phoenix. This Drive recovery/archive pass runs at 6:30 PM and can also be run manually.

The companion VALD API refresh checks the most recent five days for the full PCU roster. When a player is newly added to the PCU roster, the app starts a one-time historical VALD search for that player immediately; the nightly run retries any new-player search that did not complete.

## Important file distinction

The sync distinguishes the two formats. A Test Result Export contains `Name`, `Test Type`, `Date`, and `Time` and is imported into dashboard metrics. Other ForceDecks CSVs are treated as raw recordings and archived in R2; raw force-time samples are intentionally not inserted into the reporting tables.

## Reliability behavior

- Drive file IDs plus checksums prevent unchanged files from being imported twice.
- A changed export is reprocessed safely using deterministic test IDs.
- Existing VALD API tests are matched by player, test type, and timestamp so a CSV export cannot create a second copy of the same session.
- Athlete names are normalized and restricted to the PCU roster.
- A roster change causes existing exports to be checked again, allowing a newly added player to pick up rows that were previously ignored.
- Unmatched names and ignored rows are printed in the workflow log.
- Database writes use the existing `force_plate_*` tables, so web and app displays need no separate data path.
- A Drive file is checkpointed only after its import succeeds.

## Local dry run

```bash
VALD_FORCEDECKS_EXPORT_ROOT=/path/to/export.csv \
VALD_FORCEDECKS_DRY_RUN=1 \
npx tsx --env-file=.env.local scripts/import-vald-forcedecks-exports.ts
```

A dry run parses and roster-matches the file but does not write force-plate results.
