import { Suspense } from 'react';
import FeedbackWidget from '../feedback-widget';
import PortalActivityTracker from './activity-tracker';
import DashboardChat from './dashboard/dashboard-chat';
import { requirePortalSession } from '../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../lib/dashboard-access';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalSession();
  const selectedSchool = resolveDashboardSchoolCode(session);

  return (
    <>
      <Suspense fallback={null}>
        <PortalActivityTracker />
      </Suspense>
      <Suspense fallback={null}>
        <FeedbackWidget forceVisible />
      </Suspense>
      <DashboardChat schoolCode={selectedSchool} />
      {children}
    </>
  );
}
