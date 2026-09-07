import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';
import * as metadata from '../lib/message-attachments.ts';
const require = createRequire(import.meta.url);

// Run the real route handlers with isolated auth/storage; never create messages
// or write test attachments in a real conversation.
function loadRoute(file, { participant = true, environment = 'development', attachment } = {}) {
  const writes = [];
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const storage = { getR2Bucket: () => 'test', getR2Client: () => ({ send: async (command) => {
    writes.push(command.input);
    return { ContentLength: 4, Body: (async function* () { yield new Uint8Array([137, 80, 78, 71]); })() };
  } }) };
  function routeRequire(name) {
    if (name === 'next/headers') return { cookies: async () => ({}) };
    if (name === 'next/server') return { NextResponse: Response };
    if (name.endsWith('/auth')) return { getSessionFromRequest: () => ({ userId: 42, organizationId: 7 }) };
    if (name.endsWith('/biomechanics-storage')) return storage;
    if (name.endsWith('/message-attachments')) return metadata;
    if (name.endsWith('/messaging-db')) return {
      isConversationParticipant: async () => participant,
      getConversationMeta: async () => ({ organizationId: 7 }),
      getMessageAttachment: async () => attachment,
    };
    return require(name);
  }
  vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {
    process: { env: { NODE_ENV: environment } }, Buffer, File, Response, Request, Headers, URL, Uint8Array, ReadableStream, console,
  })(routeRequire, module, module.exports);
  return { ...module.exports, writes };
}
const name = 'Screenshot 2026-09-07 at 8.27.52\u202fAM.png';
function uploadRequest() {
  const form = new FormData();
  form.set('file', new File([new Uint8Array([137, 80, 78, 71])], name));
  return new Request('http://localhost:3000/api/messaging/attachments/local?conversationId=12', { method: 'POST', body: form });
}
test('local screenshot upload preserves bytes/name, detects PNG, and uses the conversation storage prefix', async () => {
  const route = loadRoute('app/api/messaging/attachments/local/route.ts');
  const response = await route.POST(uploadRequest());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.fileName, name);
  assert.equal(result.contentType, 'image/png');
  assert.equal(result.sizeBytes, 4);
  assert.match(result.r2Key, /^chat-attachments\/org-7\/conversation-12\/photo-/);
  assert.deepEqual([...route.writes[0].Body], [137, 80, 78, 71]);
});
test('local upload refuses nonparticipants and is disabled in production', async () => {
  for (const [options, status] of [[{ participant: false }, 403], [{ environment: 'production' }, 404]]) {
    const route = loadRoute('app/api/messaging/attachments/local/route.ts', options);
    assert.equal((await route.POST(uploadRequest())).status, status);
    assert.equal(route.writes.length, 0);
  }
});
test('existing Mac screenshot attachments stream successfully with an encoded filename', async () => {
  const route = loadRoute('app/api/messaging/attachments/[attachmentId]/route.ts', {
    attachment: { conversationId: 12, r2Key: 'test/screenshot', fileName: name, contentType: 'image/png' },
  });
  const response = await route.GET(new Request('http://localhost/api/messaging/attachments/1'), { params: Promise.resolve({ attachmentId: '1' }) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/png');
  assert.match(response.headers.get('Content-Disposition'), /%E2%80%AF/);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137, 80, 78, 71]);
});
test('general files are delivered as downloads with content sniffing disabled', async () => {
  const route = loadRoute('app/api/messaging/attachments/[attachmentId]/route.ts', {
    attachment: { conversationId: 12, r2Key: 'test/document', fileName: 'report.html', contentType: 'text/html' },
  });
  const response = await route.GET(new Request('http://localhost/api/messaging/attachments/1'), { params: Promise.resolve({ attachmentId: '1' }) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Disposition'), /^attachment;/);
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
});
