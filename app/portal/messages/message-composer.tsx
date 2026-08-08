'use client';

import { useRef, useState } from 'react';
import { presignAttachment, sendMessage, type Message } from '../../../lib/messages-client';

type StagedFile = {
  key: string;
  file: File;
  status: 'uploading' | 'ready' | 'error';
  error?: string;
  uploaded?: { r2Key: string; contentType: string; fileName: string; sizeBytes: number };
};

const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

export function MessageComposer({
  conversationId,
  onSent,
}: {
  conversationId: string;
  onSent: (message: Message) => void;
}) {
  const [text, setText] = useState('');
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [isSending, setIsSending] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadFile(entry: StagedFile) {
    try {
      const presigned = await presignAttachment({
        conversationId,
        fileName: entry.file.name,
        contentType: entry.file.type || 'application/octet-stream',
        sizeBytes: entry.file.size,
      });
      const putResponse = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': presigned.contentType },
        body: entry.file,
      });
      if (!putResponse.ok) throw new Error('Upload failed.');
      setStaged((prev) =>
        prev.map((s) =>
          s.key === entry.key
            ? {
                ...s,
                status: 'ready',
                uploaded: {
                  r2Key: presigned.r2Key,
                  contentType: presigned.contentType,
                  fileName: entry.file.name,
                  sizeBytes: entry.file.size,
                },
              }
            : s
        )
      );
    } catch (err) {
      setStaged((prev) =>
        prev.map((s) => (s.key === entry.key ? { ...s, status: 'error', error: err instanceof Error ? err.message : 'Upload failed.' } : s))
      );
    }
  }

  function handleFilesPicked(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: StagedFile[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_ATTACHMENT_BYTES) {
        window.alert(`${file.name} is too large. Limit is 100 MB.`);
        continue;
      }
      const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
      next.push({ key, file, status: 'uploading' });
    }
    if (next.length === 0) return;
    setStaged((prev) => [...prev, ...next]);
    next.forEach((entry) => void uploadFile(entry));
  }

  function removeStaged(key: string) {
    setStaged((prev) => prev.filter((s) => s.key !== key));
  }

  const isUploading = staged.some((s) => s.status === 'uploading');
  const readyAttachments = staged.filter((s) => s.status === 'ready' && s.uploaded).map((s) => s.uploaded!);

  async function handleSend() {
    const trimmed = text.trim();
    if (isUploading) {
      window.alert('Wait for attachments to finish uploading before sending.');
      return;
    }
    if (!trimmed && readyAttachments.length === 0) return;
    setIsSending(true);
    try {
      const response = await sendMessage(conversationId, {
        body: trimmed || undefined,
        attachments: readyAttachments,
      });
      onSent(response.message);
      setText('');
      setStaged([]);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Message not sent. Please try again.');
    } finally {
      setIsSending(false);
    }
  }

  const canSend = (Boolean(text.trim()) || staged.some((s) => s.status === 'ready')) && !isUploading && !isSending;

  return (
    <div className="portal-messages-composer-wrap">
      {staged.length > 0 ? (
        <div className="portal-messages-staged-row">
          {staged.map((entry) => (
            <div key={entry.key} className={`portal-messages-staged-chip is-${entry.status}`}>
              <span className="portal-messages-staged-name">{entry.file.name}</span>
              {entry.status === 'uploading' ? <span className="portal-messages-staged-status">Uploading...</span> : null}
              {entry.status === 'error' ? <span className="portal-messages-staged-status is-error">{entry.error}</span> : null}
              <button type="button" className="portal-messages-staged-remove" onClick={() => removeStaged(entry.key)} aria-label="Remove attachment">
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="portal-messages-composer-row">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*,application/pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            handleFilesPicked(event.target.files);
            event.target.value = '';
          }}
        />
        <button
          type="button"
          className="portal-messages-attach-button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isSending}
          aria-label="Attach file"
        >
          +
        </button>
        <textarea
          className="portal-messages-text-input"
          placeholder="Message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          disabled={isSending}
          rows={1}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void handleSend();
            }
          }}
        />
        <button type="button" className="btn btn-primary portal-messages-send-button" onClick={handleSend} disabled={!canSend}>
          {isSending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
