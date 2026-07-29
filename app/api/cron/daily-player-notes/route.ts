import { NextResponse } from 'next/server';
import { listDailyPlayerNoteDigests, type DailyPlayerNoteDigestEntry, type DailyPlayerNoteDigestOrg } from '../../../../lib/training-db';

function isAuthorized(request: Request): boolean {
  const configured = String(process.env.DAILY_PLAYER_NOTES_CRON_KEY ?? '').trim();
  if (!configured) return false;
  const headerKey = String(request.headers.get('x-cron-key') ?? '').trim();
  if (headerKey && headerKey === configured) return true;
  const auth = String(request.headers.get('authorization') ?? '').trim();
  if (auth.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    if (token && token === configured) return true;
  }
  return false;
}

// Vercel Cron only fires at a fixed UTC time, but "7:00 AM Eastern" needs to
// stay 7:00 AM through the EST/EDT switch. So the route itself runs hourly
// and this checks whether it's currently the 7 AM Eastern hour before doing
// any work -- the actual send only happens on the one matching invocation.
function isSevenAmEastern(now: Date): boolean {
  const hourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false,
  }).format(now);
  // "24" is how some ICU implementations render midnight in hour12:false;
  // treat it as hour 0 for safety even though it isn't relevant to a 7am check.
  const hour = Number(hourStr === '24' ? '0' : hourStr);
  return hour === 7;
}

// Returns the UTC instant corresponding to local midnight (00:00) in the
// given IANA timezone, for the calendar date that instant "now" falls on in
// that timezone. Works for any fixed or DST-observing zone: it finds the
// UTC millisecond offset by re-parsing what that timezone's wall clock says
// at a known UTC instant, so it self-corrects for EST vs. EDT automatically.
function localMidnightUtcMs(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // e.g. if it's 03:00 Eastern right now, this local wall-clock time minus
  // 3 hours is local midnight; converting that same wall-clock reading as if
  // it were UTC and comparing to the real "now" gives the zone's current
  // UTC offset, which is then applied to get true midnight in UTC.
  const asIfUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offsetMs = asIfUtcMs - now.getTime();
  const localMidnightAsIfUtcMs = Date.UTC(get('year'), get('month') - 1, get('day'));
  return localMidnightAsIfUtcMs - offsetMs;
}

// [start, end) window for "yesterday" in Eastern time, expressed as UTC ISO
// strings for the SQL query (created_at is stored in UTC/timestamptz).
function previousEasternDayWindowUtc(now: Date): { startIso: string; endIso: string } {
  const todayMidnightUtcMs = localMidnightUtcMs(now, 'America/New_York');
  const yesterdayMidnightUtcMs = todayMidnightUtcMs - 24 * 60 * 60_000;
  return {
    startIso: new Date(yesterdayMidnightUtcMs).toISOString(),
    endIso: new Date(todayMidnightUtcMs).toISOString(),
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatDateLabel(isoDate: string): string {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(parsed);
}

function isImageAttachment(mimeType: string | null, dataUrl: string | null): boolean {
  if (mimeType && mimeType.startsWith('image/')) return true;
  return Boolean(dataUrl && dataUrl.startsWith('data:image/'));
}

function isInlineablePdfAttachment(mimeType: string | null, dataUrl: string | null): boolean {
  if (mimeType === 'application/pdf') return true;
  return Boolean(dataUrl && dataUrl.startsWith('data:application/pdf'));
}

function dataUrlToBase64(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/s);
  return match ? match[1] : null;
}

type ResolvedAttachment = {
  html: string;
  resendAttachment?: { filename: string; content: string };
};

function resolveAttachment(entry: DailyPlayerNoteDigestEntry, appOrigin: string): ResolvedAttachment | null {
  const dataUrl = String(entry.attachmentDataUrl ?? '').trim();
  if (!dataUrl) return null;
  const mimeType = entry.attachmentMimeType;
  const name = entry.attachmentName || 'attachment';

  // Multi-attachment notes pack a JSON array into attachment_data_url; only
  // the first attachment is summarized inline to keep the email readable,
  // with a link back to the note for the rest.
  if (mimeType === 'application/x.pcu-note-attachments+json' || dataUrl.startsWith('[')) {
    return {
      html: `<a href="${escapeHtml(appOrigin)}/portal/dashboard?tab=player-notes" style="color:#93c5fd;">View attachments on site &rarr;</a>`,
    };
  }

  // /api/player/media/{id} references point at R2/large media (e.g. video) --
  // too large to embed or attach to an email, so link back instead.
  if (/^\/api\/player\/media\/\d+$/.test(dataUrl) || (mimeType && mimeType.startsWith('video/'))) {
    return {
      html: `<a href="${escapeHtml(appOrigin)}/portal/dashboard?tab=player-notes" style="color:#93c5fd;">View attachment on site &rarr;</a>`,
    };
  }

  if (isImageAttachment(mimeType, dataUrl)) {
    return {
      html: `<img src="${escapeHtml(dataUrl)}" alt="${escapeHtml(name)}" style="max-width:320px;max-height:320px;border-radius:8px;margin-top:8px;display:block;" />`,
    };
  }

  if (isInlineablePdfAttachment(mimeType, dataUrl)) {
    const base64 = dataUrlToBase64(dataUrl);
    if (base64) {
      return {
        html: `<p style="margin:8px 0 0 0;color:#93c5fd;">Attached: ${escapeHtml(name)}</p>`,
        resendAttachment: { filename: name.endsWith('.pdf') ? name : `${name}.pdf`, content: base64 },
      };
    }
  }

  return {
    html: `<a href="${escapeHtml(appOrigin)}/portal/dashboard?tab=player-notes" style="color:#93c5fd;">View attachment on site &rarr;</a>`,
  };
}

function buildEmailHtml(org: DailyPlayerNoteDigestOrg, appOrigin: string): { html: string; text: string; attachments: Array<{ filename: string; content: string }> } {
  const attachments: Array<{ filename: string; content: string }> = [];

  const entriesByPlayer = new Map<string, DailyPlayerNoteDigestEntry[]>();
  for (const entry of org.entries) {
    const list = entriesByPlayer.get(entry.playerName) ?? [];
    list.push(entry);
    entriesByPlayer.set(entry.playerName, list);
  }

  const playerBlocksHtml: string[] = [];
  const playerBlocksText: string[] = [];

  for (const [playerName, entries] of entriesByPlayer.entries()) {
    const noteBlocksHtml: string[] = [];
    const noteBlocksText: string[] = [];

    for (const entry of entries) {
      const resolvedAttachment = resolveAttachment(entry, appOrigin);
      if (resolvedAttachment?.resendAttachment) attachments.push(resolvedAttachment.resendAttachment);

      noteBlocksHtml.push(`
        <div style="border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:14px 16px;margin-bottom:10px;background:rgba(255,255,255,0.03);">
          <div style="font-size:12px;color:#9ca3af;margin-bottom:6px;">
            <span style="background:rgba(255,255,255,0.1);border-radius:999px;padding:2px 8px;font-weight:700;">${escapeHtml(entry.category)}</span>
            &nbsp;&middot;&nbsp;${escapeHtml(entry.domain)}
            &nbsp;&middot;&nbsp;${escapeHtml(formatDateLabel(entry.noteDate))}
            &nbsp;&middot;&nbsp;by ${escapeHtml(entry.authorName)}
          </div>
          <div style="white-space:pre-wrap;color:#f8fafc;font-size:14px;line-height:1.5;">${escapeHtml(entry.noteText)}</div>
          ${resolvedAttachment ? resolvedAttachment.html : ''}
        </div>
      `);

      noteBlocksText.push(
        `[${entry.category} / ${entry.domain} / ${formatDateLabel(entry.noteDate)} / by ${entry.authorName}]\n${entry.noteText}${entry.attachmentName ? `\n(Attachment: ${entry.attachmentName})` : ''}`
      );
    }

    playerBlocksHtml.push(`
      <div style="margin-bottom:24px;">
        <h3 style="color:#f8fafc;font-size:16px;margin:0 0 10px 0;">${escapeHtml(playerName)}</h3>
        ${noteBlocksHtml.join('\n')}
      </div>
    `);
    playerBlocksText.push(`${playerName}\n${'-'.repeat(playerName.length)}\n${noteBlocksText.join('\n\n')}`);
  }

  const html = `
    <div style="background:#0a0a0a;padding:24px;font-family:Manrope,Arial,sans-serif;">
      <div style="max-width:640px;margin:0 auto;">
        <h2 style="color:#f8fafc;font-size:20px;margin:0 0 4px 0;">${escapeHtml(org.schoolCode)} Daily Player Notes</h2>
        <p style="color:#9ca3af;font-size:13px;margin:0 0 24px 0;">Notes written yesterday</p>
        ${playerBlocksHtml.join('\n')}
        <p style="color:#6b7280;font-size:12px;margin-top:24px;">
          <a href="${escapeHtml(appOrigin)}/portal/dashboard" style="color:#93c5fd;">Open the dashboard &rarr;</a>
        </p>
      </div>
    </div>
  `;
  const text = `${org.schoolCode} Daily Player Notes\nNotes written yesterday\n\n${playerBlocksText.join('\n\n')}`;

  return { html, text, attachments };
}

async function sendOrgDigestEmail(org: DailyPlayerNoteDigestOrg, appOrigin: string, resendApiKey: string, fromEmail: string): Promise<boolean> {
  const { html, text, attachments } = buildEmailHtml(org, appOrigin);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromEmail,
      to: org.recipients.map((recipient) => recipient.email),
      subject: `${org.schoolCode} Daily Player Notes`,
      text,
      html,
      ...(attachments.length ? { attachments } : {}),
    }),
  });
  if (!response.ok) {
    console.error(`[daily-player-notes] Resend error for org ${org.organizationId}:`, await response.text().catch(() => ''));
    return false;
  }
  return true;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const now = new Date();
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';
  if (!force && !isSevenAmEastern(now)) {
    return NextResponse.json({ ok: true, skipped: 'not-7am-eastern' });
  }

  const appOrigin = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  const { startIso, endIso } = previousEasternDayWindowUtc(now);
  const digests = await listDailyPlayerNoteDigests({ startIso, endIso });

  // TEMP: renders the built email HTML/text instead of sending, for manual
  // verification -- does not require RESEND_API_KEY. Remove before relying
  // on this route for real sends only.
  const preview = url.searchParams.get('preview') === '1';
  if (preview) {
    const schoolFilter = url.searchParams.get('school')?.trim().toUpperCase();
    const target = schoolFilter ? digests.find((org) => org.schoolCode === schoolFilter) : digests[0];
    if (!target) return NextResponse.json({ ok: true, orgsWithNotes: digests.map((o) => o.schoolCode), message: 'No matching org with notes in window.' });
    const { html, text, attachments } = buildEmailHtml(target, appOrigin);
    return NextResponse.json({
      ok: true,
      windowStart: startIso,
      windowEnd: endIso,
      schoolCode: target.schoolCode,
      recipients: target.recipients,
      attachmentCount: attachments.length,
      html,
      text,
    });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return NextResponse.json({ error: 'RESEND_API_KEY is not configured.' }, { status: 500 });
  const fromEmail = process.env.DAILY_PLAYER_NOTES_FROM_EMAIL ?? process.env.DEMO_REQUEST_FROM_EMAIL ?? 'onboarding@resend.dev';

  let sent = 0;
  let failed = 0;
  for (const org of digests) {
    const ok = await sendOrgDigestEmail(org, appOrigin, resendApiKey, fromEmail);
    if (ok) sent += 1;
    else failed += 1;
  }

  return NextResponse.json({ ok: true, windowStart: startIso, windowEnd: endIso, orgsWithNotes: digests.length, sent, failed });
}
