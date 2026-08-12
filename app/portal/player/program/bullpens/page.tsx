import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { canUseProgrammingData, resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { resolveSchoolBrand } from '../../../../../lib/school-brand';
import { getPlayerForUser } from '../../../../../lib/training-db';
import BullpenEntry from './bullpen-entry';

type BullpensPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlayerBullpensPage({ searchParams }: BullpensPageProps) {
  const session = await requirePortalSession();
  if (!(await canUseProgrammingData(session))) redirect('/portal/player/program');
  const schoolBrand = resolveSchoolBrand(resolveProgrammingSchoolCode(session));
  const canPreview = session.role === 'admin' || session.role === 'coach';
  const params = await searchParams;
  const previewPlayerIdRaw = typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '';
  const previewPlayerId = Number(previewPlayerIdRaw ?? '0');
  const playerIdQuery = canPreview && Number.isFinite(previewPlayerId) && previewPlayerId > 0 ? `?playerId=${previewPlayerId}` : '';

  // Resolve the actual player ID for saving log entries
  let resolvedPlayerId = 0;
  if (session.role === 'player') {
    const orgId = Number(session.organizationId ?? 0);
    const userId = Number(session.userId ?? 0);
    const player = userId > 0 ? await getPlayerForUser({ organizationId: orgId, userId }) : null;
    resolvedPlayerId = Number(player?.id ?? 0);
  } else if (canPreview && previewPlayerId > 0) {
    resolvedPlayerId = previewPlayerId;
  }

  const h = await headers();
  const protocol = h.get('x-forwarded-proto') ?? 'http';
  const host = h.get('host');
  if (!host) redirect('/portal/player/program');
  const cookieHeader = (await cookies()).toString();
  const response = await fetch(`${protocol}://${host}/api/player/throwing${playerIdQuery}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => ({})) : {};

  type Template = { id: string; name: string; rowCount: number; columns: string[]; columnTypes?: Array<'auto' | 'text' | 'velocity' | 'strike'>; rows: string[][] };
  const bullpenTemplates: Template[] = Array.isArray((payload as { bullpenTemplates?: Template[] }).bullpenTemplates)
    ? ((payload as { bullpenTemplates?: Template[] }).bullpenTemplates ?? [])
    : [];
  const bullpenState = (payload as {
    bullpenState?: { selectedTemplateId: string; visibleTemplateIds: string[]; notes?: string }
  }).bullpenState ?? { selectedTemplateId: '', visibleTemplateIds: [], notes: '' };

  return (
    <div className="portal-shell">
      <section className="portal-panel">
        <div className="portal-row-between">
          <h2 style={{ marginTop: 0 }}>Bullpen Scripts</h2>
          <Link
            href={canPreview && previewPlayerId > 0 ? `/portal/player/program?previewPlayerId=${previewPlayerId}` : '/portal/player/program'}
            className="btn btn-ghost as-link"
          >
            Back to Program
          </Link>
        </div>
        {bullpenState.notes?.trim() ? (
          <div className="portal-panel" style={{ minHeight: 'unset', marginBottom: 12 }}>
            <h4 style={{ marginTop: 0 }}>Notes</h4>
            <p className="portal-muted-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{bullpenState.notes.trim()}</p>
          </div>
        ) : null}
        <BullpenEntry
          templates={bullpenTemplates}
          state={bullpenState}
          playerId={resolvedPlayerId}
          previewQuery={playerIdQuery}
          schoolLogoSrc={schoolBrand.logoSrc}
          schoolLogoAlt={schoolBrand.logoAlt}
        />
      </section>
    </div>
  );
}
