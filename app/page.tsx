import type { Metadata } from 'next';
import HomePage from './home-page';
import { organizationSchema, softwareSchema } from '../lib/seo/marketing-site';

// Server wrapper for the (client) home page, so it can carry its canonical and structured data.
export const metadata: Metadata = { alternates: { canonical: '/' } };

export default function Page() {
  return (
    <>
      {/* One object per script: some parsers and browser extensions assume a single object. */}
      {[organizationSchema(), softwareSchema()].map((node, index) => (
        <script key={index} type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(node).replace(/</g, '\\u003c') }} />
      ))}
      <HomePage />
    </>
  );
}
