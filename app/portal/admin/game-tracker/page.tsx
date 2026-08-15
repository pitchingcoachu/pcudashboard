import GameTrackerHub from '../../../../components/game-tracker/game-tracker-hub';
import { resolveDashboardSchoolCode } from '../../../../lib/dashboard-access';
import { requirePortalSession } from '../../../../lib/portal-session';
import { resolveSchoolBrand } from '../../../../lib/school-brand';

export default async function GameTrackerPage() {
  const session = await requirePortalSession();
  const brand = resolveSchoolBrand(resolveDashboardSchoolCode(session));
  return <GameTrackerHub logoSrc={brand.logoSrc ?? '/pearl-clam-transparent.png'} />;
}
