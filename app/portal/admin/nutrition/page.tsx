import { notFound } from 'next/navigation';
import Link from 'next/link';
import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { listNutritionAdherenceForOrg } from '../../../../lib/training-db';

type NutritionAdherencePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function adherenceTone(daysLogged: number, daysInRange: number): 'good' | 'warn' | 'bad' {
  const rate = daysInRange > 0 ? daysLogged / daysInRange : 0;
  if (rate >= 0.7) return 'good';
  if (rate >= 0.35) return 'warn';
  return 'bad';
}

function calorieTone(avgCalories: number | null, targetCalories: number | null): 'good' | 'warn' | 'neutral' {
  if (avgCalories == null || targetCalories == null || targetCalories <= 0) return 'neutral';
  const diffRatio = Math.abs(avgCalories - targetCalories) / targetCalories;
  if (diffRatio <= 0.1) return 'good';
  return 'warn';
}

const TONE_COLORS: Record<'good' | 'warn' | 'bad' | 'neutral', string> = {
  good: 'rgba(52, 199, 89, 0.9)',
  warn: 'rgba(255, 199, 48, 0.9)',
  bad: 'rgba(255, 82, 82, 0.9)',
  neutral: 'rgba(255,255,255,0.5)',
};

export default async function NutritionAdherencePage({ searchParams }: NutritionAdherencePageProps) {
  const session = await requirePortalSession();
  if (session.role === 'player') notFound();

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) notFound();

  const params = await searchParams;
  const endDate = readParam(params.endDate) || isoDaysAgo(0);
  const startDate = readParam(params.startDate) || isoDaysAgo(29);

  const rows = await listNutritionAdherenceForOrg({ organizationId, startDate, endDate });

  return (
    <div className="portal-admin-stack">
      <div className="portal-admin-headline">
        <h2>Nutrition Adherence</h2>
        <p>Roster-wide logging consistency and calorie targets, {startDate} to {endDate}.</p>
      </div>

      <article className="portal-admin-card">
        <form className="portal-form-grid" action="/portal/admin/nutrition">
          <label>
            Start date
            <input type="date" name="startDate" defaultValue={startDate} />
          </label>
          <label>
            End date
            <input type="date" name="endDate" defaultValue={endDate} />
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
            <button type="submit" className="btn btn-primary">Apply</button>
            <Link href="/portal/admin/nutrition" className="btn btn-ghost as-link">Reset</Link>
          </div>
        </form>
      </article>

      <article className="portal-admin-card portal-admin-card-wide">
        <h3>Roster</h3>
        <div className="portal-table-wrap">
          <table className="portal-table">
            <thead>
              <tr>
                <th>Player</th>
                <th>Days Logged</th>
                <th>Avg Calories</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const tone = adherenceTone(row.daysLogged, row.daysInRange);
                const calTone = calorieTone(row.avgCalories, row.targetCalories);
                return (
                  <tr key={row.playerId}>
                    <td><strong>{row.playerName}</strong></td>
                    <td>
                      <span style={{ color: TONE_COLORS[tone], fontWeight: 600 }}>
                        {row.daysLogged} / {row.daysInRange}
                      </span>
                    </td>
                    <td style={{ color: TONE_COLORS[calTone] }}>
                      {row.avgCalories != null ? Math.round(row.avgCalories) : '-'}
                    </td>
                    <td>{row.targetCalories ?? 'Not set'}</td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4}>No active players found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
