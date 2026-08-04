import Link from 'next/link';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { requirePortalSession } from '../../../../../lib/portal-session';
import { canUseProgrammingData } from '../../../../../lib/programming-scope';
import ThrowingReadonly from './throwing-readonly';

type ThrowingPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function PlayerThrowingPage({ searchParams }: ThrowingPageProps) {
  const session = await requirePortalSession();
  if (!(await canUseProgrammingData(session))) redirect('/portal/player/program');
  const canPreview = session.role === 'admin' || session.role === 'coach';
  const params = await searchParams;
  const previewPlayerIdRaw = typeof params.previewPlayerId === 'string' ? params.previewPlayerId : '';
  const initialDate = typeof params.date === 'string' && params.date ? params.date : undefined;
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
  const byDate = ((payload as { byDate?: Record<string, { intensity: string; distance: string; throwsText: string; drills: string; bullpen: string }> }).byDate ?? {});
  const weekNotes = ((payload as { weekNotes?: Record<string, string> }).weekNotes ?? {});

  return (
    <div className="portal-shell">
      <section className="portal-panel">
        <div className="portal-row-between">
          <h2 style={{ marginTop: 0 }}>Throwing Calendar</h2>
          <Link href={canPreview && previewPlayerId > 0 ? `/portal/player/program?previewPlayerId=${previewPlayerId}` : '/portal/player/program'} className="btn btn-ghost as-link">
            Back to Program
          </Link>
        </div>
        {Object.keys(byDate).length === 0 ? (
          <p className="portal-muted-text">No throwing calendar data yet.</p>
        ) : (
          <ThrowingReadonly byDate={byDate} weekNotes={weekNotes} initialDate={initialDate} />
        )}
      </section>
    </div>
  );
}
