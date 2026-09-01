'use client';

import { useEffect, useState } from 'react';
import { listMessageableUsers, updateConversationParticipants, type ConversationMeta, type MessageableUsers } from '../../../lib/messages-client';

export function ManageMembersModal({
  conversationId,
  conversation,
  currentUserId,
  onClose,
  onUpdated,
}: {
  conversationId: number;
  conversation: ConversationMeta;
  currentUserId: number;
  onClose: () => void;
  onUpdated: (next: ConversationMeta) => void;
}) {
  const [users, setUsers] = useState<MessageableUsers | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [addUserIds, setAddUserIds] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [isSaving, setIsSaving] = useState<number | 'add' | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listMessageableUsers()
      .then(setUsers)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load people to add.'))
      .finally(() => setIsLoading(false));
  }, []);

  const currentMemberIds = new Set(conversation.participants.map((p) => p.userId));
  const addOptions = [
    ...(users?.players ?? []).map((p) => ({ userId: p.userId, label: p.fullName, sublabel: 'Player' })),
    ...(users?.coaches ?? []).map((c) => ({ userId: c.userId, label: c.name, sublabel: c.role === 'admin' ? 'Admin' : 'Coach' })),
  ].filter((o) => !currentMemberIds.has(o.userId));
  const q = query.trim().toLowerCase();
  const filteredAddOptions = q ? addOptions.filter((o) => o.label.toLowerCase().includes(q)) : addOptions;

  function toggleAdd(userId: number) {
    setAddUserIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  async function handleRemove(userId: number) {
    if (conversation.participants.length <= 2) {
      window.alert('A group needs at least 2 members.');
      return;
    }
    if (!window.confirm('Remove this person from the group?')) return;
    setIsSaving(userId);
    setError('');
    try {
      const response = await updateConversationParticipants(String(conversationId), { removeUserIds: [userId] });
      onUpdated(response.conversation);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member.');
    } finally {
      setIsSaving(null);
    }
  }

  async function handleAdd() {
    if (!addUserIds.length) return;
    setIsSaving('add');
    setError('');
    try {
      const response = await updateConversationParticipants(String(conversationId), { addUserIds });
      onUpdated(response.conversation);
      setAddUserIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add members.');
    } finally {
      setIsSaving(null);
    }
  }

  return (
    <div className="portal-modal-overlay" onClick={onClose}>
      <div className="portal-modal" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="portal-modal-header">
          <h3>Manage Members</h3>
          <button type="button" className="portal-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {error ? <p className="auth-error">{error}</p> : null}

        <p className="portal-muted-text" style={{ margin: '0 0 0.5rem' }}>Current Members</p>
        <div style={{ display: 'grid', gap: 6, marginBottom: '1rem' }}>
          {conversation.participants.map((participant) => (
            <div key={participant.userId} className="portal-choice-line-actions" style={{ justifyContent: 'space-between' }}>
              <span>
                {participant.name}
                {participant.userId === currentUserId ? ' (You)' : ''}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => handleRemove(participant.userId)}
                disabled={isSaving !== null}
              >
                {isSaving === participant.userId ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ))}
        </div>

        <p className="portal-muted-text" style={{ margin: '0 0 0.5rem' }}>Add People</p>
        {isLoading ? (
          <p className="portal-muted-text">Loading…</p>
        ) : (
          <>
            <input
              type="text"
              className="portal-messages-search-input"
              placeholder="Search players or coaches"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              style={{ marginBottom: '0.5rem' }}
            />
            <div className="portal-messages-new-conversation-list" style={{ maxHeight: 220 }}>
              {filteredAddOptions.length === 0 ? (
                <p className="portal-muted-text" style={{ padding: '0.5rem' }}>No matches.</p>
              ) : (
                filteredAddOptions.map((option) => {
                  const isSelected = addUserIds.includes(option.userId);
                  return (
                    <button
                      type="button"
                      key={option.userId}
                      className="portal-messages-new-conversation-row"
                      onClick={() => toggleAdd(option.userId)}
                    >
                      <span className={`portal-messages-checkbox${isSelected ? ' is-selected' : ''}`}>{isSelected ? '✓' : ''}</span>
                      <span>
                        <span className="portal-messages-new-conversation-label">{option.label}</span>
                        <span className="portal-messages-new-conversation-sublabel">{option.sublabel}</span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleAdd}
              disabled={!addUserIds.length || isSaving !== null}
              style={{ width: '100%', marginTop: '0.75rem' }}
            >
              {isSaving === 'add' ? 'Adding…' : `Add ${addUserIds.length || ''}`.trim()}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
