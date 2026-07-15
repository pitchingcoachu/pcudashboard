import { Suspense } from 'react';
import FeedbackWidget from '../feedback-widget';
import PortalActivityTracker from './activity-tracker';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PortalActivityTracker />
      </Suspense>
      <Suspense fallback={null}>
        <FeedbackWidget forceVisible />
      </Suspense>
      {children}
    </>
  );
}
