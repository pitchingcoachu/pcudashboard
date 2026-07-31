import { Suspense } from 'react';
import FeedbackWidget from '../feedback-widget';
import PortalActivityTracker from './activity-tracker';
import DashboardChat from './dashboard/dashboard-chat';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PortalActivityTracker />
      </Suspense>
      <Suspense fallback={null}>
        <FeedbackWidget forceVisible />
      </Suspense>
      <DashboardChat />
      {children}
    </>
  );
}
