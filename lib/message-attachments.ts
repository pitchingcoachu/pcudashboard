/** File metadata shared by message uploads and authenticated downloads. */
export const MAX_MESSAGE_ATTACHMENT_BYTES = 100 * 1024 * 1024;
export type MessageAttachmentKind = 'photo' | 'video' | 'pdf' | 'file';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', heic: 'image/heic',
  heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', svg: 'image/svg+xml',
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', json: 'application/json',
  html: 'text/html', htm: 'text/html', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
};
const PREVIEW_IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/bmp']);

export function normalizeMessageContentType(fileName: string, reportedType: string): string {
  const type = reportedType.split(';')[0].trim().toLowerCase();
  if (type === 'image/jpg' || type === 'image/pjpeg') return 'image/jpeg';
  if (type === 'image/x-png') return 'image/png';
  if (type && type !== 'application/octet-stream' && type !== 'binary/octet-stream'
    && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type)) return type;
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? 'application/octet-stream';
}

export function messageAttachmentKind(contentType: string): MessageAttachmentKind {
  if (PREVIEW_IMAGES.has(contentType)) return 'photo';
  if (contentType.startsWith('video/')) return 'video';
  if (contentType === 'application/pdf') return 'pdf';
  return 'file';
}

/** Headers require ASCII here; preserve the original Unicode name via RFC 5987. */
export function messageAttachmentDisposition(fileName: string, contentType: string): string {
  const name = fileName.replace(/[\r\n\u0000]/g, '').toWellFormed() || 'attachment';
  const fallback = name.replace(/[^\x20-\x7e]|["\\/]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  const disposition = messageAttachmentKind(contentType) === 'file' ? 'attachment' : 'inline';
  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
