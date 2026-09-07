import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeMessageContentType, messageAttachmentKind, messageAttachmentDisposition } from '../lib/message-attachments.ts';

const screenshot = 'Screenshot 2026-09-07 at 8.27.52\u202fAM.png';
test('Mac screenshot name can be sent in an HTTP response and round-trips unchanged', async () => {
  assert.throws(() => new Headers({ 'Content-Disposition': `inline; filename="${screenshot}"` }), /ByteString/);
  const disposition = messageAttachmentDisposition(screenshot, 'image/png');
  const response = new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Disposition': disposition, 'Content-Type': 'image/png' } });
  assert.equal(response.status, 200);
  assert.equal(decodeURIComponent(disposition.split("filename*=UTF-8''")[1]), screenshot);
  assert.equal(await response.arrayBuffer().then((b) => b.byteLength), 4);
});
test('Unicode, quotes, backslashes and control characters produce valid headers', () => {
  for (const name of ['截图 🥎.png', 'Résumé.pdf', 'a"\\b\r\nInjected: yes.pdf', 'bad\ud800.png']) {
    const header = messageAttachmentDisposition(name, 'application/pdf');
    assert.doesNotThrow(() => new Headers({ 'Content-Disposition': header }));
    assert.ok(!/[\r\n]/.test(header));
  }
});
test('Files-provider and desktop screenshots without MIME metadata are recognized', () => {
  for (const type of ['', 'application/octet-stream', 'binary/octet-stream']) {
    assert.equal(normalizeMessageContentType(screenshot, type), 'image/png');
    assert.equal(normalizeMessageContentType('PHOTO.JPG', type), 'image/jpeg');
    assert.equal(normalizeMessageContentType('clip.MOV', type), 'video/quicktime');
    assert.equal(normalizeMessageContentType('Report.PDF', type), 'application/pdf');
  }
  assert.equal(normalizeMessageContentType('converted.HEIC', 'image/jpeg'), 'image/jpeg');
  assert.equal(normalizeMessageContentType('photo', 'IMAGE/X-PNG'), 'image/png');
});
test('General documents download instead of disappearing or rendering as photos', () => {
  for (const name of ['report.docx', 'data.xlsx', 'data.csv', 'sound.m4a', 'archive.zip', 'unknown.custom', 'image.heic', 'image.svg', 'page.html']) {
    const type = normalizeMessageContentType(name, '');
    assert.equal(messageAttachmentKind(type), 'file');
    assert.ok(messageAttachmentDisposition(name, type).startsWith('attachment;'));
  }
  assert.equal(messageAttachmentKind('image/png'), 'photo');
  assert.equal(messageAttachmentKind('video/mp4'), 'video');
  assert.equal(messageAttachmentKind('application/pdf'), 'pdf');
});
