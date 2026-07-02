'use client';

type PortalActivityDetail = {
  eventType?: string;
  path: string;
  metadata?: Record<string, unknown>;
};

export function dashboardActivityPath(...parts: string[]): string {
  const clean = parts
    .map((part) => String(part ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean);
  return `/portal/dashboard${clean.length ? `/${clean.join('/')}` : ''}`;
}

export function dispatchPortalActivity(detail: PortalActivityDetail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<PortalActivityDetail>('pcu:portal-activity', { detail }));
}
