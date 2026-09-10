# Player report deck template

`player-report-template.html` is the PCU-branded player report deck (built for the Pedro Alfonseca 9/9/26 bullpen + biomechanics review). It's a reusable skeleton for future player reports of the same kind.

## What it includes

- Dark PCU theme: black background, `#c8102e` red / `#8f0f24` soft-red accent, Pitching Coach "U" logo and branding
- Slides: title, pitch delivery video, biomechanics video + force-time curve, force plate key metrics, jump profile, bullpen/arsenal overview (usage, velocity, command, movement plot, full pitch table), programming takeaways
- A custom video player (play button + scrub bar) that doesn't dim the frame on hover/scrub like native browser controls do
- A "Present" mode: click the button (top-right) to go fullscreen, one slide at a time, navigable by on-screen arrows, arrow keys / spacebar, with a slide counter; Escape or the Exit button returns to normal scrolling view

## How to reuse it (ask Claude)

Just say something like: *"Build a report for [player] using the same template as Pedro Alfonseca's report — here are the screenshots/videos/PDF."* Claude should:

1. Read this file to pick up the structure and styling.
2. Replace every `{{PLACEHOLDER}}` token with the new player's data (stats come from the bullpen PDF / force plate exports / dashboard).
3. Convert new screenshots to base64 and splice them into the `{{..._BASE64}}` placeholders (never read a full base64 blob back into context — always splice via a script, per this session's approach).
4. Publish the videos and PDF as Artifact assets (`action: "upload_asset"`) and use the returned `/_blob/<id>` URLs for `{{PITCH_VIDEO_ASSET_URL}}`, `{{BIOMECH_VIDEO_ASSET_URL}}`, `{{BULLPEN_PDF_ASSET_URL}}`.
5. Publish as a new Artifact (`capabilities: {assets: {}}`) — don't reuse Pedro's artifact URL for a different player.

## Placeholder reference

| Placeholder | What goes there |
|---|---|
| `{{PLAYER_NAME}}` | Full player name (title slide, bullpen slide subtitle) |
| `{{REPORT_SUBTITLE}}` / `{{REPORT_DATE}}` | Title slide meta line, e.g. "Bullpen & Biomechanics Review" / "September 9, 2026" |
| `{{LOGO_BASE64}}` | PCU logo — reuse `public/pitching-coach-u-logo.png` from the main repo, base64-encoded |
| `{{PITCH_*}}` | Pitch delivery video slide: headline, video poster frame, asset URL/filename, TrackMan overlay line, clip length |
| `{{BIOMECH_*}}` | Biomechanics video slide: subtitle, video poster/asset/filename, summary line, clip length |
| `{{FORCE_CURVE_FULL_BASE64}}` | Full-resolution force-time curve chart (shown below the biomech video in scroll view only — hidden in Present mode since the curve is usually already visible inside the video itself) |
| `{{BACK_*}}` / `{{LEAD_*}}` | Back leg / lead leg force plate metrics table |
| `{{METRIC_1..5_LABEL/VALUE}}` | The 5 headline metric cards — pick whichever matter most for this player, they don't have to duplicate the leg-panel rows |
| `{{CMJ_*}}` / `{{ECCENTRIC_BRAKING_RFD}}` | Jump profile slide — these are rendered as native styled cards (not screenshots) to keep them clean and on-theme; only embed `{{JUMP_FORCE_CURVE_BASE64}}` as an image if a real jump force-time curve screenshot exists |
| `{{FB_*}}` / `{{SL_*}}` / `{{CH_*}}` / `{{ALL_*}}` | Bullpen pitch table rows — add/remove `<tr>` rows for whatever pitch types were actually thrown |
| `{{MOVEMENT_PANEL_BASE64}}` | Movement plot chart, typically cropped from the bullpen PDF via PyMuPDF (`fitz`) — see approach below |
| `{{TAKEAWAY_1..N}}` | Programming takeaways — list is flexible, add/remove `<li>` items as needed |
| `{{GENERATED_DATE}}` | Footer date |

## Notes on building it (lessons from the first build)

- **Never read a full base64 blob into your own context.** Convert images to base64 with a Python script that writes straight to a `.txt` file, then splice placeholders into the HTML with another script (`str.replace`) — see this session's transcript for the exact pattern.
- **Cropping a chart out of a PDF**: no system PDF rasterizer was available; `pip3 install pymupdf` (imports as `fitz`) worked well — render the page at 3x with `page.get_pixmap(matrix=fitz.Matrix(3,3))`, then crop the specific panel with Pillow.
- **Publishing assets**: use `Artifact` with `action: "upload_asset"` for the real video/PDF files (so they're playable/downloadable at full quality), and use lightweight JPEG/PNG frames (via `ffmpeg -ss <t> -frames:v 1`) as `<video poster>` so the deck doesn't need to autoplay/preload anything heavy.
- **Custom video player**: browsers dim/darken the video frame on hover or scrub when using native `controls` — if that's undesired, build a custom play button + scrub bar (already included in this template) instead of the `controls` attribute.
- **Present mode**: align slide content to `flex-start` (not centered) with `overflow-y:auto` in presenting mode — centering tall slides can push content above the visible viewport with no obvious way to tell it's there.
