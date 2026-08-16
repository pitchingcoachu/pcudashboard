'use client';

import { useEffect, useRef, useState } from 'react';
import { attachmentSrc, MESSAGE_REACTION_EMOJIS, type Message } from '../../../lib/messages-client';

const LONG_PRESS_MS = 420;

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
  onReact,
}: {
  message: Message;
  isOwn: boolean;
  showSenderName: boolean;
  onDelete?: (messageId: number) => void;
  onReact?: (messageId: number, emoji: string) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [actionsVisible, setActionsVisible] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!actionsVisible) return;
    function onPointerDownOutside(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setActionsVisible(false);
        setPickerOpen(false);
      }
    }
    document.addEventListener('pointerdown', onPointerDownOutside);
    return () => document.removeEventListener('pointerdown', onPointerDownOutside);
  }, [actionsVisible]);

  function clearLongPressTimer() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function startLongPress() {
    if (!onReact) return;
    clearLongPressTimer();
    longPressTimer.current = setTimeout(() => {
      setActionsVisible(true);
      setPickerOpen(true);
    }, LONG_PRESS_MS);
  }

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
    <div ref={wrapRef} className={`portal-messages-bubble-wrap${isOwn ? ' is-own' : ' is-other'}`}>
      {showSenderName && message.senderName ? (
        <span className="portal-messages-sender-name">{message.senderName}</span>
      ) : null}
      {onReact || (isOwn && onDelete) ? (
        <div className={`portal-messages-bubble-actions${actionsVisible ? ' is-visible' : ''}`}>
          {onReact ? (
            <button
              type="button"
              className="portal-messages-bubble-action-btn"
              title="Add reaction"
              aria-label="Add reaction"
              aria-expanded={pickerOpen}
              onClick={() => {
                setActionsVisible(true);
                setPickerOpen((open) => !open);
              }}
            >
              ☺
            </button>
          ) : null}
          {isOwn && onDelete ? (
            <button
              type="button"
              className="portal-messages-bubble-action-btn"
              title="Delete message"
              aria-label="Delete message"
              onClick={() => {
                if (window.confirm('Delete this message for everyone?')) onDelete(message.id);
              }}
            >
              ✕
            </button>
          ) : null}
          {pickerOpen && onReact ? (
            <div className="portal-messages-reaction-picker" role="menu" aria-label="Choose a reaction">
              {MESSAGE_REACTION_EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  className="portal-messages-reaction-option"
                  onClick={() => {
                    onReact(message.id, emoji);
                    setPickerOpen(false);
                    setActionsVisible(false);
                  }}
                >
                  {emoji}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className={`portal-messages-bubble${isOwn ? ' is-own' : ' is-other'}`}
        onPointerDown={onReact ? startLongPress : undefined}
        onPointerUp={onReact ? clearLongPressTimer : undefined}
        onPointerLeave={onReact ? clearLongPressTimer : undefined}
        onPointerCancel={onReact ? clearLongPressTimer : undefined}
        onContextMenu={
          onReact
            ? (event) => {
                event.preventDefault();
                setActionsVisible(true);
                setPickerOpen(true);
              }
            : undefined
        }
      >
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
      {message.reactions.length > 0 ? (
        <div className="portal-messages-reactions" aria-label="Message reactions">
          {message.reactions.map((reaction) => (
            <button
              key={reaction.emoji}
              type="button"
              className={`portal-messages-reaction-chip${reaction.reactedByCurrentUser ? ' is-active' : ''}`}
              title={reaction.reactors.map((reactor) => reactor.name).join(', ')}
              aria-label={`${reaction.emoji}, ${reaction.count} reaction${reaction.count === 1 ? '' : 's'}`}
              onClick={() => onReact?.(message.id, reaction.emoji)}
              disabled={!onReact}
            >
              <span>{reaction.emoji}</span>
              <span>{reaction.count}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
