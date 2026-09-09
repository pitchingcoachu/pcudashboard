# PCU PULSE automated sync

This integration is intentionally fixed to the `PCU` school code. Each daily run:

1. Authenticates to PULSE with the PCU coach account.
2. Requests Events and Workloads exports for all subscribed athletes and the latest three PCU calendar dates.
3. Waits for the export email in the designated Google Workspace mailbox.
4. Downloads both CSV files through Gmail's read-only API.
5. Sends the files to the PCU-only dashboard import endpoint, which uses the same row and file deduplication as manual uploads.

The workflow does not save CSV exports as artifacts and does not commit athlete data.

## Required GitHub Actions secrets

- `PCU_PULSE_USERNAME`
- `PCU_PULSE_PASSWORD`
- `PCU_PULSE_EXPORT_EMAIL`
- `PCU_GMAIL_CLIENT_ID`
- `PCU_GMAIL_CLIENT_SECRET`
- `PCU_GMAIL_REFRESH_TOKEN`
- `PCU_PULSE_SYNC_TOKEN`

The same `PCU_PULSE_SYNC_TOKEN` must be configured in the production Vercel project.
Scheduled runs remain safely skipped until the repository variable
`PCU_PULSE_SYNC_ENABLED` is set to `true` after a successful manual test.

These secrets are kept separate from the Arizona sync's (`ARIZONA_PULSE_*` /
`PULSE_GMAIL_*`) even though the underlying Google Cloud OAuth client can be
shared, because the PCU export mailbox is a different inbox and needs its own
refresh token.

## Gmail authorization

Use a Google Cloud project owned by the `pitchingcoachu.com` Workspace organization
(the same project used for the Arizona sync can be reused; only the refresh token
needs to be specific to the PCU inbox):

1. Enable the Gmail API.
2. Configure the Google Auth audience as Internal.
3. Create an OAuth 2.0 Desktop app client (or reuse the existing Arizona one).
4. Authorize only `https://www.googleapis.com/auth/gmail.readonly` for the PCU
   export mailbox (`info@pitchingcoachu.com`).
5. Store the client ID, client secret, and offline refresh token in the GitHub
   secrets above (`PCU_GMAIL_CLIENT_ID`, `PCU_GMAIL_CLIENT_SECRET`,
   `PCU_GMAIL_REFRESH_TOKEN`).

The one-time local authorization helper is:

```bash
node scripts/authorize-pulse-gmail.mjs /absolute/path/to/client_secret.json
```

Run it while signed into `info@pitchingcoachu.com` so the resulting refresh
token is scoped to that inbox. It opens Google's consent screen and writes the
resulting credentials only to a temporary file under `/private/tmp`; that file
must be deleted immediately after the three PCU Gmail GitHub secrets are created.

Do not put a Google password, PULSE password, OAuth credential JSON file, or refresh token in this repository.
