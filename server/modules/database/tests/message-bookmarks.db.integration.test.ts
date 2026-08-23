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
