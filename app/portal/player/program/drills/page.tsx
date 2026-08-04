import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { canUseProgrammingData, resolveProgrammingOrganizationId } from '../../../../../lib/programming-scope';
import { normalizeDrillsState } from '../../../../../lib/drills-program';
import { getPlayerForUser, listExercisesByOrganization } from '../../../../../lib/training-db';
import DrillsReadonly from './drills-readonly';

type DrillsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlayerDrillsPage({ searchParams }: DrillsPageProps) {
  const session = await requirePortalSession();
  if (!(await canUseProgrammingData(session))) redirect('/portal/player/program');
  const params = await searchParams;
  const canPreview = session.role === 'admin' || session.role === 'coach';
  const previewPlayerId = Number(typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '0');
  const playerIdQuery = canPreview && Number.isFinite(previewPlayerId) && previewPlayerId > 0 ? `?playerId=${previewPlayerId}` : '';
  let resolvedPlayerId = 0;
  if (session.role === 'player') {
    const player = await getPlayerForUser({ organizationId: session.organizationId, userId: session.userId });
    resolvedPlayerId = Number(player?.id ?? session.playerId ?? 0);
  } else if (canPreview && previewPlayerId > 0) {
    resolvedPlayerId = previewPlayerId;
  }
  const h = await headers();
  const host = h.get('host');
  if (!host) redirect('/portal/player/program');
  const protocol = h.get('x-forwarded-proto') ?? 'http';
  const response = await fetch(`${protocol}://${host}/api/player/throwing${playerIdQuery}`, {
    headers: { cookie: (await cookies()).toString() },
    cache: 'no-store',
  }).catch(() => null);
  const payload = response ? await response.json().catch(() => ({})) : {};
  const drillsState = normalizeDrillsState((payload as { drillsState?: unknown }).drillsState);
  const programmingOrganizationId = await resolveProgrammingOrganizationId(session);
  const drillVideos = programmingOrganizationId > 0
    ? (await listExercisesByOrganization(programmingOrganizationId))
        .map((exercise) => ({
          name: exercise.name,
          instructionVideoUrl: String(exercise.instructionVideoUrl ?? '').trim(),
        }))
        .filter((exercise) => exercise.name.trim() && exercise.instructionVideoUrl)
    : [];
  const backHref = canPreview && previewPlayerId > 0
    ? `/portal/player/program?previewPlayerId=${previewPlayerId}`
    : '/portal/player/program';

  return (
    <div className="portal-shell">
      <section className="portal-panel">
        <div className="portal-row-between">
          <h2 style={{ marginTop: 0 }}>Plyos and Drills</h2>
          <Link href={backHref} className="btn btn-ghost as-link">Back to Program</Link>
        </div>
        <DrillsReadonly state={drillsState} drillVideos={drillVideos} playerId={resolvedPlayerId} />
      </section>
    </div>
  );
}
