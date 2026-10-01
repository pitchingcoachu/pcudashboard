import type { MetadataRoute } from 'next';
import { MARKETING_PAGES, absoluteUrl } from '../lib/seo/marketing-site';

// Indexable public pages only; the app behind login never goes in. No lastModified: a perpetual "now"
// teaches crawlers to ignore the field.
export default function sitemap(): MetadataRoute.Sitemap {
  return MARKETING_PAGES.map((page) => ({ url: absoluteUrl(page.path) }));
}
