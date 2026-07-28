import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  closeConnection,
  getConnection,
  initializeDatabase,
  projectsDb,
} from '@/modules/database/index.js';
import { searchConversations } from '@/modules/providers/services/session-conversations-search.service.js';

async function withIsolatedDatabase(runTest: (tempDir: string) => Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'conv-search-'));
  const databasePath = path.join(tempDirectory, 'auth.db');

  closeConnection();
  process.env.DATABASE_PATH = databasePath;
  await initializeDatabase();

  try {
    await runTest(tempDirectory);
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

/**
 * Inserts a Claude session whose app `session_id` differs from the
 * `provider_session_id` written into the transcript, mirroring app-created or
 * remapped sessions. Regression guard for the search dropping such sessions
 * because it filtered transcript rows by the app id instead of the provider id.
 */
test('finds remapped sessions where session_id differs from the on-disk provider id', async () => {
  await withIsolatedDatabase(async (tempDir) => {
    const projectPath = path.join(tempDir, 'workspace', 'demo-project');
    const providerSessionId = 'provider-abc-123';
    const appSessionId = 'app-xyz-789';
    const jsonlPath = path.join(tempDir, `${providerSessionId}.jsonl`);

    const lines = [
      JSON.stringify({
        sessionId: providerSessionId,
        cwd: projectPath,
        type: 'user',
        timestamp: '2026-07-24T00:00:00.000Z',
        uuid: 'u-1',
        message: { role: 'user', content: [{ type: 'text', text: 'Please set up Tampermonkey for me' }] },
      }),
      JSON.stringify({
        sessionId: providerSessionId,
        cwd: projectPath,
        type: 'assistant',
        timestamp: '2026-07-24T00:00:01.000Z',
        uuid: 'a-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Installing the Tampermonkey script now.' }] },
      }),
    ];
    await writeFile(jsonlPath, `${lines.join('\n')}\n`, 'utf8');

    projectsDb.createProjectPath(projectPath);
    getConnection()
      .prepare(
        `INSERT INTO sessions
           (session_id, provider, provider_session_id, custom_name, project_path, jsonl_path, isArchived)
         VALUES (?, 'claude', ?, NULL, ?, ?, 0)`
      )
      .run(appSessionId, providerSessionId, projectPath, jsonlPath);

    const { results, totalMatches } = await searchConversations('Tampermonkey');

    assert.ok(totalMatches > 0, 'expected at least one match for the remapped session');
    const sessionIds = results.flatMap((project) => project.sessions.map((s) => s.sessionId));
    assert.ok(
      sessionIds.includes(appSessionId),
      `expected result to reference the app session id, got ${JSON.stringify(sessionIds)}`,
    );
  });
});
