import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveProgrammingOrganizationId } from '../../../../lib/programming-scope';
import { listNutritionAdherenceForOrg } from '../../../../lib/training-db';
import NutritionDashboard from './nutrition-dashboard';

type NutritionAdherencePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

export default async function NutritionAdherencePage({ searchParams }: NutritionAdherencePageProps) {
  const session = await requirePortalSession();
  if (session.role === 'player') notFound();

  const organizationId = await resolveProgrammingOrganizationId(session);
  if (organizationId <= 0) notFound();

  const params = await searchParams;
  const endDate = readParam(params.endDate) || isoDaysAgo(0);
  const startDate = readParam(params.startDate) || isoDaysAgo(29);
  const rows = await listNutritionAdherenceForOrg({ organizationId, startDate, endDate });

  return <NutritionDashboard key={`${startDate}-${endDate}`} initialRows={rows} initialStartDate={startDate} initialEndDate={endDate} />;
}
