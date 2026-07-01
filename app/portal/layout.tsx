import { Suspense } from 'react';
import PortalActivityTracker from './activity-tracker';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Suspense fallback={null}>
        <PortalActivityTracker />
      </Suspense>
      {children}
    </>
  );
}
