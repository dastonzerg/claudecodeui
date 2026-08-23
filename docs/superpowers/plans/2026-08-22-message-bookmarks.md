# Message Bookmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user pin any chat prompt or response, persist those pins per user in SQLite, and jump back to them from a marker rail beside the chat scrollbar or from a cross-session list in the sidebar.

**Architecture:** A new `message_bookmarks` table and a `server/modules/bookmarks/` REST module follow the existing repository/service/routes split. On the client, a `useBookmarks` hook owned by `ChatInterface` publishes state through a `BookmarkContext`; bookmarks anchor on the provider message id with a timestamp-plus-snippet fallback that self-heals, because messages pinned mid-stream carry a random id that does not survive reload.

**Tech Stack:** TypeScript, Express, better-sqlite3, React 18, Tailwind, `node --test` (server), Vitest (client, added by this plan).

**Spec:** `docs/superpowers/specs/2026-08-22-message-bookmarks-design.md`

## Global Constraints

- Bookmarks are per user. Every repository method takes `userId` and includes it in the `WHERE` clause — ownership is enforced at the query, not only at the route.
- No foreign key from `message_bookmarks` to `sessions`. A session id can be rewritten mid-run when a provider announces its own id, and a hard FK would reject inserts during that window.
- Snippets are capped at 80 characters, produced only by `makeSnippet`.
- No infinite CSS animations anywhere in this feature. Reuse the existing finite 4-second `search-highlight-flash` for jump feedback.
- New tables are declared in `schema.ts` with `CREATE TABLE IF NOT EXISTS` **and** re-executed from `runMigrations` so existing installs pick them up.
- Every commit message ends with `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- `npm run typecheck` and `npm run lint` must pass before each commit.

## File Structure

| File | Responsibility |
|---|---|
| `server/modules/database/schema.ts` (modify) | Declare `MESSAGE_BOOKMARKS_TABLE_SCHEMA_SQL`, include in `INIT_SCHEMA_SQL` |
| `server/modules/database/migrations.ts` (modify) | Re-run the table + index for existing installs |
| `server/modules/database/repositories/message-bookmarks.db.ts` (create) | All SQL for bookmarks |
| `server/modules/database/index.ts` (modify) | Export `messageBookmarksDb` |
| `server/modules/database/tests/message-bookmarks.db.integration.test.ts` (create) | Repository integration tests |
| `server/modules/bookmarks/bookmarks.service.ts` (create) | Validation, snippet capping, user scoping |
| `server/modules/bookmarks/bookmarks.routes.ts` (create) | Thin transport layer |
| `server/modules/bookmarks/bookmarks.module.ts` (create) | Wire service to repository |
| `server/modules/bookmarks/index.ts` (create) | Public export |
| `server/modules/bookmarks/tests/bookmarks.service.test.ts` (create) | Cross-user scoping tests |
| `server/index.ts` (modify) | Mount `/api/bookmarks` |
| `vitest.config.ts` (create) | Client test runner |
| `src/components/chat/types/bookmarks.ts` (create) | `MessageBookmark` type shared by client modules |
| `src/components/chat/utils/bookmarkAnchors.ts` (create) | Pure `makeSnippet` + `resolveBookmarkTarget` |
| `src/components/chat/utils/bookmarkAnchors.test.ts` (create) | Resolver unit tests |
| `src/components/chat/hooks/useChatMessages.ts` (modify) | Carry `msg.id` into `ChatMessage` |
| `src/components/chat/hooks/useBookmarks.ts` (create) | Fetch/mutate state, resolution map, self-heal |
| `src/contexts/BookmarkContext.tsx` (create) | Publish bookmark state to nested bubbles |
| `src/components/chat/view/subcomponents/MessagePinControl.tsx` (create) | The pin button |
| `src/components/chat/view/subcomponents/MessageComponent.tsx` (modify) | Render pin control, tag bubbles with `data-bookmark-id` |
| `src/components/chat/view/subcomponents/BookmarkRail.tsx` (create) | Marker rail + jump |
| `src/components/chat/view/subcomponents/ChatMessagesPane.tsx` (modify) | Wrap scroll div, render rail |
| `src/components/chat/view/ChatInterface.tsx` (modify) | Own the hook, provide context |
| `src/components/sidebar/types/types.ts` (modify) | Add `'bookmarks'` search mode |
| `src/components/sidebar/view/subcomponents/SidebarBookmarkList.tsx` (create) | Cross-session list |
| `src/components/sidebar/view/subcomponents/SidebarContent.tsx` (modify) | Render the list in bookmarks mode |
| `src/components/sidebar/view/Sidebar.tsx` (modify) | Reuse message navigation for bookmarks |

---

### Task 1: Bookmarks table and repository

**Files:**
- Modify: `server/modules/database/schema.ts`
- Modify: `server/modules/database/migrations.ts:439-490` (inside `runMigrations`)
- Create: `server/modules/database/repositories/message-bookmarks.db.ts`
- Modify: `server/modules/database/index.ts`
- Test: `server/modules/database/tests/message-bookmarks.db.integration.test.ts`

**Interfaces:**
- Consumes: `getConnection` from `@/modules/database/connection.js`.
- Produces: `messageBookmarksDb` with `listForSession(userId, sessionId)`, `listAllForUser(userId)`, `create(userId, input)`, `findByMessageId(userId, sessionId, messageId)`, `rename(userId, id, label)`, `remove(userId, id)`, `updateMessageId(userId, id, messageId)`. Row type `MessageBookmarkRow` with camelCase fields: `id: number`, `sessionId: string`, `provider: string`, `projectPath: string | null`, `messageId: string | null`, `messageTimestamp: string`, `snippet: string`, `label: string | null`, `messageType: string`, `createdAt: string`.

- [ ] **Step 1: Write the failing test**

Create `server/modules/database/tests/message-bookmarks.db.integration.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, getConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { messageBookmarksDb } from '@/modules/database/repositories/message-bookmarks.db.js';
import { userDb } from '@/modules/database/repositories/users.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'message-bookmarks-db-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

function createUserId(username: string): number {
  return Number(userDb.createUser(username, 'hash').id);
}

const baseInput = {
  sessionId: 'session-1',
  provider: 'claude',
  projectPath: '/workspace/demo',
  messageTimestamp: '2026-08-22T10:00:00.000Z',
  snippet: 'first pinned message',
  messageType: 'user' as const,
};

test('listForSession returns only the requesting user rows ordered by message timestamp', async () => {
  await withIsolatedDatabase(() => {
    const alice = createUserId('alice');
    const bob = createUserId('bob');

    messageBookmarksDb.create(alice, { ...baseInput, messageId: 'm-2', messageTimestamp: '2026-08-22T12:00:00.000Z', snippet: 'later' });
    messageBookmarksDb.create(alice, { ...baseInput, messageId: 'm-1' });
    messageBookmarksDb.create(bob, { ...baseInput, messageId: 'm-3', snippet: 'bob only' });

    const aliceRows = messageBookmarksDb.listForSession(alice, 'session-1');
    assert.deepEqual(aliceRows.map((row) => row.messageId), ['m-1', 'm-2']);
    assert.equal(aliceRows[0].projectPath, '/workspace/demo');

    const bobRows = messageBookmarksDb.listForSession(bob, 'session-1');
    assert.deepEqual(bobRows.map((row) => row.messageId), ['m-3']);
  });
});

test('findByMessageId scopes to the owning user', async () => {
  await withIsolatedDatabase(() => {
    const alice = createUserId('alice');
    const bob = createUserId('bob');
    messageBookmarksDb.create(alice, { ...baseInput, messageId: 'm-1' });

    assert.ok(messageBookmarksDb.findByMessageId(alice, 'session-1', 'm-1'));
    assert.equal(messageBookmarksDb.findByMessageId(bob, 'session-1', 'm-1'), null);
  });
});

test('rename remove and updateMessageId refuse to touch another user row', async () => {
  await withIsolatedDatabase(() => {
    const alice = createUserId('alice');
    const bob = createUserId('bob');
    const created = messageBookmarksDb.create(alice, { ...baseInput, messageId: 'm-1' });

    assert.equal(messageBookmarksDb.rename(bob, created.id, 'hijacked'), null);
    assert.equal(messageBookmarksDb.updateMessageId(bob, created.id, 'm-evil'), null);
    assert.equal(messageBookmarksDb.remove(bob, created.id), false);

    const stillThere = messageBookmarksDb.listForSession(alice, 'session-1');
    assert.equal(stillThere.length, 1);
    assert.equal(stillThere[0].label, null);
    assert.equal(stillThere[0].messageId, 'm-1');

    assert.equal(messageBookmarksDb.rename(alice, created.id, 'my label')?.label, 'my label');
    assert.equal(messageBookmarksDb.updateMessageId(alice, created.id, 'm-healed')?.messageId, 'm-healed');
    assert.equal(messageBookmarksDb.remove(alice, created.id), true);
    assert.equal(messageBookmarksDb.listForSession(alice, 'session-1').length, 0);
  });
});

test('deleting a user cascades their bookmarks away', async () => {
  await withIsolatedDatabase(() => {
    const alice = createUserId('alice');
    messageBookmarksDb.create(alice, { ...baseInput, messageId: 'm-1' });

    getConnection().prepare('DELETE FROM users WHERE id = ?').run(alice);

    assert.equal(messageBookmarksDb.listAllForUser(alice).length, 0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="listForSession returns only"`

Expected: FAIL — cannot find module `message-bookmarks.db.js`.

- [ ] **Step 3: Add the schema**

In `server/modules/database/schema.ts`, add this export next to the other table constants:

```ts
export const MESSAGE_BOOKMARKS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS message_bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    -- Denormalized so the cross-session list can render a project label
    -- without joining sessions, which may not have a row yet.
    project_path TEXT,
    -- Provider message id. NULL or stale for a message pinned mid-stream;
    -- rewritten by the client once fallback resolution finds the real id.
    message_id TEXT,
    message_timestamp TEXT NOT NULL,
    snippet TEXT NOT NULL,
    label TEXT,
    message_type TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, session_id, message_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;
```

Append to the `INIT_SCHEMA_SQL` template literal, after the `APP_CONFIG_TABLE_SCHEMA_SQL` interpolation:

```ts
${MESSAGE_BOOKMARKS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_message_bookmarks_user_session ON message_bookmarks(user_id, session_id);
```

- [ ] **Step 4: Add the migration**

In `server/modules/database/migrations.ts`, add `MESSAGE_BOOKMARKS_TABLE_SCHEMA_SQL` to the import block from `@/modules/database/schema.js`. Then inside `runMigrations`, immediately after the `db.exec(LAST_SCANNED_AT_SQL);` line:

```ts
    db.exec(MESSAGE_BOOKMARKS_TABLE_SCHEMA_SQL);
    db.exec('CREATE INDEX IF NOT EXISTS idx_message_bookmarks_user_session ON message_bookmarks(user_id, session_id)');
```

- [ ] **Step 5: Write the repository**

Create `server/modules/database/repositories/message-bookmarks.db.ts`:

```ts
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
```

- [ ] **Step 6: Export the repository**

In `server/modules/database/index.ts`, add alongside the other repository exports:

```ts
export { messageBookmarksDb } from '@/modules/database/repositories/message-bookmarks.db.js';
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`

Expected: the four new tests PASS and no existing test regresses.

- [ ] **Step 8: Typecheck, lint, and commit**

```bash
npm run typecheck && npm run lint
git add server/modules/database
git commit -m "feat: add message_bookmarks table and repository

Per-user pins on individual chat messages, scoped by user_id in every
query. No FK to sessions because a session id can be rewritten mid-run
when the provider announces its own id.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Bookmarks REST module

**Files:**
- Create: `server/modules/bookmarks/bookmarks.service.ts`
- Create: `server/modules/bookmarks/bookmarks.routes.ts`
- Create: `server/modules/bookmarks/bookmarks.module.ts`
- Create: `server/modules/bookmarks/index.ts`
- Modify: `server/index.ts` (imports near line 156, mount near line 174)
- Test: `server/modules/bookmarks/tests/bookmarks.service.test.ts`

**Interfaces:**
- Consumes: `messageBookmarksDb` and `MessageBookmarkRow` from Task 1.
- Produces: `createBookmarksService(deps)` returning `{ listForSession, listAll, create, rename, updateAnchor, remove }`; `bookmarksRoutes` (an `express.Router`) exported from `server/modules/bookmarks/index.js`. HTTP surface: `GET /api/bookmarks`, `GET /api/bookmarks?sessionId=…`, `POST /api/bookmarks`, `PATCH /api/bookmarks/:id`, `PATCH /api/bookmarks/:id/anchor`, `DELETE /api/bookmarks/:id`. All responses are the raw row or `{ removed: true }`.

- [ ] **Step 1: Write the failing test**

Create `server/modules/bookmarks/tests/bookmarks.service.test.ts`:

```ts
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection } from '@/modules/database/connection.js';
import { initializeDatabase } from '@/modules/database/init-db.js';
import { messageBookmarksDb } from '@/modules/database/repositories/message-bookmarks.db.js';
import { userDb } from '@/modules/database/repositories/users.js';

import { createBookmarksService } from '../bookmarks.service.js';

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'bookmarks-service-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest();
  } finally {
    closeConnection();
    if (previousDatabasePath === undefined) {
      delete process.env.DATABASE_PATH;
    } else {
      process.env.DATABASE_PATH = previousDatabasePath;
    }
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const service = createBookmarksService({ bookmarks: messageBookmarksDb });

const pinBody = {
  sessionId: 'session-1',
  provider: 'claude',
  projectPath: '/workspace/demo',
  messageId: 'm-1',
  messageTimestamp: '2026-08-22T10:00:00.000Z',
  snippet: 'pinned text',
  messageType: 'user',
};

test('one user cannot read rename anchor or delete another user bookmark', async () => {
  await withIsolatedDatabase(() => {
    const alice = Number(userDb.createUser('alice', 'hash').id);
    const bob = Number(userDb.createUser('bob', 'hash').id);
    const created = service.create(alice, pinBody);

    assert.deepEqual(service.listForSession(bob, 'session-1'), []);
    assert.deepEqual(service.listAll(bob), []);
    assert.throws(() => service.rename(bob, created.id, 'hijack'), /not found/i);
    assert.throws(() => service.updateAnchor(bob, created.id, 'm-evil'), /not found/i);
    assert.throws(() => service.remove(bob, created.id), /not found/i);

    assert.equal(service.listForSession(alice, 'session-1').length, 1);
  });
});

test('create caps the snippet at 80 characters and rejects an unusable message type', async () => {
  await withIsolatedDatabase(() => {
    const alice = Number(userDb.createUser('alice', 'hash').id);

    const created = service.create(alice, { ...pinBody, snippet: 'x'.repeat(500) });
    assert.equal(created.snippet.length, 80);

    assert.throws(() => service.create(alice, { ...pinBody, messageId: 'm-2', messageType: 'tool' }), /messageType/i);
    assert.throws(() => service.create(alice, { ...pinBody, messageId: 'm-3', sessionId: '' }), /sessionId/i);
  });
});

test('pinning the same message twice returns the existing bookmark instead of erroring', async () => {
  await withIsolatedDatabase(() => {
    const alice = Number(userDb.createUser('alice', 'hash').id);
    const first = service.create(alice, pinBody);
    const second = service.create(alice, pinBody);

    assert.equal(first.id, second.id);
    assert.equal(service.listForSession(alice, 'session-1').length, 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- --test-name-pattern="one user cannot read rename"`

Expected: FAIL — cannot find module `../bookmarks.service.js`.

- [ ] **Step 3: Write the service**

Create `server/modules/bookmarks/bookmarks.service.ts`:

```ts
import { AppError } from '@/shared/utils.js';

import type {
  CreateMessageBookmarkInput,
  MessageBookmarkRow,
} from '@/modules/database/repositories/message-bookmarks.db.js';

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- --test-name-pattern="bookmark"`

Expected: the three new tests PASS.

- [ ] **Step 5: Write the routes**

Create `server/modules/bookmarks/bookmarks.routes.ts`:

```ts
import express from 'express';

import type { createBookmarksService } from './bookmarks.service.js';

type AuthenticatedRequest = express.Request & { user?: { id?: number | string } };

function userId(req: express.Request): number {
  return Number((req as AuthenticatedRequest).user?.id);
}

/** Creates thin Bookmarks transport handlers around the application service. */
export function createBookmarksRouter(
  service: ReturnType<typeof createBookmarksService>,
): express.Router {
  const router = express.Router();
  const respond = (operation: (req: express.Request) => unknown | Promise<unknown>) =>
    async (req: express.Request, res: express.Response, next: express.NextFunction) => {
      try { res.json(await operation(req)); } catch (error) { next(error); }
    };

  router.get('/', respond((req) => (
    typeof req.query.sessionId === 'string' && req.query.sessionId.trim()
      ? service.listForSession(userId(req), req.query.sessionId)
      : service.listAll(userId(req))
  )));
  router.post('/', respond((req) => service.create(userId(req), req.body ?? {})));
  router.patch('/:id', respond((req) => service.rename(
    userId(req), Number(req.params.id), req.body?.label,
  )));
  router.patch('/:id/anchor', respond((req) => service.updateAnchor(
    userId(req), Number(req.params.id), req.body?.messageId,
  )));
  router.delete('/:id', respond((req) => service.remove(userId(req), Number(req.params.id))));
  return router;
}
```

Create `server/modules/bookmarks/bookmarks.module.ts`:

```ts
import { messageBookmarksDb } from '@/modules/database/index.js';

import { createBookmarksRouter } from './bookmarks.routes.js';
import { createBookmarksService } from './bookmarks.service.js';

const bookmarksService = createBookmarksService({ bookmarks: messageBookmarksDb });

export const bookmarksRoutes = createBookmarksRouter(bookmarksService);
```

Create `server/modules/bookmarks/index.ts`:

```ts
// bookmarksRoutes: used by the server entrypoint to mount protected message-bookmark endpoints.
export { bookmarksRoutes } from './bookmarks.module.js';
```

- [ ] **Step 6: Mount the router**

In `server/index.ts`, add the import next to the other module route imports:

```ts
import { bookmarksRoutes } from '@/modules/bookmarks/index.js';
```

and mount it immediately after the `/api/settings` mount (around line 174):

```ts
app.use('/api/bookmarks', authenticateToken, bookmarksRoutes);
```

- [ ] **Step 7: Verify the server boots and the route answers**

Run: `npm run typecheck && npm run lint && npm test`

Expected: all PASS.

- [ ] **Step 8: Commit**

```bash
git add server/modules/bookmarks server/index.ts
git commit -m "feat: add /api/bookmarks module

Thin routes over a service that validates input, caps snippets at 80
chars, and treats a repeat pin as a no-op. Every operation is scoped to
the authenticated user.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Vitest and the anchor resolver

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json` (scripts, devDependencies)
- Create: `src/components/chat/types/bookmarks.ts`
- Create: `src/components/chat/utils/bookmarkAnchors.ts`
- Test: `src/components/chat/utils/bookmarkAnchors.test.ts`

**Interfaces:**
- Consumes: `ChatMessage` from `src/components/chat/types/types.ts`.
- Produces: `MessageBookmark` type; `makeSnippet(text: string): string`; `resolveBookmarkTarget(bookmark: MessageBookmark, messages: ChatMessage[]): { message: ChatMessage; viaFallback: boolean } | null`. `npm run test:client` runs Vitest.

- [ ] **Step 1: Install Vitest and add the script**

```bash
npm install --save-dev vitest@^3.2.4
```

Add to the `scripts` block in `package.json`, after the existing `"test"` entry:

```json
    "test:client": "vitest run",
```

Create `vitest.config.ts` at the repo root:

```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Client-side unit tests only. Server tests run under `node --test` via
// `npm test`; the two runners stay separate because the server relies on
// tsx path aliases and better-sqlite3 native bindings.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
```

Note: `include` deliberately covers `.test.ts` only, not `.test.tsx`. The pre-existing `src/components/chat/tools/components/ContentRenderers/QuestionAnswerContent.test.tsx` needs a DOM environment and React Testing Library, which this task does not add; pulling it in here would expand scope. Leave it out and say so in the commit message.

- [ ] **Step 2: Write the failing test**

Create `src/components/chat/utils/bookmarkAnchors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';
import type { MessageBookmark } from '../types/bookmarks';

import { makeSnippet, resolveBookmarkTarget } from './bookmarkAnchors';

function message(id: string, type: string, timestamp: string, content: string): ChatMessage {
  return { id, type, timestamp, content };
}

const bookmark: MessageBookmark = {
  id: 1,
  sessionId: 'session-1',
  provider: 'claude',
  projectPath: '/workspace/demo',
  messageId: 'm-2',
  messageTimestamp: '2026-08-22T10:00:00.000Z',
  snippet: 'the pinned sentence',
  label: null,
  messageType: 'user',
  createdAt: '2026-08-22T10:00:01.000Z',
};

describe('makeSnippet', () => {
  it('trims and caps at 80 characters', () => {
    expect(makeSnippet('   hello   ')).toBe('hello');
    expect(makeSnippet('x'.repeat(200))).toHaveLength(80);
  });
});

describe('resolveBookmarkTarget', () => {
  it('matches on message id without using the fallback', () => {
    const messages = [
      message('m-1', 'user', '2026-08-22T09:00:00.000Z', 'something else'),
      message('m-2', 'user', '2026-08-22T10:00:00.000Z', 'the pinned sentence and more'),
    ];

    expect(resolveBookmarkTarget(bookmark, messages)).toEqual({
      message: messages[1],
      viaFallback: false,
    });
  });

  it('falls back to timestamp plus snippet when the id is gone', () => {
    const messages = [
      message('reloaded-a', 'user', '2026-08-22T09:00:00.000Z', 'something else'),
      message('reloaded-b', 'user', '2026-08-22T10:00:02.000Z', 'the pinned sentence and more'),
    ];

    expect(resolveBookmarkTarget(bookmark, messages)).toEqual({
      message: messages[1],
      viaFallback: true,
    });
  });

  it('rejects the nearest message when the snippet does not corroborate it', () => {
    const messages = [
      message('reloaded-a', 'user', '2026-08-22T10:00:00.100Z', 'a totally different turn'),
      message('reloaded-b', 'user', '2026-08-22T10:05:00.000Z', 'the pinned sentence and more'),
    ];

    expect(resolveBookmarkTarget(bookmark, messages)?.message).toBe(messages[1]);
  });

  it('ignores messages of the wrong type', () => {
    const messages = [
      message('reloaded-a', 'assistant', '2026-08-22T10:00:00.000Z', 'the pinned sentence'),
    ];

    expect(resolveBookmarkTarget(bookmark, messages)).toBeNull();
  });

  it('returns null when nothing matches', () => {
    const messages = [message('reloaded-a', 'user', '2026-08-22T10:00:00.000Z', 'unrelated')];

    expect(resolveBookmarkTarget(bookmark, messages)).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm run test:client`

Expected: FAIL — cannot resolve `./bookmarkAnchors`.

- [ ] **Step 4: Write the type and the resolver**

Create `src/components/chat/types/bookmarks.ts`:

```ts
/** A pinned message, exactly as `/api/bookmarks` returns it. */
export interface MessageBookmark {
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
}
```

Create `src/components/chat/utils/bookmarkAnchors.ts`:

```ts
/**
 * Bookmark anchoring.
 *
 * A bookmark points at a message by provider id. That id is stable for
 * anything read back from a provider transcript, but a message pinned while it
 * is still streaming carries a randomly generated id that does not survive a
 * reload. So resolution falls back to nearest-timestamp corroborated by the
 * stored snippet, and the caller rewrites the stored id on a fallback hit.
 *
 * Both signals are required for the fallback. The sidebar's conversation search
 * accepts a timestamp-only match, but a bookmark that silently jumps to the
 * wrong message is worse than one that reports it cannot find its target.
 */

import type { ChatMessage } from '../types/types';
import type { MessageBookmark } from '../types/bookmarks';

const SNIPPET_MAX_LENGTH = 80;

export interface ResolvedBookmark {
  message: ChatMessage;
  /** True when the id missed and the content fallback found the message. */
  viaFallback: boolean;
}

export function makeSnippet(text: string): string {
  return text.trim().slice(0, SNIPPET_MAX_LENGTH);
}

function messageTime(message: ChatMessage): number {
  return new Date(message.timestamp).getTime();
}

export function resolveBookmarkTarget(
  bookmark: MessageBookmark,
  messages: ChatMessage[],
): ResolvedBookmark | null {
  if (bookmark.messageId) {
    const exact = messages.find((message) => message.id === bookmark.messageId);
    if (exact) {
      return { message: exact, viaFallback: false };
    }
  }

  const targetTime = new Date(bookmark.messageTimestamp).getTime();
  const needle = bookmark.snippet.trim().toLowerCase();
  if (!Number.isFinite(targetTime) || needle.length === 0) {
    return null;
  }

  let best: ChatMessage | null = null;
  let bestDifference = Number.POSITIVE_INFINITY;

  for (const message of messages) {
    if (message.type !== bookmark.messageType) {
      continue;
    }

    const content = typeof message.content === 'string' ? message.content : '';
    if (!content.toLowerCase().includes(needle)) {
      continue;
    }

    const time = messageTime(message);
    if (!Number.isFinite(time)) {
      continue;
    }

    const difference = Math.abs(time - targetTime);
    if (difference < bestDifference) {
      bestDifference = difference;
      best = message;
    }
  }

  return best ? { message: best, viaFallback: true } : null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm run test:client`

Expected: all 6 tests PASS.

- [ ] **Step 6: Commit**

```bash
npm run typecheck && npm run lint
git add package.json package-lock.json vitest.config.ts src/components/chat/types/bookmarks.ts src/components/chat/utils/bookmarkAnchors.ts src/components/chat/utils/bookmarkAnchors.test.ts
git commit -m "feat: add bookmark anchor resolution with Vitest coverage

Resolves a bookmark by provider message id, falling back to nearest
timestamp corroborated by the stored snippet. Both signals are required
so a stale bookmark reports failure rather than jumping somewhere wrong.

Adds Vitest for src/ under test:client, limited to .test.ts. The existing
QuestionAnswerContent.test.tsx still needs a DOM environment and stays
excluded.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Message id plumbing, `useBookmarks`, and the context

**Files:**
- Modify: `src/components/chat/hooks/useChatMessages.ts:83-91`
- Create: `src/components/chat/hooks/useBookmarks.ts`
- Create: `src/contexts/BookmarkContext.tsx`
- Modify: `src/components/chat/view/ChatInterface.tsx:339-341`

**Interfaces:**
- Consumes: `resolveBookmarkTarget`, `makeSnippet`, `MessageBookmark` (Task 3); `authenticatedFetch` from `src/utils/api.js`.
- Produces: `useBookmarks(options)` returning `BookmarkContextValue`; `BookmarkContext` default export and `useBookmarkState()` hook from `src/contexts/BookmarkContext.tsx`. `BookmarkContextValue` is:

```ts
{
  bookmarks: MessageBookmark[];
  bookmarkForMessage: (message: ChatMessage) => MessageBookmark | null;
  resolvedMessageIds: Map<number, string>;
  pin: (message: ChatMessage) => void;
  unpin: (bookmarkId: number) => void;
  rename: (bookmarkId: number, label: string | null) => void;
}
```

- [ ] **Step 1: Carry the provider id into `ChatMessage`**

In `src/components/chat/hooks/useChatMessages.ts`, the `sharedMetadata` object built inside the `for (const msg of messages)` loop currently starts at `displayText`. Add `id` as its first field:

```ts
    const sharedMetadata = {
      // The provider id, stable for anything read back from a transcript.
      // Bookmarks anchor on it, and `getIntrinsicMessageKey` prefers it for
      // React keys.
      id: msg.id,
      displayText: msg.displayText,
```

- [ ] **Step 2: Write the context**

Create `src/contexts/BookmarkContext.tsx`:

```tsx
import { createContext, useContext } from 'react';

import type { ChatMessage } from '../components/chat/types/types';
import type { MessageBookmark } from '../components/chat/types/bookmarks';

export interface BookmarkContextValue {
  bookmarks: MessageBookmark[];
  /** The bookmark pinning this message, if any. */
  bookmarkForMessage: (message: ChatMessage) => MessageBookmark | null;
  /** Bookmark id to the message id it currently resolves to. Drives the rail. */
  resolvedMessageIds: Map<number, string>;
  pin: (message: ChatMessage) => void;
  unpin: (bookmarkId: number) => void;
  rename: (bookmarkId: number, label: string | null) => void;
}

const BookmarkContext = createContext<BookmarkContextValue | null>(null);

export function useBookmarkState(): BookmarkContextValue | null {
  return useContext(BookmarkContext);
}

export default BookmarkContext;
```

- [ ] **Step 3: Write the hook**

Create `src/components/chat/hooks/useBookmarks.ts`:

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { authenticatedFetch } from '../../../utils/api';
import type { BookmarkContextValue } from '../../../contexts/BookmarkContext';
import type { MessageBookmark } from '../types/bookmarks';
import type { ChatMessage } from '../types/types';
import { makeSnippet, resolveBookmarkTarget } from '../utils/bookmarkAnchors';

interface UseBookmarksOptions {
  sessionId: string | null;
  provider: string;
  projectPath: string | null;
  messages: ChatMessage[];
}

export function useBookmarks({
  sessionId,
  provider,
  projectPath,
  messages,
}: UseBookmarksOptions): BookmarkContextValue {
  const [bookmarks, setBookmarks] = useState<MessageBookmark[]>([]);
  // Bookmarks already self-healed this mount, so a resolution pass that runs
  // again on the next message update does not re-issue the same PATCH.
  const healedRef = useRef(new Set<number>());

  useEffect(() => {
    healedRef.current = new Set();
    if (!sessionId) {
      setBookmarks([]);
      return;
    }

    let cancelled = false;
    authenticatedFetch(`/api/bookmarks?sessionId=${encodeURIComponent(sessionId)}`)
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: MessageBookmark[]) => {
        if (!cancelled) setBookmarks(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setBookmarks([]);
      });

    return () => { cancelled = true; };
  }, [sessionId]);

  // Resolve every bookmark against the messages currently loaded. Bookmarks
  // whose message has not been loaded simply have no entry.
  const resolutions = useMemo(() => {
    const byBookmarkId = new Map<number, { messageId: string; viaFallback: boolean }>();
    for (const bookmark of bookmarks) {
      const resolved = resolveBookmarkTarget(bookmark, messages);
      const resolvedId = resolved?.message.id;
      if (resolved && typeof resolvedId === 'string') {
        byBookmarkId.set(bookmark.id, { messageId: resolvedId, viaFallback: resolved.viaFallback });
      }
    }
    return byBookmarkId;
  }, [bookmarks, messages]);

  // Self-heal: a bookmark found by content fallback gets its stored id
  // rewritten, so step 2 of resolution runs at most once per bookmark.
  useEffect(() => {
    for (const [bookmarkId, resolution] of resolutions) {
      if (!resolution.viaFallback || healedRef.current.has(bookmarkId)) {
        continue;
      }
      healedRef.current.add(bookmarkId);
      void authenticatedFetch(`/api/bookmarks/${bookmarkId}/anchor`, {
        method: 'PATCH',
        body: JSON.stringify({ messageId: resolution.messageId }),
      })
        .then((response) => (response.ok ? response.json() : null))
        .then((updated: MessageBookmark | null) => {
          if (updated) {
            setBookmarks((current) => current.map((b) => (b.id === updated.id ? updated : b)));
          }
        })
        .catch(() => { /* the fallback still resolves; healing retries next mount */ });
    }
  }, [resolutions]);

  const resolvedMessageIds = useMemo(() => {
    const map = new Map<number, string>();
    for (const [bookmarkId, resolution] of resolutions) {
      map.set(bookmarkId, resolution.messageId);
    }
    return map;
  }, [resolutions]);

  const bookmarksByMessageId = useMemo(() => {
    const map = new Map<string, MessageBookmark>();
    for (const bookmark of bookmarks) {
      const messageId = resolvedMessageIds.get(bookmark.id);
      if (messageId) map.set(messageId, bookmark);
    }
    return map;
  }, [bookmarks, resolvedMessageIds]);

  const bookmarkForMessage = useCallback(
    (message: ChatMessage) =>
      (typeof message.id === 'string' ? bookmarksByMessageId.get(message.id) : undefined) ?? null,
    [bookmarksByMessageId],
  );

  const pin = useCallback((message: ChatMessage) => {
    if (!sessionId) return;

    const body = {
      sessionId,
      provider,
      projectPath,
      messageId: typeof message.id === 'string' ? message.id : null,
      messageTimestamp: new Date(message.timestamp).toISOString(),
      snippet: makeSnippet(String(message.content || '')),
      messageType: message.type,
    };

    void authenticatedFetch('/api/bookmarks', { method: 'POST', body: JSON.stringify(body) })
      .then((response) => (response.ok ? response.json() : null))
      .then((created: MessageBookmark | null) => {
        if (!created) return;
        setBookmarks((current) => (
          current.some((b) => b.id === created.id) ? current : [...current, created]
        ));
      })
      .catch(() => { /* nothing pinned; the icon stays in its unpinned state */ });
  }, [sessionId, provider, projectPath]);

  const unpin = useCallback((bookmarkId: number) => {
    const previous = bookmarks;
    setBookmarks((current) => current.filter((b) => b.id !== bookmarkId));
    void authenticatedFetch(`/api/bookmarks/${bookmarkId}`, { method: 'DELETE' })
      .then((response) => { if (!response.ok) setBookmarks(previous); })
      .catch(() => setBookmarks(previous));
  }, [bookmarks]);

  const rename = useCallback((bookmarkId: number, label: string | null) => {
    void authenticatedFetch(`/api/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((updated: MessageBookmark | null) => {
        if (updated) {
          setBookmarks((current) => current.map((b) => (b.id === updated.id ? updated : b)));
        }
      })
      .catch(() => { /* label unchanged */ });
  }, []);

  return { bookmarks, bookmarkForMessage, resolvedMessageIds, pin, unpin, rename };
}
```

- [ ] **Step 4: Provide the context from `ChatInterface`**

In `src/components/chat/view/ChatInterface.tsx`, add the imports:

```tsx
import BookmarkContext from '../../../contexts/BookmarkContext';
import { useBookmarks } from '../hooks/useBookmarks';
```

Add the hook call next to the other hook calls in the component body (after `const sessionStore = useSessionStore();`):

```tsx
  const bookmarkState = useBookmarks({
    sessionId: selectedSession?.id ?? null,
    provider,
    // `Project.fullPath` is the required absolute path; `path` is optional and
    // only set on some project shapes (see src/types/app.ts:80-90).
    projectPath: selectedProject?.fullPath ?? selectedProject?.path ?? null,
    messages: chatMessages,
  });
```

`provider` is already destructured in this component (line 63), so no new binding is needed for it.

Wrap the existing tree — the `PermissionContext.Provider` at line 339 becomes nested inside the new provider:

```tsx
    <BookmarkContext.Provider value={bookmarkState}>
      <PermissionContext.Provider value={permissionContextValue}>
        {/* existing children unchanged */}
      </PermissionContext.Provider>
    </BookmarkContext.Provider>
```

- [ ] **Step 5: Verify it compiles and nothing regressed**

Run: `npm run typecheck && npm run lint && npm run test:client`

Expected: all PASS. No visible UI change yet.

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/hooks/useChatMessages.ts src/components/chat/hooks/useBookmarks.ts src/contexts/BookmarkContext.tsx src/components/chat/view/ChatInterface.tsx
git commit -m "feat: add bookmark state hook and context

Carries the provider message id into ChatMessage so bookmarks can anchor
on it, resolves every bookmark against the loaded messages, and rewrites
the stored id when the content fallback finds a message the id missed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The pin control on bubbles

**Files:**
- Create: `src/components/chat/view/subcomponents/MessagePinControl.tsx`
- Modify: `src/components/chat/view/subcomponents/MessageComponent.tsx` (imports; the wrapper div near line 101; the user footer row at line 131; the assistant footer row at line 405)

**Interfaces:**
- Consumes: `useBookmarkState` (Task 4).
- Produces: a `data-bookmark-id="<messageId>"` attribute on every pinnable bubble wrapper, which Task 6's rail queries.

- [ ] **Step 1: Write the pin control**

Create `src/components/chat/view/subcomponents/MessagePinControl.tsx`:

```tsx
import { useTranslation } from 'react-i18next';

import { useBookmarkState } from '../../../../contexts/BookmarkContext';
import type { ChatMessage } from '../../types/types';

/**
 * Always visible rather than hover-revealed like the copy and speak controls:
 * hover does not exist on touch, and this row already occupies its own line so
 * a persistent icon costs no extra height.
 */
const MessagePinControl = ({ message }: { message: ChatMessage }) => {
  const { t } = useTranslation('chat');
  const bookmarkState = useBookmarkState();

  if (!bookmarkState || typeof message.id !== 'string') {
    return null;
  }

  const bookmark = bookmarkState.bookmarkForMessage(message);
  const isPinned = Boolean(bookmark);

  return (
    <button
      type="button"
      aria-pressed={isPinned}
      title={isPinned ? t('bookmarks.unpin', 'Remove bookmark') : t('bookmarks.pin', 'Bookmark this message')}
      aria-label={isPinned ? t('bookmarks.unpin', 'Remove bookmark') : t('bookmarks.pin', 'Bookmark this message')}
      onClick={() => {
        if (bookmark) {
          bookmarkState.unpin(bookmark.id);
        } else {
          bookmarkState.pin(message);
        }
      }}
      className={`inline-flex h-5 w-5 items-center justify-center rounded transition-opacity hover:opacity-100 ${
        isPinned ? 'opacity-100' : 'opacity-50'
      }`}
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill={isPinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"
        />
      </svg>
    </button>
  );
};

export default MessagePinControl;
```

- [ ] **Step 2: Render it and tag the bubble**

In `src/components/chat/view/subcomponents/MessageComponent.tsx`, add the import next to `MessageCopyControl`:

```tsx
import MessagePinControl from './MessagePinControl';
```

Add a derived flag next to the other `shouldShow…` constants:

```tsx
  const isPinnable = (message.type === 'user' || message.type === 'assistant')
    && typeof message.id === 'string'
    && String(message.content || '').trim().length > 0;
```

On the outer wrapper `div` (the one carrying `data-message-timestamp` near line 101), add the bookmark anchor attribute:

```tsx
      data-bookmark-id={isPinnable ? String(message.id) : undefined}
```

In the user footer row (line 131, `<div className="mt-1 flex items-center justify-end gap-1 text-xs text-blue-100">`), add before `<span>{formattedTime}</span>`:

```tsx
                  {isPinnable && <MessagePinControl message={message} />}
```

In the assistant control row (line 405, `<div className="mt-1 flex w-full items-center gap-2 …">`), add before `{!isGrouped && <span>{formattedTime}</span>}`:

```tsx
                {isPinnable && <MessagePinControl message={message} />}
```

Note the assistant row only renders when `shouldShowAssistantCopyControl || !isGrouped`. Widen that condition so a pinnable grouped assistant message still gets its row:

```tsx
            {(shouldShowAssistantCopyControl || isPinnable || !isGrouped) && (
```

- [ ] **Step 3: Verify by hand**

Run: `npm run dev`, open a session, and confirm:
- A pin outline appears on user and assistant text bubbles, not on tool blocks.
- Clicking it fills the icon; reloading the page keeps it filled.
- Clicking again empties it and it stays empty after reload.

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npm run lint
git add src/components/chat/view/subcomponents/MessagePinControl.tsx src/components/chat/view/subcomponents/MessageComponent.tsx
git commit -m "feat: add pin control to chat bubbles

Always visible rather than hover-revealed, because hover does not exist
on touch and the metadata row already occupies its own line.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The bookmark rail

**Files:**
- Create: `src/components/chat/view/subcomponents/BookmarkRail.tsx`
- Modify: `src/components/chat/view/subcomponents/ChatMessagesPane.tsx:155-170` (wrapper + rail), and the props interface

**Interfaces:**
- Consumes: `useBookmarkState` (Task 4); `data-bookmark-id` attributes (Task 5); `loadAllMessages` and `scrollContainerRef`, already props of `ChatMessagesPane`.
- Produces: no exports other than the component.

- [ ] **Step 1: Write the rail**

Create `src/components/chat/view/subcomponents/BookmarkRail.tsx`:

```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useBookmarkState } from '../../../../contexts/BookmarkContext';
import type { MessageBookmark } from '../../types/bookmarks';

interface BookmarkRailProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** Bumped whenever the rendered message list changes, to recompute offsets. */
  messagesRevision: number;
  onLoadAllMessages: () => void;
}

interface MarkerPosition {
  bookmark: MessageBookmark;
  /** Percentage down the rail, or null when the message is not loaded. */
  topPercent: number | null;
}

const HIGHLIGHT_CLASS = 'search-highlight-flash';
const HIGHLIGHT_DURATION_MS = 4000;

function BookmarkRail({ scrollContainerRef, messagesRevision, onLoadAllMessages }: BookmarkRailProps) {
  const { t } = useTranslation('chat');
  const bookmarkState = useBookmarkState();
  const [positions, setPositions] = useState<MarkerPosition[]>([]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const pendingJumpRef = useRef<number | null>(null);

  const bookmarks = bookmarkState?.bookmarks;
  const resolvedMessageIds = bookmarkState?.resolvedMessageIds;

  // Offsets depend on layout, not on scroll position, so this recomputes only
  // when the list changes or the container resizes — never per scroll frame.
  const recompute = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !bookmarks || !resolvedMessageIds) {
      setPositions([]);
      return;
    }

    const scrollHeight = container.scrollHeight || 1;
    setPositions(bookmarks.map((bookmark) => {
      const messageId = resolvedMessageIds.get(bookmark.id);
      const element = messageId
        ? container.querySelector<HTMLElement>(`[data-bookmark-id="${CSS.escape(messageId)}"]`)
        : null;

      if (!element) {
        return { bookmark, topPercent: null };
      }

      const center = element.offsetTop + element.clientHeight / 2;
      return { bookmark, topPercent: Math.min(100, Math.max(0, (center / scrollHeight) * 100)) };
    }));
  }, [scrollContainerRef, bookmarks, resolvedMessageIds]);

  useLayoutEffect(() => { recompute(); }, [recompute, messagesRevision]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => recompute());
    observer.observe(container);
    return () => observer.disconnect();
  }, [scrollContainerRef, recompute]);

  const scrollToBookmark = useCallback((bookmarkId: number) => {
    const container = scrollContainerRef.current;
    const messageId = resolvedMessageIds?.get(bookmarkId);
    if (!container || !messageId) {
      return false;
    }

    const element = container.querySelector<HTMLElement>(`[data-bookmark-id="${CSS.escape(messageId)}"]`);
    if (!element) {
      return false;
    }

    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    element.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => element.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_DURATION_MS);
    return true;
  }, [scrollContainerRef, resolvedMessageIds]);

  // A jump to an unloaded message asks for the full transcript, then retries
  // once the newly rendered messages bump `messagesRevision`.
  useEffect(() => {
    const pending = pendingJumpRef.current;
    if (pending === null) {
      return;
    }
    if (scrollToBookmark(pending)) {
      pendingJumpRef.current = null;
    }
  }, [messagesRevision, scrollToBookmark]);

  const handleMarkerClick = (bookmarkId: number) => {
    if (scrollToBookmark(bookmarkId)) {
      return;
    }
    pendingJumpRef.current = bookmarkId;
    onLoadAllMessages();
  };

  if (!bookmarkState || positions.length === 0) {
    return null;
  }

  const unresolved = positions.filter((position) => position.topPercent === null);
  const resolved = positions.filter((position) => position.topPercent !== null);

  const markerLabel = (bookmark: MessageBookmark) => bookmark.label || bookmark.snippet;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-20 w-4"
      aria-label={t('bookmarks.railLabel', 'Bookmarks')}
    >
      {resolved.map(({ bookmark, topPercent }) => (
        <button
          key={bookmark.id}
          type="button"
          onClick={() => handleMarkerClick(bookmark.id)}
          onMouseEnter={() => setHoveredId(bookmark.id)}
          onMouseLeave={() => setHoveredId((current) => (current === bookmark.id ? null : current))}
          style={{ top: `${topPercent}%` }}
          title={markerLabel(bookmark)}
          aria-label={markerLabel(bookmark)}
          className="pointer-events-auto absolute right-0.5 h-1.5 w-3 -translate-y-1/2 rounded-sm bg-blue-500/70 hover:bg-blue-500 dark:bg-blue-400/70 dark:hover:bg-blue-400"
        >
          {hoveredId === bookmark.id && (
            <span className="pointer-events-none absolute right-5 top-1/2 w-56 -translate-y-1/2 truncate rounded bg-gray-900 px-2 py-1 text-left text-[11px] text-white shadow-lg dark:bg-gray-700">
              {markerLabel(bookmark)}
            </span>
          )}
        </button>
      ))}

      {unresolved.length > 0 && (
        <button
          type="button"
          onClick={() => handleMarkerClick(unresolved[0].bookmark.id)}
          title={t('bookmarks.unloaded', {
            count: unresolved.length,
            defaultValue: '{{count}} bookmark(s) in messages not loaded yet',
          })}
          className="pointer-events-auto absolute right-0.5 top-1 flex h-4 w-3 items-center justify-center rounded-sm bg-gray-400/70 text-[8px] font-semibold text-white hover:bg-gray-500 dark:bg-gray-500/70"
        >
          {unresolved.length}
        </button>
      )}
    </div>
  );
}

export default BookmarkRail;
```

- [ ] **Step 2: Wrap the scroll container and render the rail**

In `src/components/chat/view/subcomponents/ChatMessagesPane.tsx`, add the import:

```tsx
import BookmarkRail from './BookmarkRail';
```

The component currently returns the scroll `div` directly. Wrap it so the rail is a sibling of the scrolling element — a child would scroll away with the content. Replace the opening of the returned JSX:

```tsx
  return (
    <div className="relative flex min-h-0 flex-1">
      <div
        ref={scrollContainerRef}
        onWheel={onWheel}
        onTouchMove={onTouchMove}
        className={`chat-messages-pane relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-3 sm:pt-4 ${
          hasActivityIndicator ? 'pb-12 sm:pb-14' : 'pb-3 sm:pb-4'
        }`}
      >
```

and close it at the very end of the component, after the existing scroll div's closing `</div>`:

```tsx
      </div>
      <BookmarkRail
        scrollContainerRef={scrollContainerRef}
        messagesRevision={groupedVisibleMessages.length}
        onLoadAllMessages={loadAllMessages}
      />
    </div>
  );
```

Also move the export menu clear of the rail. Change its wrapper class from `sticky right-4 top-3` to `sticky right-7 top-3`.

- [ ] **Step 3: Verify by hand**

Run: `npm run dev` and confirm:
- Markers appear at the right edge, vertically tracking their messages.
- Clicking a marker scrolls to the message and flashes it.
- In a long session with older messages unloaded, the grey count badge appears at the top; clicking it loads all messages and then jumps.
- Resizing the window keeps markers aligned.
- The export menu no longer sits under the rail.

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npm run lint
git add src/components/chat/view/subcomponents/BookmarkRail.tsx src/components/chat/view/subcomponents/ChatMessagesPane.tsx
git commit -m "feat: add bookmark marker rail beside the chat scrollbar

Markers map each bookmarked message onto the scroll height, recomputed
on list change and resize rather than per scroll frame. Bookmarks whose
message is not loaded stack in a counted badge that loads the full
transcript before jumping.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Cross-session bookmark list in the sidebar

**Files:**
- Modify: `src/components/sidebar/types/types.ts:5`
- Create: `src/components/sidebar/view/subcomponents/SidebarBookmarkList.tsx`
- Modify: `src/components/sidebar/view/subcomponents/SidebarContent.tsx:441` (mode branch) and its props interface
- Modify: `src/components/sidebar/view/Sidebar.tsx:271-296`

**Interfaces:**
- Consumes: `GET /api/bookmarks` (Task 2); the existing `onConversationResultClick(projectId, sessionId, provider, messageTimestamp, messageSnippet)` navigation callback in `Sidebar.tsx`.
- Produces: `SidebarSearchMode` gains `'bookmarks'`.

- [ ] **Step 1: Add the search mode**

In `src/components/sidebar/types/types.ts`, line 5:

```ts
export type SidebarSearchMode = 'projects' | 'conversations' | 'running' | 'unread' | 'archived' | 'bookmarks';
```

- [ ] **Step 2: Write the list**

Create `src/components/sidebar/view/subcomponents/SidebarBookmarkList.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../utils/api';
import type { MessageBookmark } from '../../../chat/types/bookmarks';

interface SidebarBookmarkListProps {
  /** Reuses the conversation-search navigation, which already lands on a message. */
  onBookmarkClick: (
    sessionId: string,
    provider: string,
    messageTimestamp: string,
    messageSnippet: string,
    projectPath: string | null,
  ) => void;
}

function SidebarBookmarkList({ onBookmarkClick }: SidebarBookmarkListProps) {
  const { t } = useTranslation('sidebar');
  const [bookmarks, setBookmarks] = useState<MessageBookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/bookmarks')
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: MessageBookmark[]) => {
        if (!cancelled) setBookmarks(Array.isArray(rows) ? rows : []);
      })
      .catch(() => { if (!cancelled) setBookmarks([]); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, []);

  if (isLoading) {
    return (
      <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('bookmarks.loading', 'Loading bookmarks…')}
      </div>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('bookmarks.empty', 'No bookmarks yet. Pin a message to see it here.')}
      </div>
    );
  }

  return (
    <div className="space-y-1 px-2 py-2">
      {bookmarks.map((bookmark) => (
        <button
          key={bookmark.id}
          type="button"
          onClick={() => onBookmarkClick(
            bookmark.sessionId,
            bookmark.provider,
            bookmark.messageTimestamp,
            bookmark.snippet,
            bookmark.projectPath,
          )}
          className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <div className="truncate text-xs text-gray-800 dark:text-gray-200">
            {bookmark.label || bookmark.snippet}
          </div>
          <div className="truncate text-[10px] text-gray-400 dark:text-gray-500">
            {bookmark.projectPath || bookmark.sessionId}
          </div>
        </button>
      ))}
    </div>
  );
}

export default SidebarBookmarkList;
```

- [ ] **Step 3: Render it in bookmarks mode**

In `src/components/sidebar/view/subcomponents/SidebarContent.tsx`, add the import:

```tsx
import SidebarBookmarkList from './SidebarBookmarkList';
```

Add to the props interface, next to `searchMode`:

```tsx
  onBookmarkClick: (
    sessionId: string,
    provider: string,
    messageTimestamp: string,
    messageSnippet: string,
    projectPath: string | null,
  ) => void;
```

Destructure `onBookmarkClick` with the other props, then add a branch to the mode chain immediately after the `searchMode === 'archived'` branch that begins at line 441:

```tsx
        ) : searchMode === 'bookmarks' ? (
          <SidebarBookmarkList onBookmarkClick={onBookmarkClick} />
```

- [ ] **Step 4: Wire navigation in `Sidebar.tsx`**

The existing `onConversationResultClick` inline handler already performs the exact navigation a bookmark needs. Extract it so both callers share one implementation. Above the returned JSX in `Sidebar.tsx`, add:

```tsx
  // Shared by conversation search and the bookmark list: select the project if
  // we can resolve one, then open the session carrying the message anchor so
  // ChatInterface scrolls to it.
  const navigateToSessionMessage = (
    projectId: string | null,
    sessionId: string,
    provider: string,
    messageTimestamp?: string | null,
    messageSnippet?: string | null,
  ) => {
    const resolvedProvider = (provider || 'claude') as LLMProvider;
    const project = projectId ? projects.find(p => p.projectId === projectId) : null;
    const searchTarget = {
      __searchTargetTimestamp: messageTimestamp || null,
      __searchTargetSnippet: messageSnippet || null,
    };
    const sessionObj = {
      id: sessionId,
      __provider: resolvedProvider,
      __projectId: projectId ?? undefined,
      ...searchTarget,
    };
    if (project) {
      handleProjectSelect(project);
      const sessions = getProjectSessions(project);
      const existing = sessions.find(s => s.id === sessionId);
      if (existing) {
        handleSessionClick({ ...existing, ...searchTarget }, project.projectId);
      } else {
        handleSessionClick(sessionObj, project.projectId);
      }
    } else {
      handleSessionClick(sessionObj, projectId ?? '');
    }
  };
```

Replace the inline `onConversationResultClick` body (lines 271-296) with a call to it:

```tsx
            onConversationResultClick={(projectId: string | null, sessionId: string, provider: string, messageTimestamp?: string | null, messageSnippet?: string | null) => {
              // `projectId` (DB key) is the canonical identifier post-migration.
              // The server emits null when it can't resolve a project row for
              // the search hit; treat that as "no project" and still navigate
              // to the session so the user can open it from the URL.
              navigateToSessionMessage(projectId, sessionId, provider, messageTimestamp, messageSnippet);
            }}
```

Add the bookmark prop on the same component. Bookmarks store `project_path`, not the project id, so resolve the project row from the path — `Project.fullPath` is the required absolute path and `path` is an optional alias, so check both:

```tsx
            onBookmarkClick={(sessionId: string, provider: string, messageTimestamp: string, messageSnippet: string, projectPath: string | null) => {
              const project = projectPath
                ? projects.find(p => p.fullPath === projectPath || p.path === projectPath) ?? null
                : null;
              navigateToSessionMessage(project?.projectId ?? null, sessionId, provider, messageTimestamp, messageSnippet);
            }}
```

- [ ] **Step 5: Add a way to enter bookmarks mode**

`SidebarHeader.tsx` renders the mode switcher twice — a compact desktop block around line 220 and a wider mobile block around line 385. Both end with the same `archived` button inside a `<Tooltip>`. Add a bookmarks button immediately after the `archived` one **in both blocks**, matching the surrounding markup exactly:

```tsx
              <Tooltip content={t('search.bookmarksTooltip', 'Bookmarks')} position="top">
                <button
                  onClick={() => onSearchModeChange('bookmarks')}
                  aria-pressed={searchMode === 'bookmarks'}
                  aria-label={t('search.bookmarksTooltip', 'Bookmarks')}
                  title={t('search.bookmarksTooltip', 'Bookmarks')}
                  className={cn(
                    "flex items-center justify-center rounded-md px-2.5 py-1.5 text-xs font-normal transition-all",
                    searchMode === 'bookmarks'
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Bookmark className="h-3 w-3" />
                </button>
              </Tooltip>
```

Add `Bookmark` to the existing `lucide-react` import in that file (it already imports `Archive` from there).

The search input is not used in bookmarks mode. Extend the `searchPlaceholder` chain at line 57-60 so the placeholder is not misleading:

```tsx
    : searchMode === 'bookmarks'
      ? t('search.bookmarksPlaceholder', 'Filter bookmarks...')
```

Filtering itself is not wired up in this task — `SidebarBookmarkList` ignores `searchFilter`. That is deliberate: the list is short and the spec does not call for bookmark search.

- [ ] **Step 6: Verify by hand**

Run: `npm run dev` and confirm:
- Switching the sidebar to Bookmarks lists pins from more than one session.
- Clicking an entry from a different session opens that session and scrolls to the message.
- The list is reachable and usable at a phone-width viewport.

- [ ] **Step 7: Commit**

```bash
npm run typecheck && npm run lint && npm test && npm run test:client
git add src/components/sidebar
git commit -m "feat: add cross-session bookmark list to the sidebar

Reuses the conversation-search navigation, which already resolves a
project, opens a session, and scrolls to a message anchor.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Known follow-ups (not in this plan)

- `AskUserQuestion` blocks answered outside claudecodeui always render as "Skipped". Root cause: `toolConfigs.ts:483` reads answers from `input.answers`, which only claudecodeui's own permission panel populates (`AskUserQuestionPanel.tsx:84`); CLI-answered questions carry the answers in the tool_result text instead, and `ToolRenderer.tsx:218-222` never passes `toolResult` to `getContentProps`. Separate fix, tracked separately.
- `QuestionAnswerContent.test.tsx` remains unrun. Task 3 adds Vitest but limits `include` to `.test.ts`, because that file needs a DOM environment and React Testing Library.
