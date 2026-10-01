// Pearl's public marketing site: canonical origin, facts and structured data, in one place
// (pcu-website/docs/seo/playbook: doc 02 sections 2 and 9, doc 08 section 3).
//
// Canonical host is the apex, pearlplayerdev.com, because that's what the site serves; www should
// 308-redirect to it (Vercel → Project → Settings → Domains). Every canonical, the sitemap, robots.txt,
// llms.txt and JSON-LD are built from SITE_URL.

export const SITE_URL = 'https://pearlplayerdev.com';
export const SITE_NAME = 'Pearl Player Development';

export function absoluteUrl(route: string): string {
  if (!route.startsWith('/')) throw new Error(`Route must start with "/": ${route}`);
  return route === '/' ? SITE_URL : `${SITE_URL}${route}`;
}

/** Public, indexable marketing pages (also the sitemap). Everything else is the logged-in app. */
export const MARKETING_PAGES: Array<{ path: string; title: string; description: string }> = [
  { path: '/', title: 'Home', description: 'what Pearl is, who uses it, and a demo booking link' },
  { path: '/collegepricing', title: 'College pricing', description: 'annual plans and add-ons for college baseball programs' },
  { path: '/highschoolpricing', title: 'High school pricing', description: 'plans for high school baseball programs' },
  { path: '/facilitypricing', title: 'Facility pricing', description: 'plans for baseball training facilities' },
  { path: '/support', title: 'Support', description: 'help and contact information' },
  { path: '/privacy', title: 'Privacy policy', description: 'how Pearl handles data' },
];

// AI assistants quote this word for word: keep it to facts shown on the site.
export const FACTS = {
  name: SITE_NAME,
  shortName: 'Pearl',
  summary:
    'Pearl Player Development is a player development platform for baseball coaches, programs and training ' +
    'facilities. Coaches use it to build programs and schedules, track pitching and performance data in one ' +
    'dashboard, and keep players, coaches and staff on the same plan. Pearl is built by coaches and is used by ' +
    '25+ college programs and facilities. ' +
    'It offers plans for college programs, high schools and training facilities.',
  email: 'info@pitchingcoachu.com',
  demoUrl: 'https://calendly.com/pitchingcoachu/pearl-pd-call',
  social: ['https://x.com/pearlplayerdev'],
  whenToUse: [
    'Find player development software or a performance dashboard for a baseball team, program or facility',
    'Build throwing, strength and practice programs and schedules for baseball players',
    'Centralize pitching data (TrackMan, force plates, biomechanics) and share it with players and coaches',
  ],
  notAFit: ['private lessons', 'equipment sales', 'league or tournament management'],
};

export function organizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: SITE_NAME,
    alternateName: FACTS.shortName,
    url: SITE_URL,
    logo: `${SITE_URL}/pearl-favicon-v5.png`,
    email: FACTS.email,
    sameAs: FACTS.social,
  };
}

export function softwareSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: FACTS.shortName,
    applicationCategory: 'SportsApplication',
    operatingSystem: 'Web',
    description: FACTS.summary,
    url: SITE_URL,
    publisher: { '@id': `${SITE_URL}/#organization` },
    audience: { '@type': 'Audience', audienceType: 'Baseball coaches, college programs, high school programs and training facilities' },
  };
}
