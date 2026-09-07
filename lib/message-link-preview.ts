import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import http from 'node:http';
import https from 'node:https';
import type { MessageLinkPreview } from './message-links';

/** Only public addresses; reject special-use ranges and IPv4 tunnel forms. */
export function isPublicPreviewAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
      || (a === 192 && b === 0) || (a === 192 && b === 88 && c === 99)
      || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
      || (a === 203 && b === 0 && c === 113));
  }
  if (isIP(address) === 6) {
    const first = parseInt(address.split(':')[0], 16);
    const second = parseInt(address.split(':')[1] || '0', 16);
    return (first & 0xe000) === 0x2000 && first !== 0x2002
      && !(first === 0x2001 && (second <= 0x1ff || second === 0xdb8));
  }
  return false;
}

export function previewHttpUrl(input: string): URL {
  if (input.length > 4096) throw new Error('URL too long');
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
    || (url.port && url.port !== '80' && url.port !== '443')) throw new Error('Unsupported URL');
  return url;
}

export type PreviewResource = { url: string; contentType: string; body: Buffer };

/** Resolve each redirect independently and pin the socket to the checked IP. */
export async function fetchPreviewResource(input: string, maxBytes: number, image = false): Promise<PreviewResource> {
  const signal = AbortSignal.timeout(6000);
  let url = previewHttpUrl(input);
  for (let redirect = 0; redirect <= 3; redirect++) {
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = await Promise.race([
      lookup(hostname, { all: true }),
      new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('Preview timed out'));
        else signal.addEventListener('abort', () => reject(new Error('Preview timed out')), { once: true });
      }),
    ]);
    if (!addresses.length || addresses.some((entry) => !isPublicPreviewAddress(entry.address))) throw new Error('Not a public URL');
    const selected = addresses[0];
    const result = await new Promise<PreviewResource | { redirect: string }>((resolve, reject) => {
      const transport = url.protocol === 'https:' ? https : http;
      const request = transport.get(url, {
        signal,
        family: selected.family,
        lookup: (_hostname, _options, callback) => callback(null, selected.address, selected.family),
        headers: { 'User-Agent': 'PearlLinkPreview/1.0', Accept: image ? 'image/*' : 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
      }, (response) => {
        if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0) && response.headers.location) {
          response.destroy();
          resolve({ redirect: new URL(response.headers.location, url).href });
          return;
        }
        const type = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
        const acceptable = image ? ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif'].includes(type)
          : ['text/html', 'application/xhtml+xml'].includes(type);
        if (response.statusCode !== 200 || !acceptable) {
          response.destroy(); reject(new Error('No preview available')); return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            if (image) reject(new Error('Image too large'));
            else resolve({ url: url.href, contentType: type, body: Buffer.concat(chunks) });
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => resolve({ url: url.href, contentType: type, body: Buffer.concat(chunks) }));
        response.on('error', reject);
      });
      request.on('error', reject);
    });
    if ('redirect' in result) { url = previewHttpUrl(result.redirect); continue; }
    return result;
  }
  throw new Error('Too many redirects');
}

function decodeHtml(text: string): string {
  const entities: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match;
    const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
  });
}
const clean = (value: string, limit: number) => decodeHtml(value).replace(/\s+/g, ' ').trim().slice(0, limit);

export function parsePreviewHtml(html: string, pageUrl: string): Omit<MessageLinkPreview, 'imagePath'> & { imageUrl: string | null } {
  const meta = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = new Map<string, string>();
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4]);
    }
    const key = (attrs.get('property') ?? attrs.get('name') ?? '').toLowerCase();
    if (key && attrs.get('content') && !meta.has(key)) meta.set(key, attrs.get('content')!);
  }
  const page = previewHttpUrl(pageUrl);
  let imageUrl: string | null = null;
  try {
    const raw = meta.get('og:image:secure_url') ?? meta.get('og:image') ?? meta.get('twitter:image');
    if (raw) imageUrl = previewHttpUrl(new URL(decodeHtml(raw), page).href).href;
  } catch { /* A title-only card still works. */ }
  return {
    url: page.href,
    title: clean(meta.get('og:title') ?? meta.get('twitter:title') ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? page.hostname, 200),
    description: clean(meta.get('og:description') ?? meta.get('twitter:description') ?? meta.get('description') ?? '', 300) || null,
    siteName: clean(meta.get('og:site_name') ?? page.hostname.replace(/^www\./, ''), 100),
    imageUrl,
  };
}

const cache = new Map<string, { expires: number; result: Promise<MessageLinkPreview> }>();
export function getMessageLinkPreview(input: string): Promise<MessageLinkPreview> {
  const url = previewHttpUrl(input);
  const key = url.href;
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.result;
  const result = (async () => {
    try {
      const resource = await fetchPreviewResource(key, 512 * 1024);
      const parsed = parsePreviewHtml(resource.body.toString('utf8'), resource.url);
      return { url: key, title: parsed.title, description: parsed.description, siteName: parsed.siteName,
        imagePath: parsed.imageUrl ? `/api/messaging/link-preview/image?url=${encodeURIComponent(parsed.imageUrl)}` : null };
    } catch {
      return { url: key, title: url.hostname.replace(/^www\./, ''), description: null, siteName: url.hostname, imagePath: null };
    }
  })();
  if (cache.size >= 200) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 10 * 60_000, result });
  return result;
}
