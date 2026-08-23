import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  initializeDatabase,
  messageBookmarksDb,
  userDb,
} from '@/modules/database/index.js';

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
