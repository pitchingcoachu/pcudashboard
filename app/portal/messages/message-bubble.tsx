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
  const [namesPopoverEmoji, setNamesPopoverEmoji] = useState<string | null>(null);
  const [zoomedAttachmentId, setZoomedAttachmentId] = useState<number | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!actionsVisible && !namesPopoverEmoji) return;
    function onPointerDownOutside(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) {
        setActionsVisible(false);
        setPickerOpen(false);
        setNamesPopoverEmoji(null);
      }
    }
    document.addEventListener('pointerdown', onPointerDownOutside);
    return () => document.removeEventListener('pointerdown', onPointerDownOutside);
  }, [actionsVisible, namesPopoverEmoji]);

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

  // Photos/videos always render outside the bubble entirely (see the
  // attachments block below, rendered as siblings of .portal-messages-bubble
  // rather than children) -- a caption is its own separate text bubble, not
  // a background sitting behind the media.
  const zoomedAttachment = message.attachments.find((a) => a.id === zoomedAttachmentId) ?? null;

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
      {message.attachments
        .filter((attachment) => attachment.kind === 'photo' || attachment.kind === 'video')
        .map((attachment) => (
          <div
            key={attachment.id}
            className="portal-messages-attachment-standalone"
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
            {attachment.kind === 'photo' ? (
              <button
                type="button"
                className="portal-messages-attachment-zoom-trigger"
                onClick={() => setZoomedAttachmentId(attachment.id)}
                aria-label={`View ${attachment.fileName} full size`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={attachmentSrc(attachment.id)} alt={attachment.fileName} className="portal-messages-attachment-media" />
              </button>
            ) : (
              <video src={attachmentSrc(attachment.id)} controls className="portal-messages-attachment-media" />
            )}
          </div>
        ))}
      {message.attachments.some((a) => a.kind === 'pdf') || message.body ? (
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
          {message.attachments
            .filter((attachment) => attachment.kind === 'pdf')
            .map((attachment) => (
              <a
                key={attachment.id}
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
            ))}
          {message.body ? <p className="portal-messages-bubble-text">{message.body}</p> : null}
        </div>
      ) : null}
      {zoomedAttachment ? (
        <div className="portal-messages-lightbox-overlay" onClick={() => setZoomedAttachmentId(null)}>
          <button
            type="button"
            className="portal-messages-lightbox-close"
            onClick={() => setZoomedAttachmentId(null)}
            aria-label="Close"
          >
            ×
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={attachmentSrc(zoomedAttachment.id)}
            alt={zoomedAttachment.fileName}
            className="portal-messages-lightbox-image"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      ) : null}
      {message.reactions.length > 0 ? (
        <div className="portal-messages-reactions" aria-label="Message reactions">
          {message.reactions.map((reaction) => (
            <div key={reaction.emoji} className="portal-messages-reaction-chip-wrap">
              <button
                type="button"
                className={`portal-messages-reaction-chip${reaction.reactedByCurrentUser ? ' is-active' : ''}`}
                aria-label={`${reaction.emoji}, ${reaction.count} reaction${reaction.count === 1 ? '' : 's'}. Click to see who reacted.`}
                onClick={() => setNamesPopoverEmoji((current) => (current === reaction.emoji ? null : reaction.emoji))}
              >
                <span>{reaction.emoji}</span>
                <span>{reaction.count}</span>
              </button>
              {namesPopoverEmoji === reaction.emoji ? (
                <div className="portal-messages-reaction-names-popover" role="tooltip">
                  {reaction.reactors.map((reactor) => reactor.name).join(', ')}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
