import { notFound } from 'next/navigation';
import { DEMO_REQUEST_FOLLOWUP_TEMPLATE_KEY, getEmailTemplate } from '../../../../lib/email-templates';
import { requirePortalSession } from '../../../../lib/portal-session';
import EmailTemplateEditor from './email-template-editor';

export const dynamic = 'force-dynamic';

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readMessage(params: Record<string, string | string[] | undefined>) {
  const ok = typeof params.ok === 'string' ? params.ok : '';
  const error = typeof params.error === 'string' ? params.error : '';
  return { ok, error };
}

export default async function EmailTemplatesPage({ searchParams }: PageProps) {
  const session = await requirePortalSession();
  if (session.role !== 'admin' || session.email.trim().toLowerCase() !== 'jgaynor@pitchingcoachu.com') notFound();
  const [template, params] = await Promise.all([
    getEmailTemplate(DEMO_REQUEST_FOLLOWUP_TEMPLATE_KEY),
    searchParams,
  ]);
  const { ok, error } = readMessage(params);

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Email Automations</h2>
        <p>Edit the email automatically sent to someone after they submit the PCU Dashboard form.</p>
      </div>

      {ok ? <p className="auth-message">{ok}</p> : null}
      {error ? <p className="auth-error">{error}</p> : null}

      <article className="portal-admin-card portal-admin-card-wide">
        <h3>Demo Request Follow-Up Email</h3>
        <EmailTemplateEditor
          initialFromName={template.fromName}
          initialFromEmail={template.fromEmail}
          initialSubject={template.subject}
          initialBodyText={template.bodyText}
          initialBodyHtml={template.bodyHtml}
        />
      </article>

      <article className="portal-admin-card">
        <h3>Available Placeholders</h3>
        <p>Use these inside the subject or body. They are replaced with the form submission values.</p>
        <div style={{ display: 'grid', gap: 8, fontWeight: 700 }}>
          <code>{'{{name}}'}</code>
          <code>{'{{email}}'}</code>
          <code>{'{{phone}}'}</code>
          <code>{'{{school_or_facility}}'}</code>
          <code>{'{{role}}'}</code>
        </div>
        <p style={{ marginTop: 14 }}>
          Video embeds are saved as clickable video links because most email inboxes block embedded video players.
        </p>
      </article>
    </div>
  );
}
