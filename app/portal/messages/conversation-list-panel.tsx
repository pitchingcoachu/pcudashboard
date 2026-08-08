'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteConversation,
  deleteGroupConversation,
  listConversations,
  setConversationPinned,
  type ConversationSummary,
} from '../../../lib/messages-client';
import { conversationTitle, conversationPhoto, relativeTime } from './messages-helpers';
import { MessagesAvatar } from './messages-avatar';
import { MessagesContextMenu, type ContextMenuItem } from './messages-context-menu';

const POLL_INTERVAL_MS = 10000;

export function ConversationListPanel({
  currentUserId,
  currentUserRole,
  selectedConversationId,
  onSelectConversation,
}: {
  currentUserId: number;
  currentUserRole: 'admin' | 'coach' | 'player';
  selectedConversationId: number | null;
  onSelectConversation: (conversationId: number) => void;
}) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conversation: ConversationSummary } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await listConversations();
      setConversations(response.conversations ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load]);

  function toggleSection(title: string) {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title);
      else next.add(title);
      return next;
    });
  }

  async function togglePin(conversation: ConversationSummary) {
    const nextPinned = !conversation.pinnedAt;
    setConversations((prev) =>
      prev.map((c) => (c.id === conversation.id ? { ...c, pinnedAt: nextPinned ? new Date().toISOString() : null } : c))
    );
    try {
      await setConversationPinned(String(conversation.id), nextPinned);
    } catch {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversation.id ? { ...c, pinnedAt: conversation.pinnedAt } : c))
      );
    }
  }

  async function handleDeleteConversation(conversation: ConversationSummary) {
    setConversations((prev) => prev.filter((c) => c.id !== conversation.id));
    try {
      await deleteConversation(String(conversation.id));
    } catch {
      setConversations((prev) => [...prev, conversation]);
    }
  }

  async function handleDeleteGroup(conversation: ConversationSummary) {
    if (!window.confirm(`Delete "${conversationTitle(conversation, currentUserId)}" for everyone? This can't be undone.`)) return;
    setConversations((prev) => prev.filter((c) => c.id !== conversation.id));
    try {
      await deleteGroupConversation(String(conversation.id));
    } catch {
      setConversations((prev) => [...prev, conversation]);
    }
  }

  function openContextMenu(event: React.MouseEvent, conversation: ConversationSummary) {
    event.preventDefault();
    setContextMenu({ x: event.clientX, y: event.clientY, conversation });
  }

  function menuItemsFor(conversation: ConversationSummary): ContextMenuItem[] {
    const items: ContextMenuItem[] = [
      {
        label: conversation.pinnedAt ? 'Unpin' : 'Pin',
        onSelect: () => togglePin(conversation),
      },
      {
        label: 'Delete conversation',
        onSelect: () => handleDeleteConversation(conversation),
        danger: true,
      },
    ];
    const isCreator = conversation.createdByUserId !== null && conversation.createdByUserId === currentUserId;
    const canDeleteGroup = conversation.isGroup && (currentUserRole === 'admin' || isCreator);
    if (canDeleteGroup) {
      items.push({
        label: 'Delete group for everyone',
        onSelect: () => handleDeleteGroup(conversation),
        danger: true,
      });
    }
    return items;
  }

  const byRecency = (a: ConversationSummary, b: ConversationSummary) =>
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();

  const pinnedConversations = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: ConversationSummary) => !q || conversationTitle(c, currentUserId).toLowerCase().includes(q);
    return conversations.filter((c) => c.pinnedAt && matches(c)).sort(byRecency);
  }, [conversations, query, currentUserId]);

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (c: ConversationSummary) => !q || conversationTitle(c, currentUserId).toLowerCase().includes(q);
    const filtered = conversations.filter((c) => !c.pinnedAt && matches(c));
    const groups = filtered.filter((c) => c.isGroup).sort(byRecency);
    const individuals = filtered.filter((c) => !c.isGroup).sort(byRecency);
    const toSection = (title: string, data: ConversationSummary[]) => ({
      title,
      count: data.length,
      data: collapsedSections.has(title) ? [] : data,
    });
    return [
      ...(groups.length > 0 ? [toSection('Groups', groups)] : []),
      ...(individuals.length > 0 ? [toSection('Individuals', individuals)] : []),
    ];
  }, [conversations, query, currentUserId, collapsedSections]);

  if (isLoading) {
    return <p className="portal-muted-text" style={{ padding: '1rem' }}>Loading messages...</p>;
  }

  return (
    <div className="portal-messages-list">
      <div className="portal-messages-search-wrap">
        <input
          type="text"
          className="portal-messages-search-input"
          placeholder="Search groups or individuals"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {error ? <p className="auth-error" style={{ padding: '0 1rem' }}>{error}</p> : null}

      {pinnedConversations.length > 0 ? (
        <div className="portal-messages-pinned-wrap">
          <button
            type="button"
            className="portal-messages-section-header"
            onClick={() => toggleSection('Pinned')}
          >
            <span>
              Pinned
              {collapsedSections.has('Pinned') ? ` (${pinnedConversations.length})` : ''}
            </span>
            <span className="portal-messages-chevron">{collapsedSections.has('Pinned') ? '›' : '⌄'}</span>
          </button>
          {!collapsedSections.has('Pinned') ? (
            <div className="portal-messages-pinned-grid">
              {pinnedConversations.map((conversation) => {
                const title = conversationTitle(conversation, currentUserId);
                const isUnread = conversation.unreadCount > 0;
                const isSelected = selectedConversationId === conversation.id;
                return (
                  <button
                    type="button"
                    key={conversation.id}
                    className={`portal-messages-pinned-item${isSelected ? ' is-selected' : ''}`}
                    onClick={() => onSelectConversation(conversation.id)}
                    onContextMenu={(event) => openContextMenu(event, conversation)}
                    title="Right-click for options"
                  >
                    <span className="portal-messages-pinned-avatar-wrap">
                      <MessagesAvatar label={title} photoUrl={conversationPhoto(conversation, currentUserId)} />
                      {isUnread ? <span className="portal-messages-unread-dot" /> : null}
                    </span>
                    <span className={`portal-messages-pinned-label${isUnread ? ' is-unread' : ''}`}>{title}</span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {conversations.length === 0 ? (
        <p className="portal-muted-text" style={{ padding: '1rem' }}>No conversations yet.</p>
      ) : null}

      {sections.map((section) => (
        <div key={section.title}>
          <button
            type="button"
            className="portal-messages-section-header"
            onClick={() => toggleSection(section.title)}
          >
            <span>
              {section.title}
              {collapsedSections.has(section.title) ? ` (${section.count})` : ''}
            </span>
            <span className="portal-messages-chevron">{collapsedSections.has(section.title) ? '›' : '⌄'}</span>
          </button>
          {section.data.map((item) => {
            const title = conversationTitle(item, currentUserId);
            const isSelected = selectedConversationId === item.id;
            const isUnread = item.unreadCount > 0;
            return (
              <button
                type="button"
                key={item.id}
                className={`portal-messages-row${isSelected ? ' is-selected' : ''}`}
                onClick={() => onSelectConversation(item.id)}
                onContextMenu={(event) => openContextMenu(event, item)}
                title="Right-click for options"
              >
                <div className="portal-messages-row-header">
                  <div className="portal-messages-row-title-wrap">
                    {isUnread ? <span className="portal-messages-unread-dot" /> : null}
                    <span className={`portal-messages-row-title${isUnread ? ' is-unread' : ''}`}>{title}</span>
                  </div>
                  <span className="portal-messages-row-time">{relativeTime(item.updatedAt)}</span>
                </div>
                <div className="portal-messages-row-footer">
                  <span className={`portal-messages-row-preview${isUnread ? ' is-unread' : ''}`}>
                    {item.lastMessage
                      ? item.lastMessage.body ?? (item.lastMessage.hasAttachment ? 'Sent an attachment' : '')
                      : 'No messages yet'}
                  </span>
                  {isUnread ? (
                    <span className="portal-messages-badge">{item.unreadCount > 99 ? '99+' : item.unreadCount}</span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      ))}

      {contextMenu ? (
        <MessagesContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={menuItemsFor(contextMenu.conversation)}
          onClose={() => setContextMenu(null)}
        />
      ) : null}
    </div>
  );
}
