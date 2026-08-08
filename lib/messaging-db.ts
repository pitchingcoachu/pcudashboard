import { getDbPool, isDatabaseConfigured } from './auth-db';

let messagingTablesReady: Promise<void> | null = null;

async function createMessagingTables(): Promise<void> {
  const pool = getDbPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id BIGSERIAL PRIMARY KEY,
      organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT,
      is_group BOOLEAN NOT NULL DEFAULT FALSE,
      created_by_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversations_org_updated ON conversations (organization_id, updated_at DESC);`);
  // Group photo, stored as a raw base64 data URL -- same pattern as
  // players.profile_photo_data_url (see auth-db.ts), not R2, so mobile can
  // hand it straight to <Image> without a signed-URL round trip.
  await pool.query(`ALTER TABLE conversations ADD COLUMN IF NOT EXISTS photo_data_url TEXT;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS conversation_participants (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      pinned_at TIMESTAMPTZ
    );
  `);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_participants_unique ON conversation_participants (conversation_id, user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_conversation_participants_user ON conversation_participants (user_id);`);
  // pinned_at predates this column on existing tables -- add it if missing.
  await pool.query(`ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;`);
  // hidden_at is a per-user "delete conversation" -- clears the conversation from
  // just this participant's own list without touching the row for anyone else.
  await pool.query(`ALTER TABLE conversation_participants ADD COLUMN IF NOT EXISTS hidden_at TIMESTAMPTZ;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS messages (
      id BIGSERIAL PRIMARY KEY,
      conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      sender_user_id BIGINT REFERENCES auth_users(id) ON DELETE SET NULL,
      body TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages (conversation_id, created_at DESC);`);
  // deleted_at marks an unsent message -- body/attachments are cleared on
  // unsend, this timestamp is what the UI uses to render a placeholder.
  await pool.query(`ALTER TABLE messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS message_attachments (
      id BIGSERIAL PRIMARY KEY,
      message_id BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      r2_key TEXT NOT NULL,
      content_type TEXT NOT NULL,
      kind TEXT NOT NULL,
      file_name TEXT NOT NULL,
      size_bytes BIGINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments (message_id);`);
}

export async function ensureMessagingTablesReady(): Promise<void> {
  if (!isDatabaseConfigured()) return;
  if (!messagingTablesReady) {
    messagingTablesReady = createMessagingTables().catch((err) => {
      messagingTablesReady = null;
      throw err;
    });
  }
  await messagingTablesReady;
}

export type ConversationParticipantSummary = {
  userId: number;
  name: string;
  role: 'admin' | 'coach' | 'player';
  // Resolved from players.profile_photo_data_url via players.user_id -- null
  // for anyone who isn't a linked player (coaches/admins) or hasn't set one.
  photoDataUrl: string | null;
};

export type ConversationListRow = {
  id: number;
  name: string | null;
  isGroup: boolean;
  photoDataUrl: string | null;
  createdByUserId: number | null;
  participants: ConversationParticipantSummary[];
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

export type MessageAttachmentRow = {
  id: number;
  kind: 'photo' | 'video' | 'pdf';
  fileName: string;
  contentType: string;
  sizeBytes: number;
};

export type MessageRow = {
  id: number;
  senderUserId: number | null;
  senderName: string | null;
  body: string | null;
  createdAt: string;
  deletedAt: string | null;
  attachments: MessageAttachmentRow[];
};

export type ConversationMeta = {
  id: number;
  organizationId: number;
  name: string | null;
  isGroup: boolean;
  photoDataUrl: string | null;
  createdByUserId: number | null;
  participants: ConversationParticipantSummary[];
};

async function insertParticipants(conversationId: number, userIds: number[]): Promise<void> {
  const pool = getDbPool();
  const uniqueIds = Array.from(new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (uniqueIds.length === 0) return;
  const values = uniqueIds.map((_, index) => `($1, $${index + 2})`).join(', ');
  await pool.query(
    `INSERT INTO conversation_participants (conversation_id, user_id) VALUES ${values} ON CONFLICT DO NOTHING`,
    [conversationId, ...uniqueIds]
  );
}

export async function findOrCreateOneToOneConversation(input: {
  organizationId: number;
  userIdA: number;
  userIdB: number;
  createdByUserId: number;
}): Promise<{ id: number; created: boolean }> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const { organizationId, userIdA, userIdB, createdByUserId } = input;

  const findExisting = async (): Promise<number | null> => {
    const result = await pool.query<{ id: number }>(
      `
        SELECT c.id
        FROM conversations c
        WHERE c.organization_id = $1
          AND c.is_group = FALSE
          AND (SELECT COUNT(*) FROM conversation_participants cp WHERE cp.conversation_id = c.id) = 2
          AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $2)
          AND EXISTS (SELECT 1 FROM conversation_participants cp WHERE cp.conversation_id = c.id AND cp.user_id = $3)
        LIMIT 1
      `,
      [organizationId, userIdA, userIdB]
    );
    return result.rows[0]?.id ?? null;
  };

  const existingId = await findExisting();
  if (existingId) return { id: existingId, created: false };

  try {
    const inserted = await pool.query<{ id: number }>(
      `INSERT INTO conversations (organization_id, is_group, created_by_user_id) VALUES ($1, FALSE, $2) RETURNING id`,
      [organizationId, createdByUserId]
    );
    const conversationId = inserted.rows[0].id;
    await insertParticipants(conversationId, [userIdA, userIdB]);
    return { id: conversationId, created: true };
  } catch (err: unknown) {
    const code = (err as { code?: string } | null)?.code;
    if (code === '23505') {
      const raceWinnerId = await findExisting();
      if (raceWinnerId) return { id: raceWinnerId, created: false };
    }
    throw err;
  }
}

export async function createGroupConversation(input: {
  organizationId: number;
  name: string;
  participantUserIds: number[];
  createdByUserId: number;
}): Promise<{ id: number }> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO conversations (organization_id, name, is_group, created_by_user_id) VALUES ($1, $2, TRUE, $3) RETURNING id`,
    [input.organizationId, input.name, input.createdByUserId]
  );
  const conversationId = inserted.rows[0].id;
  await insertParticipants(conversationId, [...input.participantUserIds, input.createdByUserId]);
  return { id: conversationId };
}

export async function listConversationsForUser(input: {
  organizationId: number;
  userId: number;
}): Promise<ConversationListRow[]> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const result = await pool.query<{
    id: number;
    name: string | null;
    is_group: boolean;
    photo_data_url: string | null;
    created_by_user_id: number | null;
    updated_at: string;
    last_read_at: string;
    pinned_at: string | null;
    unread_count: string;
    last_message_id: number | null;
    last_message_body: string | null;
    last_message_sender_id: number | null;
    last_message_sender_name: string | null;
    last_message_created_at: string | null;
    last_message_has_attachment: boolean | null;
    participants: { userId: number; name: string; role: string; photoDataUrl: string | null }[] | null;
  }>(
    `
      SELECT
        c.id,
        c.name,
        c.is_group,
        c.photo_data_url,
        c.created_by_user_id,
        c.updated_at,
        my_cp.last_read_at,
        my_cp.pinned_at,
        COUNT(m.id) FILTER (WHERE m.created_at > my_cp.last_read_at AND m.sender_user_id IS DISTINCT FROM $2)::text AS unread_count,
        lm.id AS last_message_id,
        lm.body AS last_message_body,
        lm.sender_user_id AS last_message_sender_id,
        lm_sender.name AS last_message_sender_name,
        lm.created_at AS last_message_created_at,
        (EXISTS (SELECT 1 FROM message_attachments ma WHERE ma.message_id = lm.id)) AS last_message_has_attachment,
        (
          SELECT jsonb_agg(jsonb_build_object('userId', u.id, 'name', COALESCE(NULLIF(u.name, ''), u.email), 'role', u.role, 'photoDataUrl', p.profile_photo_data_url))
          FROM conversation_participants cp2
          JOIN auth_users u ON u.id = cp2.user_id
          LEFT JOIN players p ON p.user_id = u.id
          WHERE cp2.conversation_id = c.id
        ) AS participants
      FROM conversations c
      JOIN conversation_participants my_cp ON my_cp.conversation_id = c.id AND my_cp.user_id = $2
      LEFT JOIN messages m ON m.conversation_id = c.id
      LEFT JOIN LATERAL (
        SELECT * FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1
      ) lm ON TRUE
      LEFT JOIN auth_users lm_sender ON lm_sender.id = lm.sender_user_id
      WHERE c.organization_id = $1
        AND (my_cp.hidden_at IS NULL OR c.updated_at > my_cp.hidden_at)
      GROUP BY c.id, c.name, c.is_group, c.photo_data_url, c.created_by_user_id, c.updated_at, my_cp.last_read_at, my_cp.pinned_at, lm.id, lm.body, lm.sender_user_id, lm_sender.name, lm.created_at
      ORDER BY c.updated_at DESC
    `,
    [input.organizationId, input.userId]
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    isGroup: row.is_group,
    photoDataUrl: row.photo_data_url,
    createdByUserId: row.created_by_user_id,
    participants: (row.participants ?? []).map((p) => ({
      userId: p.userId,
      name: p.name,
      role: p.role === 'coach' || p.role === 'player' ? p.role : 'admin',
      photoDataUrl: p.photoDataUrl,
    })),
    lastMessage: row.last_message_id
      ? {
          id: row.last_message_id,
          body: row.last_message_body,
          senderUserId: row.last_message_sender_id,
          senderName: row.last_message_sender_name,
          createdAt: row.last_message_created_at as string,
          hasAttachment: Boolean(row.last_message_has_attachment),
        }
      : null,
    unreadCount: Number(row.unread_count ?? '0') || 0,
    updatedAt: row.updated_at,
    pinnedAt: row.pinned_at,
  }));
}

export async function getConversationParticipantIds(conversationId: number): Promise<number[]> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const result = await pool.query<{ user_id: number }>(
    `SELECT user_id FROM conversation_participants WHERE conversation_id = $1`,
    [conversationId]
  );
  return result.rows.map((row) => row.user_id);
}

export async function isConversationParticipant(input: { conversationId: number; userId: number }): Promise<boolean> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT 1 FROM conversation_participants WHERE conversation_id = $1 AND user_id = $2 LIMIT 1`,
    [input.conversationId, input.userId]
  );
  return result.rows.length > 0;
}

export async function getConversationMeta(conversationId: number): Promise<ConversationMeta | null> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const conversationResult = await pool.query<{
    id: number;
    organization_id: number;
    name: string | null;
    is_group: boolean;
    photo_data_url: string | null;
    created_by_user_id: number | null;
  }>(
    `SELECT id, organization_id, name, is_group, photo_data_url, created_by_user_id FROM conversations WHERE id = $1 LIMIT 1`,
    [conversationId]
  );
  const conversation = conversationResult.rows[0];
  if (!conversation) return null;

  const participantsResult = await pool.query<{ user_id: number; name: string | null; email: string; role: string; photo_data_url: string | null }>(
    `
      SELECT u.id AS user_id, u.name, u.email, u.role, p.profile_photo_data_url AS photo_data_url
      FROM conversation_participants cp
      JOIN auth_users u ON u.id = cp.user_id
      LEFT JOIN players p ON p.user_id = u.id
      WHERE cp.conversation_id = $1
    `,
    [conversationId]
  );

  return {
    id: conversation.id,
    organizationId: conversation.organization_id,
    name: conversation.name,
    isGroup: conversation.is_group,
    photoDataUrl: conversation.photo_data_url,
    createdByUserId: conversation.created_by_user_id,
    participants: participantsResult.rows.map((row) => ({
      userId: row.user_id,
      name: (row.name ?? '').trim() || row.email,
      role: row.role === 'coach' || row.role === 'player' ? row.role : 'admin',
      photoDataUrl: row.photo_data_url,
    })),
  };
}

export async function listMessages(input: {
  conversationId: number;
  beforeMessageId?: number | null;
  limit: number;
}): Promise<{ messages: MessageRow[]; hasMore: boolean }> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const limit = Math.max(1, Math.min(100, input.limit));

  const result = await pool.query<{
    id: number;
    sender_user_id: number | null;
    sender_name: string | null;
    body: string | null;
    created_at: string;
    deleted_at: string | null;
  }>(
    `
      SELECT m.id, m.sender_user_id, COALESCE(NULLIF(u.name, ''), u.email) AS sender_name, m.body, m.created_at, m.deleted_at
      FROM messages m
      LEFT JOIN auth_users u ON u.id = m.sender_user_id
      WHERE m.conversation_id = $1 AND ($2::bigint IS NULL OR m.id < $2)
      ORDER BY m.id DESC
      LIMIT $3
    `,
    [input.conversationId, input.beforeMessageId ?? null, limit + 1]
  );

  const hasMore = result.rows.length > limit;
  const page = result.rows.slice(0, limit);
  const messageIds = page.map((row) => row.id);

  const attachmentsByMessage = new Map<number, MessageAttachmentRow[]>();
  if (messageIds.length > 0) {
    const attachmentsResult = await pool.query<{
      id: number;
      message_id: number;
      kind: string;
      file_name: string;
      content_type: string;
      size_bytes: string;
    }>(
      `SELECT id, message_id, kind, file_name, content_type, size_bytes FROM message_attachments WHERE message_id = ANY($1::bigint[])`,
      [messageIds]
    );
    for (const row of attachmentsResult.rows) {
      const list = attachmentsByMessage.get(row.message_id) ?? [];
      list.push({
        id: row.id,
        kind: row.kind === 'video' || row.kind === 'pdf' ? row.kind : 'photo',
        fileName: row.file_name,
        contentType: row.content_type,
        sizeBytes: Number(row.size_bytes ?? '0') || 0,
      });
      attachmentsByMessage.set(row.message_id, list);
    }
  }

  const messages = page
    .map((row) => ({
      id: row.id,
      senderUserId: row.sender_user_id,
      senderName: row.sender_name,
      body: row.body,
      createdAt: row.created_at,
      deletedAt: row.deleted_at,
      attachments: attachmentsByMessage.get(row.id) ?? [],
    }))
    .reverse();

  return { messages, hasMore };
}

export type ConversationAttachmentRow = MessageAttachmentRow & {
  messageId: number;
  createdAt: string;
  senderUserId: number | null;
  senderName: string | null;
};

/** Every attachment in a conversation, newest first -- for the "shared
 * media" gallery. Unlike listMessages, this isn't paginated by message page;
 * a conversation's total attachment count is small enough in practice that
 * fetching them all in one query is simpler and cheaper than paging through
 * every message just to collect their attachments client-side. */
export async function listAttachmentsForConversation(conversationId: number): Promise<ConversationAttachmentRow[]> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const result = await pool.query<{
    id: number;
    message_id: number;
    kind: string;
    file_name: string;
    content_type: string;
    size_bytes: string;
    created_at: string;
    sender_user_id: number | null;
    sender_name: string | null;
  }>(
    `
      SELECT
        ma.id, ma.message_id, ma.kind, ma.file_name, ma.content_type, ma.size_bytes, ma.created_at,
        m.sender_user_id,
        COALESCE(NULLIF(u.name, ''), u.email) AS sender_name
      FROM message_attachments ma
      JOIN messages m ON m.id = ma.message_id
      LEFT JOIN auth_users u ON u.id = m.sender_user_id
      WHERE m.conversation_id = $1
      ORDER BY ma.created_at DESC, ma.id DESC
    `,
    [conversationId]
  );
  return result.rows.map((row) => ({
    id: row.id,
    messageId: row.message_id,
    kind: row.kind === 'video' || row.kind === 'pdf' ? row.kind : 'photo',
    fileName: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes ?? '0') || 0,
    createdAt: row.created_at,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
  }));
}

export async function getMessageById(messageId: number): Promise<MessageRow | null> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const result = await pool.query<{
    id: number;
    sender_user_id: number | null;
    sender_name: string | null;
    body: string | null;
    created_at: string;
    deleted_at: string | null;
  }>(
    `
      SELECT m.id, m.sender_user_id, COALESCE(NULLIF(u.name, ''), u.email) AS sender_name, m.body, m.created_at, m.deleted_at
      FROM messages m
      LEFT JOIN auth_users u ON u.id = m.sender_user_id
      WHERE m.id = $1
      LIMIT 1
    `,
    [messageId]
  );
  const row = result.rows[0];
  if (!row) return null;

  const attachmentsResult = await pool.query<{
    id: number;
    kind: string;
    file_name: string;
    content_type: string;
    size_bytes: string;
  }>(
    `SELECT id, kind, file_name, content_type, size_bytes FROM message_attachments WHERE message_id = $1`,
    [messageId]
  );

  return {
    id: row.id,
    senderUserId: row.sender_user_id,
    senderName: row.sender_name,
    body: row.body,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    attachments: attachmentsResult.rows.map((a) => ({
      id: a.id,
      kind: a.kind === 'video' || a.kind === 'pdf' ? a.kind : 'photo',
      fileName: a.file_name,
      contentType: a.content_type,
      sizeBytes: Number(a.size_bytes ?? '0') || 0,
    })),
  };
}

export async function createMessage(input: {
  conversationId: number;
  senderUserId: number;
  body: string | null;
  attachments: Array<{ r2Key: string; contentType: string; kind: 'photo' | 'video' | 'pdf'; fileName: string; sizeBytes: number }>;
}): Promise<{ id: number }> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO messages (conversation_id, sender_user_id, body) VALUES ($1, $2, $3) RETURNING id`,
      [input.conversationId, input.senderUserId, input.body]
    );
    const messageId = inserted.rows[0].id;
    for (const attachment of input.attachments) {
      await client.query(
        `INSERT INTO message_attachments (message_id, r2_key, content_type, kind, file_name, size_bytes) VALUES ($1, $2, $3, $4, $5, $6)`,
        [messageId, attachment.r2Key, attachment.contentType, attachment.kind, attachment.fileName, attachment.sizeBytes]
      );
    }
    await client.query(`UPDATE conversations SET updated_at = NOW() WHERE id = $1`, [input.conversationId]);
    await client.query('COMMIT');
    return { id: messageId };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function markConversationRead(input: { conversationId: number; userId: number }): Promise<void> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  await pool.query(
    `UPDATE conversation_participants SET last_read_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
    [input.conversationId, input.userId]
  );
}

export async function setConversationPinned(input: { conversationId: number; userId: number; pinned: boolean }): Promise<void> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  await pool.query(
    `UPDATE conversation_participants SET pinned_at = CASE WHEN $3 THEN NOW() ELSE NULL END WHERE conversation_id = $1 AND user_id = $2`,
    [input.conversationId, input.userId, input.pinned]
  );
}

/** Per-user "delete conversation" -- clears it from just this participant's
 * own list. Not a real delete: the row, its messages, and the other
 * participant(s)' view are untouched. Reappears automatically the next time
 * a new message lands (see the hidden_at check in listConversationsForUser),
 * matching how this behavior works in most messaging apps. */
export async function hideConversationForUser(input: { conversationId: number; userId: number }): Promise<void> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  await pool.query(
    `UPDATE conversation_participants SET hidden_at = NOW() WHERE conversation_id = $1 AND user_id = $2`,
    [input.conversationId, input.userId]
  );
}

/** Unsend/delete a message for everyone -- clears the body and drops any
 * attachments (DB rows + returns their r2Keys so the caller can delete the
 * underlying objects), but keeps the message row itself so the thread's
 * ordering/pagination is undisturbed and the UI can render a "deleted"
 * placeholder in its place. Only the sender may call this -- enforced by the
 * caller (route handler), same convention as every other auth check in this
 * file living outside of messaging-db.ts. */
export async function unsendMessage(input: { messageId: number }): Promise<{ ok: true; r2Keys: string[] } | { ok: false; error: string }> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const attachmentsResult = await client.query<{ r2_key: string }>(
      `SELECT r2_key FROM message_attachments WHERE message_id = $1`,
      [input.messageId]
    );
    const updated = await client.query(
      `UPDATE messages SET body = NULL, deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
      [input.messageId]
    );
    if ((updated.rowCount ?? 0) < 1) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Message not found or already deleted.' };
    }
    await client.query(`DELETE FROM message_attachments WHERE message_id = $1`, [input.messageId]);
    await client.query('COMMIT');
    return { ok: true, r2Keys: attachmentsResult.rows.map((row) => row.r2_key) };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Full delete of a group conversation for everyone -- cascades to
 * conversation_participants, messages, and message_attachments via their
 * existing ON DELETE CASCADE FKs. Returns the attachment r2Keys so the
 * caller can clean up storage. Authorization (creator or org admin, group
 * only) is enforced by the route handler, not here. */
export async function deleteGroupConversation(conversationId: number): Promise<string[]> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const attachmentsResult = await pool.query<{ r2_key: string }>(
    `SELECT ma.r2_key FROM message_attachments ma JOIN messages m ON m.id = ma.message_id WHERE m.conversation_id = $1`,
    [conversationId]
  );
  await pool.query(`DELETE FROM conversations WHERE id = $1`, [conversationId]);
  return attachmentsResult.rows.map((row) => row.r2_key);
}

// Group photo only -- individuals' avatars come from their own player
// profile photo, not something set per-conversation. Same 2MB cap as
// players.profile_photo_data_url (see auth-db.ts's updatePlayerProfile).
const MAX_GROUP_PHOTO_DATA_URL_BYTES = 2_000_000;

export async function setConversationPhoto(input: { conversationId: number; photoDataUrl: string | null }): Promise<void> {
  await ensureMessagingTablesReady();
  if (input.photoDataUrl && input.photoDataUrl.length > MAX_GROUP_PHOTO_DATA_URL_BYTES) {
    throw new Error('Photo is too large.');
  }
  const pool = getDbPool();
  await pool.query(
    `UPDATE conversations SET photo_data_url = $2 WHERE id = $1 AND is_group = TRUE`,
    [input.conversationId, input.photoDataUrl]
  );
}

export async function getMessageAttachment(attachmentId: number): Promise<{
  id: number;
  r2Key: string;
  contentType: string;
  fileName: string;
  conversationId: number;
} | null> {
  await ensureMessagingTablesReady();
  const pool = getDbPool();
  const result = await pool.query<{
    id: number;
    r2_key: string;
    content_type: string;
    file_name: string;
    conversation_id: number;
  }>(
    `
      SELECT ma.id, ma.r2_key, ma.content_type, ma.file_name, m.conversation_id
      FROM message_attachments ma
      JOIN messages m ON m.id = ma.message_id
      WHERE ma.id = $1
      LIMIT 1
    `,
    [attachmentId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    r2Key: row.r2_key,
    contentType: row.content_type,
    fileName: row.file_name,
    conversationId: row.conversation_id,
  };
}

export async function listMessageablePlayersForOrganization(organizationId: number): Promise<
  Array<{ userId: number; playerId: number; fullName: string }>
> {
  if (!isDatabaseConfigured()) return [];
  const pool = getDbPool();
  const result = await pool.query<{ player_id: number; user_id: number; full_name: string }>(
    `
      SELECT p.id AS player_id, p.user_id, p.full_name
      FROM players p
      WHERE p.organization_id = $1 AND p.user_id IS NOT NULL
      ORDER BY p.full_name ASC
    `,
    [organizationId]
  );
  return result.rows.map((row) => ({ userId: row.user_id, playerId: row.player_id, fullName: row.full_name }));
}
