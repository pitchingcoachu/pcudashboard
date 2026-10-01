'use client';

import { Analytics } from '@vercel/analytics/next';
import { MARKETING_PAGES } from '../lib/seo/marketing-site';

const PUBLIC_PATHS = new Set(MARKETING_PAGES.map((page) => page.path));

/** Vercel Web Analytics (cookieless) for the public marketing pages only; the logged-in app isn't tracked. */
export default function MarketingAnalytics() {
  return <Analytics beforeSend={(event) => (PUBLIC_PATHS.has(new URL(event.url).pathname) ? event : null)} />;
}
