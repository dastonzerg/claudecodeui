/**
 * Message bookmarks repository.
 *
 * Pins on individual chat messages, scoped per user so bookmarks made on a
 * desktop show up on the same account's phone. Every method takes `userId` and
 * filters on it, so ownership is enforced by the query rather than by the
 * caller remembering to check.
 */

import { getConnection } from '@/modules/database/connection.js';

export type MessageBookmarkRow = {
  id: number;
  sessionId: string;
  provider: string;
  projectPath: string | null;
  messageId: string | null;
  messageTimestamp: string;
  snippet: string;
  label: string | null;
  messageType: string;
  createdAt: string;
};

export type CreateMessageBookmarkInput = {
  sessionId: string;
  provider: string;
  projectPath?: string | null;
  messageId?: string | null;
  messageTimestamp: string;
  snippet: string;
  messageType: string;
};

// Aliased so callers never deal with snake_case; the API shape is the row shape.
const BOOKMARK_COLUMNS = `
  id,
  session_id AS sessionId,
  provider,
  project_path AS projectPath,
  message_id AS messageId,
  message_timestamp AS messageTimestamp,
  snippet,
  label,
  message_type AS messageType,
  created_at AS createdAt
`;

function getById(userId: number, id: number): MessageBookmarkRow | null {
  const db = getConnection();
  const row = db
    .prepare(`SELECT ${BOOKMARK_COLUMNS} FROM message_bookmarks WHERE id = ? AND user_id = ?`)
    .get(id, userId) as MessageBookmarkRow | undefined;
  return row ?? null;
}

export const messageBookmarksDb = {
  /** Session's bookmarks in transcript order. */
  listForSession(userId: number, sessionId: string): MessageBookmarkRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${BOOKMARK_COLUMNS} FROM message_bookmarks
         WHERE user_id = ? AND session_id = ?
         ORDER BY message_timestamp ASC, id ASC`
      )
      .all(userId, sessionId) as MessageBookmarkRow[];
  },

  /** Every bookmark the user owns, newest pin first, for the cross-session list. */
  listAllForUser(userId: number): MessageBookmarkRow[] {
    const db = getConnection();
    return db
      .prepare(
        `SELECT ${BOOKMARK_COLUMNS} FROM message_bookmarks
         WHERE user_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .all(userId) as MessageBookmarkRow[];
  },

  findByMessageId(userId: number, sessionId: string, messageId: string): MessageBookmarkRow | null {
    const db = getConnection();
    const row = db
      .prepare(
        `SELECT ${BOOKMARK_COLUMNS} FROM message_bookmarks
         WHERE user_id = ? AND session_id = ? AND message_id = ?`
      )
      .get(userId, sessionId, messageId) as MessageBookmarkRow | undefined;
    return row ?? null;
  },

  create(userId: number, input: CreateMessageBookmarkInput): MessageBookmarkRow {
    const db = getConnection();
    const result = db
      .prepare(
        `INSERT INTO message_bookmarks
           (user_id, session_id, provider, project_path, message_id, message_timestamp, snippet, message_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        input.sessionId,
        input.provider,
        input.projectPath ?? null,
        input.messageId ?? null,
        input.messageTimestamp,
        input.snippet,
        input.messageType
      );
    return getById(userId, Number(result.lastInsertRowid)) as MessageBookmarkRow;
  },

  /** Sets or clears the user label. Returns null when the row is not theirs. */
  rename(userId: number, id: number, label: string | null): MessageBookmarkRow | null {
    const db = getConnection();
    const result = db
      .prepare('UPDATE message_bookmarks SET label = ? WHERE id = ? AND user_id = ?')
      .run(label, id, userId);
    return result.changes > 0 ? getById(userId, id) : null;
  },

  /** Self-heal write after the client resolves a bookmark by content fallback. */
  updateMessageId(userId: number, id: number, messageId: string): MessageBookmarkRow | null {
    const db = getConnection();
    const result = db
      .prepare('UPDATE message_bookmarks SET message_id = ? WHERE id = ? AND user_id = ?')
      .run(messageId, id, userId);
    return result.changes > 0 ? getById(userId, id) : null;
  },

  remove(userId: number, id: number): boolean {
    const db = getConnection();
    const result = db
      .prepare('DELETE FROM message_bookmarks WHERE id = ? AND user_id = ?')
      .run(id, userId);
    return result.changes > 0;
  },
};
