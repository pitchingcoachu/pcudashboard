import { Suspense } from 'react';
import FeedbackWidget from '../feedback-widget';
import PortalActivityTracker from './activity-tracker';
import DashboardChat from './dashboard/dashboard-chat';
import { requirePortalSession } from '../../lib/portal-session';
import { resolveDashboardSchoolCode } from '../../lib/dashboard-access';
import { schoolBrandCssVars } from '../../lib/school-brand';
import NativePushRegistration from './native-push-registration';

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalSession();
  const selectedSchool = resolveDashboardSchoolCode(session);
  const schoolThemeClass = `portal-school-theme--${String(selectedSchool || 'pcu').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')}`;

  return (
    <div className={`portal-school-theme ${schoolThemeClass}`} style={schoolBrandCssVars(selectedSchool)}>
      <NativePushRegistration />
      <Suspense fallback={null}>
        <PortalActivityTracker />
      </Suspense>
      <Suspense fallback={null}>
        <FeedbackWidget forceVisible />
      </Suspense>
      <DashboardChat schoolCode={selectedSchool} />
      {children}
    </div>
  );
}
