import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitMessageLinks } from '../lib/message-links.ts';
import { isPublicPreviewAddress, previewHttpUrl, parsePreviewHtml, fetchPreviewResource } from '../lib/message-link-preview.ts';

test('links preserve surrounding text, newlines, and balanced parentheses', () => {
  const input = 'See https://example.com/a_(b).\nAlso (www.example.org/page), thanks!';
  const parts = splitMessageLinks(input);
  assert.equal(parts.map((p) => p.text).join(''), input);
  assert.deepEqual(parts.filter((p) => p.url).map((p) => p.url), ['https://example.com/a_(b)', 'https://www.example.org/page']);
});
test('credentials and unsafe schemes do not become clickable links', () => {
  const text = 'javascript:alert(1) file:///tmp/data https://user:secret@example.com/a';
  assert.deepEqual(splitMessageLinks(text), [{ text }]);
});
test('Open Graph metadata supports either attribute order, entities and relative images', () => {
  const preview = parsePreviewHtml(`<title>Fallback</title>
    <meta content="Coach &amp; Player" property="og:title">
    <META NAME='description' CONTENT='Tips &#x1F94E; &quot;today&quot;'>
    <meta property="og:image" content="/cover.png">
    <meta property="og:site_name" content="Pearl">`, 'https://example.com/posts/1');
  assert.equal(preview.title, 'Coach & Player');
  assert.equal(preview.description, 'Tips 🥎 "today"');
  assert.equal(preview.imageUrl, 'https://example.com/cover.png');
  assert.equal(preview.siteName, 'Pearl');
});
test('title fallback and malformed metadata still produce a usable card', () => {
  const preview = parsePreviewHtml('<title>Test &amp; learn</title><meta property="og:image" content="javascript:alert(1)">', 'https://example.com');
  assert.equal(preview.title, 'Test & learn');
  assert.equal(preview.imageUrl, null);
  assert.equal(parsePreviewHtml('<html></html>', 'https://example.com').title, 'example.com');
});
test('private, reserved, loopback, metadata and tunnel addresses cannot be fetched', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fe80::1', 'fc00::1', '2001:db8::1', '2002:7f00:1::']) assert.equal(isPublicPreviewAddress(ip), false, ip);
  for (const ip of ['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111']) assert.equal(isPublicPreviewAddress(ip), true, ip);
  for (const url of ['file:///tmp/test', 'ftp://example.com', 'http://user:pass@example.com', 'https://example.com:8000']) assert.throws(() => previewHttpUrl(url));
});
test('actual request path rejects numeric loopback URLs before opening a socket', async () => {
  for (const url of ['http://127.0.0.1', 'http://2130706433', 'http://[::1]']) {
    await assert.rejects(fetchPreviewResource(url, 1024), /Not a public URL/);
  }
});
