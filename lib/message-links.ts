export type MessageLinkPart = { text: string; url?: string };
export type MessageLinkPreview = { url: string; title: string; description: string | null; siteName: string; imagePath: string | null };

/** Keep punctuation outside links without breaking balanced URL parentheses. */
export function splitMessageLinks(text: string): MessageLinkPart[] {
  const parts: MessageLinkPart[] = [];
  const pattern = /\b(?:https?:\/\/|www\.)[^\s<>"“”‘’]+/gi;
  let position = 0;
  for (const match of text.matchAll(pattern)) {
    let label = match[0].replace(/[.,!?;:'’]+$/, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (label.endsWith(close) && label.split(close).length > label.split(open).length) label = label.slice(0, -1);
    }
    let url: URL;
    try { url = new URL(/^www\./i.test(label) ? `https://${label}` : label); } catch { continue; }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
    const start = match.index!;
    if (start > position) parts.push({ text: text.slice(position, start) });
    parts.push({ text: label, url: url.href });
    position = start + label.length;
  }
  if (position < text.length) parts.push({ text: text.slice(position) });
  return parts.length ? parts : [{ text }];
}
