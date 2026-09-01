'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteMessage, getConversation, markRead, setConversationPhoto, toggleMessageReaction, type ConversationMeta, type Message } from '../../../lib/messages-client';
import { conversationTitle, conversationPhoto } from './messages-helpers';
import { MessagesAvatar } from './messages-avatar';
import { MessageBubble } from './message-bubble';
import { MessageComposer } from './message-composer';
import { ManageMembersModal } from './manage-members-modal';

const POLL_INTERVAL_MS = 7000;
const MAX_GROUP_PHOTO_BYTES = 2_000_000;

export function ConversationThreadPanel({
  conversationId,
  currentUserId,
  currentUserRole,
  onBack,
}: {
  conversationId: number;
  currentUserId: number;
  currentUserRole: 'admin' | 'coach' | 'player';
  onBack?: () => void;
}) {
  const [conversation, setConversation] = useState<ConversationMeta | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [showManageMembers, setShowManageMembers] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);

  const fetchMessages = useCallback(async () => {
    try {
      const response = await getConversation(String(conversationId));
      setConversation(response.conversation);
      setMessages(response.messages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load conversation.');
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    setIsLoading(true);
    fetchMessages();
    markRead(String(conversationId)).catch(() => {});
    const interval = setInterval(fetchMessages, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [conversationId, fetchMessages]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  function handleSent(message: Message) {
    setMessages((prev) => [...prev, message]);
  }

  async function handleDeleteMessage(messageId: number) {
    const previous = messages;
    setMessages((prev) =>
      prev.map((item) => (item.id === messageId ? { ...item, body: null, deletedAt: new Date().toISOString(), attachments: [] } : item))
    );
    try {
      await deleteMessage(String(conversationId), messageId);
    } catch (err) {
      setMessages(previous);
      window.alert(err instanceof Error ? err.message : 'Failed to delete message.');
    }
  }

  async function handleReaction(messageId: number, emoji: string) {
    let snapshot: Message[] = [];
    setMessages((current) => {
      snapshot = current;
      return current.map((message) => {
        if (message.id !== messageId || message.deletedAt) return message;
        const existing = message.reactions.find((reaction) => reaction.emoji === emoji);
        if (existing?.reactedByCurrentUser) {
          const count = Math.max(0, existing.count - 1);
          return {
            ...message,
            reactions: count === 0
              ? message.reactions.filter((reaction) => reaction.emoji !== emoji)
              : message.reactions.map((reaction) => reaction.emoji === emoji ? {
                ...reaction,
                count,
                reactedByCurrentUser: false,
                reactors: reaction.reactors.filter((reactor) => reactor.userId !== currentUserId),
              } : reaction),
          };
        }
        if (existing) {
          return {
            ...message,
            reactions: message.reactions.map((reaction) => reaction.emoji === emoji ? {
              ...reaction,
              count: reaction.count + 1,
              reactedByCurrentUser: true,
              reactors: [...reaction.reactors, { userId: currentUserId, name: 'You' }],
            } : reaction),
          };
        }
        return {
          ...message,
          reactions: [...message.reactions, {
            emoji,
            count: 1,
            reactedByCurrentUser: true,
            reactors: [{ userId: currentUserId, name: 'You' }],
          }],
        };
      });
    });
    try {
      await toggleMessageReaction(String(conversationId), messageId, emoji);
    } catch (err) {
      setMessages(snapshot);
      window.alert(err instanceof Error ? err.message : 'Failed to update reaction.');
    }
  }

  async function handlePhotoPicked(files: FileList | null) {
    const file = files?.[0];
    if (!file || !conversation) return;
    const reader = new FileReader();
    setUploadingPhoto(true);
    reader.onload = async () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (!dataUrl) {
        setUploadingPhoto(false);
        return;
      }
      if (dataUrl.length > MAX_GROUP_PHOTO_BYTES) {
        window.alert('Photo is too large. Please choose a smaller image.');
        setUploadingPhoto(false);
        return;
      }
      try {
        await setConversationPhoto(String(conversationId), dataUrl);
        setConversation((prev) => (prev ? { ...prev, photoDataUrl: dataUrl } : prev));
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'Failed to save photo.');
      } finally {
        setUploadingPhoto(false);
      }
    };
    reader.onerror = () => setUploadingPhoto(false);
    reader.readAsDataURL(file);
  }

  if (isLoading) {
    return <p className="portal-muted-text" style={{ padding: '1rem' }}>Loading conversation...</p>;
  }

  if (error || !conversation) {
    return <p className="auth-error" style={{ padding: '1rem' }}>{error ?? 'Conversation not found.'}</p>;
  }

  const title = conversationTitle(conversation, currentUserId);
  const photoUrl = conversationPhoto(conversation, currentUserId);
  const isGroup = conversation.isGroup;

  return (
    <div className="portal-messages-thread">
      <div className="portal-messages-thread-header">
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(event) => {
            handlePhotoPicked(event.target.files);
            event.target.value = '';
          }}
        />
        {onBack ? (
          <button type="button" className="portal-messages-thread-back" aria-label="Back to messages" onClick={onBack}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
        <button
          type="button"
          className="portal-messages-thread-avatar-button"
          onClick={() => (isGroup ? photoInputRef.current?.click() : undefined)}
          disabled={!isGroup || uploadingPhoto}
          title={isGroup ? 'Change group photo' : undefined}
        >
          <MessagesAvatar label={title} size={40} photoUrl={photoUrl} />
          {isGroup ? <span className="portal-messages-thread-avatar-edit-badge">{uploadingPhoto ? '…' : '📷'}</span> : null}
        </button>
        <h2 className="portal-messages-thread-title">{title}</h2>
        {isGroup && currentUserRole !== 'player' ? (
          <button type="button" className="btn btn-ghost" onClick={() => setShowManageMembers(true)}>
            Members
          </button>
        ) : null}
      </div>
      {showManageMembers && conversation ? (
        <ManageMembersModal
          conversationId={conversationId}
          conversation={conversation}
          currentUserId={currentUserId}
          onClose={() => setShowManageMembers(false)}
          onUpdated={(next) => setConversation(next)}
        />
      ) : null}
      <div className="portal-messages-thread-list" ref={listRef}>
        {[...messages].map((message, index) => {
          const isOwn = String(message.senderUserId) === String(currentUserId);
          const prevMessage = messages[index - 1];
          const showSenderName = isGroup && !isOwn && prevMessage?.senderUserId !== message.senderUserId;
          return (
            <MessageBubble
              key={message.id}
              message={message}
              isOwn={isOwn}
              showSenderName={showSenderName}
              onDelete={handleDeleteMessage}
              onReact={handleReaction}
            />
          );
        })}
      </div>
      <MessageComposer conversationId={String(conversationId)} onSent={handleSent} />
    </div>
  );
}
