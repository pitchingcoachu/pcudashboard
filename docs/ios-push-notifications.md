# iOS push notifications

The production iOS shell registers each signed-in device with APNs and sends
the token to `/api/mobile/push-tokens`. Dashboard notification events are sent
directly to Apple's production HTTP/2 API. Tapping a notification deep-links
to the related message, profile, program, schedule, or export page when that
event supplies a destination.

## One-time Apple setup

1. In Certificates, Identifiers & Profiles, enable **Push Notifications** for
   App ID `com.pitchingcoachu.pearlplayerdev`.
2. Create a Keys signing key with Apple Push Notifications service enabled.
3. Download the `.p8` file. Apple permits downloading it only once.
4. Confirm automatic signing regenerates the App Store provisioning profile
   with the `aps-environment` entitlement.

## Production environment variables

Configure these encrypted variables in Vercel for Production:

- `APNS_TEAM_ID`: Apple Developer Team ID.
- `APNS_KEY_ID`: ID shown beside the APNs signing key.
- `APNS_PRIVATE_KEY`: complete `.p8` contents. A base64-encoded `.p8` is also
  accepted when multiline secrets are inconvenient.
- `APNS_BUNDLE_ID`: optional; defaults to `com.pitchingcoachu.pearlplayerdev`.

Never commit the `.p8` file or its contents.

## Release and verification

1. Run `npm run cap:sync` after installing dependencies.
2. Archive the Release configuration and submit it as a new App Store version.
   Push capability changes cannot be delivered by the live web wrapper alone.
3. Install the App Store build on a physical iPhone, log in, and allow
   notifications when prompted.
4. Send a dashboard message to that user and verify the lock-screen banner,
   sound, and deep link while the app is closed.
5. Also verify a coach media upload and a workout assignment.

The server removes APNs tokens reported as `BadDeviceToken` or `Unregistered`.
Logging out removes the current device token before ending the session.
