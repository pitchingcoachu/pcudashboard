'use client';

import { attachmentSrc, type Message } from '../../../lib/messages-client';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function MessageBubble({
  message,
  isOwn,
  showSenderName,
  onDelete,
}: {
  message: Message;
  isOwn: boolean;
  showSenderName: boolean;
  onDelete?: (messageId: number) => void;
}) {
  if (message.deletedAt) {
    return (
      <div className={`portal-messages-bubble-wrap${isOwn ? ' is-own' : ' is-other'}`}>
        {showSenderName && message.senderName ? (
          <span className="portal-messages-sender-name">{message.senderName}</span>
        ) : null}
        <div className={`portal-messages-bubble${isOwn ? ' is-own' : ' is-other'}`}>
          <p className="portal-messages-bubble-text portal-messages-bubble-deleted">Message deleted</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`portal-messages-bubble-wrap${isOwn ? ' is-own' : ' is-other'}`}>
      {showSenderName && message.senderName ? (
        <span className="portal-messages-sender-name">{message.senderName}</span>
      ) : null}
      {isOwn && onDelete ? (
        <div className="portal-messages-bubble-actions">
          <button
            type="button"
            className="portal-messages-bubble-action-btn"
            title="Delete message"
            onClick={() => {
              if (window.confirm('Delete this message for everyone?')) onDelete(message.id);
            }}
          >
            ✕
          </button>
        </div>
      ) : null}
      <div className={`portal-messages-bubble${isOwn ? ' is-own' : ' is-other'}`}>
        {message.attachments.map((attachment) => (
          <div key={attachment.id} className="portal-messages-attachment">
            {attachment.kind === 'photo' ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={attachmentSrc(attachment.id)} alt={attachment.fileName} className="portal-messages-attachment-media" />
            ) : null}
            {attachment.kind === 'video' ? (
              <video src={attachmentSrc(attachment.id)} controls className="portal-messages-attachment-media" />
            ) : null}
            {attachment.kind === 'pdf' ? (
              <a
                href={attachmentSrc(attachment.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="portal-messages-pdf-chip"
              >
                <span className="portal-messages-pdf-icon">PDF</span>
                <span className="portal-messages-pdf-meta">
                  <span className="portal-messages-pdf-name">{attachment.fileName}</span>
                  <span className="portal-messages-pdf-size">{formatBytes(attachment.sizeBytes)}</span>
                </span>
              </a>
            ) : null}
          </div>
        ))}
        {message.body ? <p className="portal-messages-bubble-text">{message.body}</p> : null}
      </div>
    </div>
  );
}
