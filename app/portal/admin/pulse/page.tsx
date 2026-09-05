import { notFound } from 'next/navigation';
import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { resolveSchoolBrand } from '../../../../lib/school-brand';
import PulseDashboard from './pulse-dashboard';

export default async function PulsePage() {
  const session = await requirePortalSession();
  if (session.role !== 'admin' && session.role !== 'coach') notFound();
  const schoolCode = resolveDashboardSchoolCode(session);
  const brand = resolveSchoolBrand(schoolCode);
  return <PulseDashboard schoolCode={schoolCode} schoolLogoSrc={brand.logoSrc} schoolLogoAlt={brand.logoAlt} />;
}
