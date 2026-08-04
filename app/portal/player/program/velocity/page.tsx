import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { canUseProgrammingData } from '../../../../../lib/programming-scope';
import SharedScriptReadonly from '../shared-script-readonly';

type VelocityPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlayerVelocityPage({ searchParams }: VelocityPageProps) {
  const session = await requirePortalSession();
  if (!(await canUseProgrammingData(session))) redirect('/portal/player/program');
  const canPreview = session.role === 'admin' || session.role === 'coach';
  const params = await searchParams;
  const previewPlayerIdRaw = typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '';
  const previewPlayerId = Number(previewPlayerIdRaw ?? '0');
  const playerIdQuery = canPreview && Number.isFinite(previewPlayerId) && previewPlayerId > 0 ? `?playerId=${previewPlayerId}` : '';

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
  const velocityTemplates = Array.isArray((payload as { velocityTemplates?: unknown[] }).velocityTemplates) ? ((payload as { velocityTemplates?: Array<{ id: string; name: string; rowCount: number; columns: string[]; rows: string[][] }> }).velocityTemplates ?? []) : [];
  const velocityState = ((payload as { velocityState?: { current: { title: string; rowCount: number; columns: string[]; rows: string[][] }; selectedTemplateId: string; visibleTemplateIds: string[]; notes?: string } }).velocityState ?? {
    current: { title: '', rowCount: 20, columns: ['Pitch Type', 'Ball Type', 'Stretch/Windup', 'Location', 'Situation', 'Notes'], rows: [] },
    selectedTemplateId: '',
    visibleTemplateIds: [],
    notes: '',
  });

  return (
    <div className="portal-shell">
      <section className="portal-panel">
        <div className="portal-row-between">
          <h2 style={{ marginTop: 0 }}>Velocity</h2>
          <Link href={canPreview && previewPlayerId > 0 ? `/portal/player/program?previewPlayerId=${previewPlayerId}` : '/portal/player/program'} className="btn btn-ghost as-link">
            Back to Program
          </Link>
        </div>
        <SharedScriptReadonly mode="velocity" templates={velocityTemplates} state={velocityState} notes={String(velocityState.notes ?? '')} />
      </section>
    </div>
  );
}
