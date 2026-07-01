import { getDbPool, isDatabaseConfigured } from './auth-db';

export const DEMO_REQUEST_FOLLOWUP_TEMPLATE_KEY = 'demo_request_followup';

export type EmailTemplate = {
  templateKey: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
};

export type DemoRequestTemplateVars = {
  name: string;
  email: string;
  phone: string;
  school_or_facility: string;
  role: string;
};

const DEFAULT_DEMO_REQUEST_TEMPLATE: EmailTemplate = {
  templateKey: DEMO_REQUEST_FOLLOWUP_TEMPLATE_KEY,
  fromName: 'Pitching Coach U',
  fromEmail: '',
  subject: 'We received your PCU Dashboard request',
  bodyText: [
    'Hi {{name}},',
    '',
    'Thanks for reaching out about the PCU Dashboard. We received your request and will follow up within 24 hours.',
    '',
    'Request details:',
    'School/Facility: {{school_or_facility}}',
    'Role: {{role}}',
    'Phone: {{phone}}',
    '',
    'Pitching Coach U',
  ].join('\n'),
  bodyHtml: [
    '<p>Hi {{name}},</p>',
    '<p>Thanks for reaching out about the PCU Dashboard. We received your request and will follow up within 24 hours.</p>',
    '<p><strong>Request details:</strong><br />School/Facility: {{school_or_facility}}<br />Role: {{role}}<br />Phone: {{phone}}</p>',
    '<p>Pitching Coach U</p>',
  ].join('\n'),
};

async function ensureEmailTemplatesTable(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_templates (
      template_key TEXT PRIMARY KEY,
      from_name TEXT NOT NULL DEFAULT '',
      from_email TEXT NOT NULL DEFAULT '',
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      body_html TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE email_templates ADD COLUMN IF NOT EXISTS body_html TEXT;`);
}

export function defaultDemoRequestFollowupTemplate(): EmailTemplate {
  return { ...DEFAULT_DEMO_REQUEST_TEMPLATE };
}

export async function getEmailTemplate(templateKey: string): Promise<EmailTemplate> {
  const fallback = templateKey === DEMO_REQUEST_FOLLOWUP_TEMPLATE_KEY
    ? defaultDemoRequestFollowupTemplate()
    : {
        templateKey,
        fromName: '',
        fromEmail: '',
        subject: '',
        bodyText: '',
        bodyHtml: '',
      };
  if (!isDatabaseConfigured()) return fallback;
  await ensureEmailTemplatesTable();
  const pool = getDbPool();
  const result = await pool.query<{
    template_key: string;
    from_name: string | null;
    from_email: string | null;
    subject: string | null;
    body_text: string | null;
    body_html: string | null;
  }>(
    `
      SELECT template_key, from_name, from_email, subject, body_text, body_html
      FROM email_templates
      WHERE template_key = $1
      LIMIT 1
    `,
    [templateKey]
  );
  const row = result.rows[0];
  if (!row) return fallback;
  return {
    templateKey: row.template_key,
    fromName: row.from_name ?? '',
    fromEmail: row.from_email ?? '',
    subject: row.subject ?? fallback.subject,
    bodyText: row.body_text ?? fallback.bodyText,
    bodyHtml: row.body_html ?? fallback.bodyHtml,
  };
}

export async function saveEmailTemplate(template: EmailTemplate): Promise<void> {
  if (!isDatabaseConfigured()) throw new Error('DATABASE_URL is not configured.');
  await ensureEmailTemplatesTable();
  const pool = getDbPool();
  await pool.query(
    `
      INSERT INTO email_templates (template_key, from_name, from_email, subject, body_text, body_html, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (template_key) DO UPDATE
      SET from_name = EXCLUDED.from_name,
          from_email = EXCLUDED.from_email,
          subject = EXCLUDED.subject,
          body_text = EXCLUDED.body_text,
          body_html = EXCLUDED.body_html,
          updated_at = NOW()
    `,
    [
      template.templateKey,
      template.fromName.trim(),
      template.fromEmail.trim(),
      template.subject.trim(),
      template.bodyText.trim(),
      sanitizeEmailHtml(template.bodyHtml.trim()),
    ]
  );
}

export function renderDemoRequestTemplate(
  template: EmailTemplate,
  vars: DemoRequestTemplateVars,
  fallbackFromEmail: string
): { from: string; subject: string; text: string; html: string } {
  const values: Record<string, string> = {
    name: vars.name,
    email: vars.email,
    phone: vars.phone || 'Not provided',
    school_or_facility: vars.school_or_facility,
    role: vars.role,
  };
  const render = (value: string) =>
    value.replace(/\{\{\s*(name|email|phone|school_or_facility|role)\s*\}\}/g, (_, key: string) => values[key] ?? '');
  const fromEmail = template.fromEmail.trim() || fallbackFromEmail;
  const fromName = template.fromName.trim();
  const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
  const text = render(template.bodyText);
  const htmlSource = template.bodyHtml.trim() || textToEmailHtml(template.bodyText);
  return {
    from,
    subject: render(template.subject),
    text,
    html: sanitizeEmailHtml(render(htmlSource)),
  };
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function sanitizeEmailHtml(html: string): string {
  const allowedTags = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'a', 'ul', 'ol', 'li', 'div', 'span', 'font']);
  let cleaned = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<\/?(iframe|video|audio|object|embed|form|input|button|textarea|select)[^>]*>/gi, '');

  cleaned = cleaned.replace(/<([a-z0-9]+)([^>]*)>/gi, (match, tagName: string, attrs: string) => {
    const tag = tagName.toLowerCase();
    if (!allowedTags.has(tag)) return '';
    const colorStyle = extractSafeColorStyle(attrs);
    if (tag === 'font') return colorStyle ? `<span style="${colorStyle}">` : '<span>';
    if (tag !== 'a') return colorStyle ? `<${tag} style="${colorStyle}">` : `<${tag}>`;
    const hrefMatch = String(attrs).match(/\shref=["']([^"']+)["']/i);
    const href = hrefMatch?.[1]?.trim() ?? '';
    if (!/^https?:\/\//i.test(href) && !/^mailto:/i.test(href)) return '<a>';
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" style="${colorStyle || 'color: inherit;'}">`;
  });
  cleaned = cleaned.replace(/<\/([a-z0-9]+)>/gi, (match, tagName: string) => {
    const tag = tagName.toLowerCase();
    if (tag === 'font') return '</span>';
    return allowedTags.has(tag) ? `</${tag}>` : '';
  });
  return cleaned;
}

function extractSafeColorStyle(attrs: string): string {
  const colorAttrMatch = String(attrs).match(/\scolor=["']([^"']+)["']/i);
  const styleColorMatch = String(attrs).match(/color\s*:\s*([^;"']+)/i);
  const raw = (styleColorMatch?.[1] ?? colorAttrMatch?.[1] ?? '').trim();
  if (!raw) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(raw)) return `color: ${raw};`;
  const rgbMatch = raw.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
  if (rgbMatch) {
    const values = rgbMatch.slice(1).map((value) => Math.max(0, Math.min(255, Number(value))));
    return `color: rgb(${values.join(', ')});`;
  }
  return '';
}

function textToEmailHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br />')}</p>`)
    .join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
