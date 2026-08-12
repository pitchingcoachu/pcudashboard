import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { canUseProgrammingData } from '../../../../../lib/programming-scope';
import { resolveProgrammingSchoolCode } from '../../../../../lib/programming-scope';
import { resolveSchoolBrand } from '../../../../../lib/school-brand';
import { getPlayerForUser } from '../../../../../lib/training-db';
import ScriptEntry from '../shared-script-entry';

type HittingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlayerHittingPage({ searchParams }: HittingPageProps) {
  const session = await requirePortalSession();
  if (!(await canUseProgrammingData(session))) redirect('/portal/player/program');
  const schoolBrand = resolveSchoolBrand(resolveProgrammingSchoolCode(session));
  const canPreview = session.role === 'admin' || session.role === 'coach';
  const params = await searchParams;
  const previewPlayerIdRaw = typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '';
  const previewPlayerId = Number(previewPlayerIdRaw ?? '0');
  const playerIdQuery = canPreview && Number.isFinite(previewPlayerId) && previewPlayerId > 0 ? `?playerId=${previewPlayerId}` : '';

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
  const response = await fetch(`${protocol}://${host}/api/player/hitting${playerIdQuery}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => ({})) : {};

  type Template = { id: string; name: string; rowCount: number; columns: string[]; columnTypes?: string[]; rows: string[][] };
  const hittingTemplates: Template[] = Array.isArray((payload as { hittingTemplates?: Template[] }).hittingTemplates)
    ? ((payload as { hittingTemplates?: Template[] }).hittingTemplates ?? [])
    : [];
  const hittingState = (payload as {
    hittingState?: { selectedTemplateId: string; visibleTemplateIds: string[]; notes?: string }
  }).hittingState ?? { selectedTemplateId: '', visibleTemplateIds: [], notes: '' };

  return (
    <div className="portal-shell">
      <section className="portal-panel">
        <div className="portal-row-between">
          <h2 style={{ marginTop: 0 }}>BP Templates</h2>
          <Link
            href={canPreview && previewPlayerId > 0 ? `/portal/player/program?previewPlayerId=${previewPlayerId}` : '/portal/player/program'}
            className="btn btn-ghost as-link"
          >
            Back to Program
          </Link>
        </div>
        {hittingState.notes?.trim() ? (
          <div className="portal-panel" style={{ minHeight: 'unset', marginBottom: 12 }}>
            <h4 style={{ marginTop: 0 }}>Notes</h4>
            <p className="portal-muted-text" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{hittingState.notes.trim()}</p>
          </div>
        ) : null}
        <ScriptEntry
          mode="hitting"
          templates={hittingTemplates}
          state={hittingState}
          playerId={resolvedPlayerId}
          previewQuery={playerIdQuery}
          schoolLogoSrc={schoolBrand.logoSrc}
          schoolLogoAlt={schoolBrand.logoAlt}
        />
      </section>
    </div>
  );
}
