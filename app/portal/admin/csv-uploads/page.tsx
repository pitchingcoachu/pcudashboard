import { notFound } from 'next/navigation';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { requirePortalSession } from '../../../../lib/portal-session';
import CsvUploadsWorkspace from './csv-uploads-workspace';

export default async function CsvUploadsPage() {
  const session = await requirePortalSession();
  if (session.role !== 'admin') notFound();
  const schoolCode = resolveDashboardSchoolCode(session);

  return <CsvUploadsWorkspace schoolCode={schoolCode} />;
}
