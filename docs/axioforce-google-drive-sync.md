# Axioforce Google Drive sync

The `Axioforce Google Drive Sync` GitHub Actions workflow runs every day at 5:30 AM Arizona time and can also be started manually.

## Google Drive setup

1. Create a Google Cloud service account and enable the Google Drive API in that project.
2. Configure a GitHub OIDC Workload Identity Pool and Provider for `pitchingcoachu/pcudashboard`.
3. Grant that repository principal the service account's **Workload Identity User** role.
4. Share the Axioforce root folder with the service account email as a Viewer.
4. Copy the root folder ID from its Drive URL. For `https://drive.google.com/drive/folders/FOLDER_ID`, the ID is `FOLDER_ID`.

The root folder can contain nested date and player folders. Files are classified by any parent folder whose name contains:

- `All pitch` for all-pitch CSV exports
- `Single pitch` or `Individual pitch` for individual-pitch CSV exports, and any `.mp4` video files alongside them

Pitch videos are matched to their CSV by filename stem: a video named like the
CSV it corresponds to (an optional `_1x` suffix before `.mp4` is ignored, e.g.
`20260821_122631_PITCH_HB_1x.mp4` matches `20260821_122631_PITCH_HB.csv`) is
uploaded to R2 and linked to that pitch's `pitchKey` (the CSV's content hash)
in `biomechanics_pitch_videos`. A video with no matching CSV, or a CSV with no
matching video, is simply skipped until a later run finds both.

## GitHub repository secrets

In **Settings → Secrets and variables → Actions**, add these secrets:

- `DASHBOARD_DATABASE_URL`: the production dashboard Postgres connection string
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`: Cloudflare R2 credentials used to upload pitch videos (same bucket the dashboard app uses for biomechanics/motion-capture media). If these are not set, CSV import still runs normally; only video upload is skipped.

The workflow is configured with the keyless Workload Identity provider and the
`pcu-drive-sync@pearl-player-development.iam.gserviceaccount.com` service account.

The configured Axioforce folder is `1WcYbH6cN5R5b2viB1eqIEkHD3CV40FSR`.

## Import behavior

- Drive folders are scanned recursively.
- Only new or changed Drive files are downloaded.
- CSV content already present in `biomechanics_uploads` is skipped.
- Imports are additive; the daily job never clears existing biomechanics data.
- A file is marked synced only after the importer succeeds.
- Concurrent workflow runs are prevented.

Use **Actions → Axioforce Google Drive Sync → Run workflow** for the first import or an immediate refresh.
