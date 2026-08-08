'use client';

import { useRouter } from 'next/navigation';
import { ConversationListPanel } from './conversation-list-panel';
import { ConversationThreadPanel } from './conversation-thread-panel';

export function MessagesShell({
  currentUserId,
  currentUserRole,
  selectedConversationId,
}: {
  currentUserId: number;
  currentUserRole: 'admin' | 'coach' | 'player';
  selectedConversationId: number | null;
}) {
  const router = useRouter();

  return (
    <div className="portal-messages-shell">
      <div className="portal-messages-list-pane">
        <div className="portal-messages-list-pane-header">
          <h3>Messages</h3>
          <button type="button" className="btn btn-ghost portal-messages-new-button" onClick={() => router.push('/portal/messages/new')}>
            + New
          </button>
        </div>
        <ConversationListPanel
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          selectedConversationId={selectedConversationId}
          onSelectConversation={(id) => router.push(`/portal/messages/${id}`)}
        />
      </div>
      <div className="portal-messages-detail-pane">
        {selectedConversationId ? (
          <ConversationThreadPanel conversationId={selectedConversationId} currentUserId={currentUserId} />
        ) : (
          <p className="portal-muted-text" style={{ padding: '2rem', textAlign: 'center' }}>
            Select a conversation
          </p>
        )}
      </div>
    </div>
  );
}
