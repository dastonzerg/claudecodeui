import { AppError } from '@/shared/utils.js';

import type {
  CreateMessageBookmarkInput,
  MessageBookmarkRow,
} from '@/modules/database/index.js';

const SNIPPET_MAX_LENGTH = 80;
const PINNABLE_MESSAGE_TYPES = new Set(['user', 'assistant']);

type BookmarksRepository = {
  listForSession(userId: number, sessionId: string): MessageBookmarkRow[];
  listAllForUser(userId: number): MessageBookmarkRow[];
  findByMessageId(userId: number, sessionId: string, messageId: string): MessageBookmarkRow | null;
  create(userId: number, input: CreateMessageBookmarkInput): MessageBookmarkRow;
  rename(userId: number, id: number, label: string | null): MessageBookmarkRow | null;
  updateMessageId(userId: number, id: number, messageId: string): MessageBookmarkRow | null;
  remove(userId: number, id: number): boolean;
};

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AppError(`${field} is required`, { code: 'INVALID_INPUT', statusCode: 400 });
  }
  return value.trim();
}

function notFound(): never {
  throw new AppError('Bookmark not found', { code: 'BOOKMARK_NOT_FOUND', statusCode: 404 });
}

export function createBookmarksService(deps: { bookmarks: BookmarksRepository }) {
  const { bookmarks } = deps;

  return {
    listForSession(userId: number, sessionId: string): MessageBookmarkRow[] {
      return bookmarks.listForSession(userId, requireString(sessionId, 'sessionId'));
    },

    listAll(userId: number): MessageBookmarkRow[] {
      return bookmarks.listAllForUser(userId);
    },

    create(userId: number, body: Record<string, unknown>): MessageBookmarkRow {
      const sessionId = requireString(body.sessionId, 'sessionId');
      const provider = requireString(body.provider, 'provider');
      const messageTimestamp = requireString(body.messageTimestamp, 'messageTimestamp');
      const snippet = requireString(body.snippet, 'snippet').slice(0, SNIPPET_MAX_LENGTH);
      const messageType = requireString(body.messageType, 'messageType');

      if (!PINNABLE_MESSAGE_TYPES.has(messageType)) {
        throw new AppError('messageType must be user or assistant', {
          code: 'INVALID_INPUT',
          statusCode: 400,
        });
      }

      const messageId = typeof body.messageId === 'string' && body.messageId.trim()
        ? body.messageId.trim()
        : null;

      // Pinning an already-pinned message is a no-op rather than a 409: the
      // client may retry after a dropped response, and the user's intent
      // ("this should be pinned") is already satisfied.
      if (messageId) {
        const existing = bookmarks.findByMessageId(userId, sessionId, messageId);
        if (existing) {
          return existing;
        }
      }

      return bookmarks.create(userId, {
        sessionId,
        provider,
        projectPath: typeof body.projectPath === 'string' ? body.projectPath : null,
        messageId,
        messageTimestamp,
        snippet,
        messageType,
      });
    },

    rename(userId: number, id: number, label: unknown): MessageBookmarkRow {
      const normalized = typeof label === 'string' && label.trim()
        ? label.trim().slice(0, SNIPPET_MAX_LENGTH)
        : null;
      return bookmarks.rename(userId, id, normalized) ?? notFound();
    },

    updateAnchor(userId: number, id: number, messageId: unknown): MessageBookmarkRow {
      return bookmarks.updateMessageId(userId, id, requireString(messageId, 'messageId')) ?? notFound();
    },

    remove(userId: number, id: number): { removed: true } {
      if (!bookmarks.remove(userId, id)) {
        notFound();
      }
      return { removed: true };
    },
  };
}
