import type { MetadataRoute } from 'next';
import { SITE_URL } from '../lib/seo/marketing-site';

// One RESTRICTED_PATHS list for "*" and every named agent (a named group ignores "*"). The logged-in app,
// auth flows and previews have no public value; the marketing pages in MARKETING_PAGES stay crawlable.
export const RESTRICTED_PATHS = [
  '/api/',
  '/portal',
  '/login',
  '/forgot-password',
  '/reset-password',
  '/profiles',
  '/tutorials',
  '/messages',
  '/mocap-preview',
  '/spin-model-preview',
  '/spin-test-preview',
];

const ALLOWED_AGENTS = [
  'Googlebot', 'Bingbot', 'Applebot', 'Applebot-Extended', 'Google-Extended', 'DuckDuckBot',
  'GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
  'PerplexityBot', 'Perplexity-User',
];
const BLOCKED_AGENTS = ['Bytespider', 'Diffbot'];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/', disallow: RESTRICTED_PATHS },
      ...ALLOWED_AGENTS.map((userAgent) => ({ userAgent, allow: '/', disallow: RESTRICTED_PATHS })),
      ...BLOCKED_AGENTS.map((userAgent) => ({ userAgent, disallow: '/' })),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
