import type { ConversationMeta, ConversationSummary } from '../../../lib/messages-client';

export function conversationTitle(
  conversation: ConversationSummary | ConversationMeta,
  currentUserId: number
): string {
  if (conversation.isGroup) return conversation.name || 'Group';
  const other = conversation.participants.find((p) => String(p.userId) !== String(currentUserId));
  return other?.name ?? 'Conversation';
}

export function conversationPhoto(
  conversation: ConversationSummary | ConversationMeta,
  currentUserId: number
): string | null {
  if (conversation.isGroup) return conversation.photoDataUrl;
  const other = conversation.participants.find((p) => String(p.userId) !== String(currentUserId));
  return other?.photoDataUrl ?? null;
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
