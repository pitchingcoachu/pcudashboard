'use client';

// Web port of pearl-player-development's lib/messages-api.ts -- same backend
// (app/api/messaging/*), no bearer token needed since the browser sends the
// session cookie automatically on same-origin fetches.

export type ConversationParticipant = {
  userId: number;
  name: string;
  role: 'admin' | 'coach' | 'player';
  photoDataUrl: string | null;
};

export type ConversationSummary = {
  id: number;
  name: string | null;
  isGroup: boolean;
  photoDataUrl: string | null;
  createdByUserId: number | null;
  participants: ConversationParticipant[];
  lastMessage: {
    id: number;
    body: string | null;
    senderUserId: number | null;
    senderName: string | null;
    createdAt: string;
    hasAttachment: boolean;
  } | null;
  unreadCount: number;
  updatedAt: string;
  pinnedAt: string | null;
};

export type MessageAttachment = {
  id: number;
  kind: 'photo' | 'video' | 'pdf';
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type Message = {
  id: number;
  senderUserId: number | null;
  senderName: string | null;
  body: string | null;
  createdAt: string;
  deletedAt: string | null;
  attachments: MessageAttachment[];
};

export type ConversationMeta = {
  id: number;
  organizationId: number;
  name: string | null;
  isGroup: boolean;
  photoDataUrl: string | null;
  createdByUserId: number | null;
  participants: ConversationParticipant[];
};

export type ConversationAttachment = MessageAttachment & {
  messageId: number;
  createdAt: string;
  senderUserId: number | null;
  senderName: string | null;
};

export type MessageableUsers = {
  players?: Array<{ userId: number; playerId: number; fullName: string }>;
  coaches: Array<{ userId: number; name: string; role: 'admin' | 'coach' }>;
};

class MessagingApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new MessagingApiError(payload.error ?? `Request failed (${response.status})`, response.status);
  }
  return payload as T;
}

export function listConversations() {
  return api<{ conversations: ConversationSummary[] }>('/api/messaging/conversations');
}

export function createConversation(input: { participantUserIds: number[]; name?: string }) {
  return api<{ ok: true; conversationId: number; created: boolean }>('/api/messaging/conversations', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getConversation(conversationId: string, before?: number) {
  const query = before ? `?before=${before}` : '';
  return api<{ conversation: ConversationMeta; messages: Message[]; hasMore: boolean }>(
    `/api/messaging/conversations/${conversationId}${query}`
  );
}

export function getConversationMedia(conversationId: string) {
  return api<{ attachments: ConversationAttachment[] }>(`/api/messaging/conversations/${conversationId}/media`);
}

export function sendMessage(
  conversationId: string,
  input: { body?: string; attachments?: Array<{ r2Key: string; contentType: string; fileName: string; sizeBytes: number }> }
) {
  return api<{ ok: true; message: Message }>(`/api/messaging/conversations/${conversationId}/messages`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function markRead(conversationId: string) {
  return api<{ ok: true }>(`/api/messaging/conversations/${conversationId}/read`, { method: 'POST' });
}

export function setConversationPinned(conversationId: string, pinned: boolean) {
  return api<{ ok: true; pinned: boolean }>(`/api/messaging/conversations/${conversationId}/pin`, {
    method: 'POST',
    body: JSON.stringify({ pinned }),
  });
}

export function deleteConversation(conversationId: string) {
  return api<{ ok: true }>(`/api/messaging/conversations/${conversationId}?mode=hide`, { method: 'DELETE' });
}

export function deleteGroupConversation(conversationId: string) {
  return api<{ ok: true }>(`/api/messaging/conversations/${conversationId}?mode=group`, { method: 'DELETE' });
}

export function deleteMessage(conversationId: string, messageId: number) {
  return api<{ ok: true }>(`/api/messaging/conversations/${conversationId}/messages?messageId=${messageId}`, { method: 'DELETE' });
}

export function setConversationPhoto(conversationId: string, photoDataUrl: string | null) {
  return api<{ ok: true; photoDataUrl: string | null }>(`/api/messaging/conversations/${conversationId}/photo`, {
    method: 'POST',
    body: JSON.stringify({ photoDataUrl }),
  });
}

export function presignAttachment(input: { conversationId: string; fileName: string; contentType: string; sizeBytes: number }) {
  const params = new URLSearchParams({
    presign: '1',
    conversationId: input.conversationId,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: String(input.sizeBytes),
  });
  return api<{ presign: true; uploadUrl: string; r2Key: string; contentType: string }>(
    `/api/messaging/attachments?${params.toString()}`
  );
}

export function listMessageableUsers() {
  return api<MessageableUsers>('/api/messaging/messageable-users');
}

export function attachmentSrc(attachmentId: number): string {
  return `/api/messaging/attachments/${attachmentId}`;
}
