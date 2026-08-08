'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createConversation, listMessageableUsers, type MessageableUsers } from '../../../lib/messages-client';

type Option = { userId: number; label: string; sublabel: string };

export function NewConversationPanel() {
  const router = useRouter();
  const [users, setUsers] = useState<MessageableUsers | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [groupName, setGroupName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    listMessageableUsers()
      .then(setUsers)
      .catch((err) => window.alert(err instanceof Error ? err.message : 'Failed to load. Please try again.'))
      .finally(() => setIsLoading(false));
  }, []);

  function toggle(userId: number) {
    setSelectedIds((prev) => (prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]));
  }

  async function handleCreate() {
    if (selectedIds.length === 0) return;
    if (selectedIds.length > 1 && !groupName.trim()) {
      window.alert('Give your group chat a name.');
      return;
    }
    setIsCreating(true);
    try {
      const response = await createConversation({
        participantUserIds: selectedIds,
        name: selectedIds.length > 1 ? groupName.trim() : undefined,
      });
      router.push(`/portal/messages/${response.conversationId}`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not start conversation. Please try again.');
    } finally {
      setIsCreating(false);
    }
  }

  if (isLoading) {
    return <p className="portal-muted-text" style={{ padding: '1rem' }}>Loading...</p>;
  }

  const options: Option[] = [
    ...(users?.players ?? []).map((p) => ({ userId: p.userId, label: p.fullName, sublabel: 'Player' })),
    ...(users?.coaches ?? []).map((c) => ({ userId: c.userId, label: c.name, sublabel: c.role === 'admin' ? 'Admin' : 'Coach' })),
  ];
  const q = query.trim().toLowerCase();
  const filteredOptions = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;

  return (
    <div className="portal-messages-new-conversation">
      <div className="portal-messages-search-wrap">
        <input
          type="text"
          className="portal-messages-search-input"
          placeholder="Search players or coaches"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="portal-messages-new-conversation-list">
        {filteredOptions.length === 0 ? (
          <p className="portal-muted-text" style={{ padding: '1rem' }}>
            {options.length === 0 ? 'No one available to message yet.' : 'No matches.'}
          </p>
        ) : (
          filteredOptions.map((option) => {
            const isSelected = selectedIds.includes(option.userId);
            return (
              <button
                type="button"
                key={option.userId}
                className="portal-messages-new-conversation-row"
                onClick={() => toggle(option.userId)}
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
      <div className="portal-messages-new-conversation-footer">
        {selectedIds.length > 1 ? (
          <input
            type="text"
            className="portal-messages-search-input"
            placeholder="Group name"
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            style={{ marginBottom: '0.75rem' }}
          />
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleCreate}
          disabled={selectedIds.length === 0 || isCreating}
          style={{ width: '100%' }}
        >
          {isCreating ? 'Creating...' : selectedIds.length > 1 ? 'Create Group' : 'Start Conversation'}
        </button>
      </div>
    </div>
  );
}
