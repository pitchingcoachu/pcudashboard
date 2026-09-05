# Arizona PULSE automated sync

This integration is intentionally fixed to the `ARIZONA` school code. Each daily run:

1. Authenticates to PULSE with the Arizona coach account.
2. Requests Events and Workloads exports for all subscribed athletes and the latest three Arizona calendar dates.
3. Waits for the export email in the designated Google Workspace mailbox.
4. Downloads both CSV files through Gmail's read-only API.
5. Sends the files to the Arizona-only dashboard import endpoint, which uses the same row and file deduplication as manual uploads.

The workflow does not save CSV exports as artifacts and does not commit athlete data.

## Required GitHub Actions secrets

- `ARIZONA_PULSE_USERNAME`
- `ARIZONA_PULSE_PASSWORD`
- `ARIZONA_PULSE_EXPORT_EMAIL`
- `PULSE_GMAIL_CLIENT_ID`
- `PULSE_GMAIL_CLIENT_SECRET`
- `PULSE_GMAIL_REFRESH_TOKEN`
- `ARIZONA_PULSE_SYNC_TOKEN`

The same `ARIZONA_PULSE_SYNC_TOKEN` must be configured in the production Vercel project.
Scheduled runs remain safely skipped until the repository variable
`ARIZONA_PULSE_SYNC_ENABLED` is set to `true` after a successful manual test.

## Gmail authorization

Use a Google Cloud project owned by the `pitchingcoachu.com` Workspace organization:

1. Enable the Gmail API.
2. Configure the Google Auth audience as Internal.
3. Create an OAuth 2.0 Desktop app client.
4. Authorize only `https://www.googleapis.com/auth/gmail.readonly` for the export mailbox.
5. Store the client ID, client secret, and offline refresh token in the GitHub secrets above.

Do not put a Google password, PULSE password, OAuth credential JSON file, or refresh token in this repository.
