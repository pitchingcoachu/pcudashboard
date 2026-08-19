import { redirect } from 'next/navigation';
import GameTrackerHub from '../../../../components/game-tracker/game-tracker-hub';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { requirePortalSession } from '../../../../lib/portal-session';
import { canUseGameTracker } from '../../../../lib/programming-scope';
import { resolveSchoolBrand } from '../../../../lib/school-brand';

export default async function GameTrackerPage() {
  const session = await requirePortalSession();
  if (!(await canUseGameTracker(session))) redirect('/portal/admin');
  const brand = resolveSchoolBrand(resolveDashboardSchoolCode(session));
  return <GameTrackerHub logoSrc={brand.logoSrc ?? '/pearl-clam-transparent.png'} />;
}
