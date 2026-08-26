import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { closeConnection, initializeDatabase, sessionsDb } from '@/modules/database/index.js';
import { CodexSessionSynchronizer } from '@/modules/providers/list/codex/codex-session-synchronizer.provider.js';
import { CodexSessionsProvider } from '@/modules/providers/list/codex/codex-sessions.provider.js';

const patchHomeDir = (nextHomeDir: string) => {
  const original = os.homedir;
  (os as any).homedir = () => nextHomeDir;
  return () => {
    (os as any).homedir = original;
  };
};

async function withIsolatedDatabase(runTest: () => void | Promise<void>): Promise<void> {
  const previousDatabasePath = process.env.DATABASE_PATH;
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-provider-db-'));
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

/**
 * Writes one Codex rollout transcript. `firstUserMessage` mirrors the
 * `event_msg`/`user_message` payload the runtime records for the prompt the
 * user typed; omitting it produces a transcript with no user turn.
 */
const writeCodexTranscript = async (
  homeDir: string,
  codexSessionId: string,
  workspacePath: string,
  firstUserMessage?: string,
): Promise<string> => {
  const sessionsDir = path.join(homeDir, '.codex', 'sessions', '2026', '07', '07');
  await mkdir(sessionsDir, { recursive: true });

  const lines: string[] = [
    JSON.stringify({ type: 'session_meta', payload: { id: codexSessionId, cwd: workspacePath } }),
  ];
  if (firstUserMessage !== undefined) {
    lines.push(JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: firstUserMessage } }));
  }

  const filePath = path.join(sessionsDir, `rollout-${codexSessionId}.jsonl`);
  await writeFile(filePath, `${lines.join('\n')}\n`, 'utf8');
  return filePath;
};

test('Codex synchronizer titles app-created sessions from the first user message', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-app-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    await writeCodexTranscript(tempRoot, 'codex-app-1', workspacePath, 'Fix the login redirect bug');
    await withIsolatedDatabase(async () => {
      // The app allocates its own id and later maps the provider id onto it,
      // exactly as a message sent from cloudcli does.
      sessionsDb.createAppSession('app-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-1', 'codex-app-1');

      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('app-1')?.custom_name, 'Fix the login redirect bug');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer skips sub-agent rollout files', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-subagent-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // Codex >=0.144 spawn_agent threads write their own rollout files into the
    // same sessions tree, marked via thread_source/source in session_meta.
    const sessionsDir = path.join(tempRoot, '.codex', 'sessions', '2026', '07', '07');
    await mkdir(sessionsDir, { recursive: true });
    await writeFile(
      path.join(sessionsDir, 'rollout-codex-subagent-1.jsonl'),
      `${JSON.stringify({
        type: 'session_meta',
        payload: {
          id: 'codex-subagent-1',
          cwd: workspacePath,
          thread_source: 'subagent',
          parent_thread_id: 'codex-parent-1',
          source: { subagent: { thread_spawn: { parent_thread_id: 'codex-parent-1', depth: 1 } } },
        },
      })}\n`,
      'utf8'
    );
    await writeCodexTranscript(tempRoot, 'codex-parent-1', workspacePath);

    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      const processed = await synchronizer.synchronize();

      assert.equal(processed, 1);
      assert.ok(sessionsDb.getSessionById('codex-parent-1'));
      assert.equal(sessionsDb.getSessionById('codex-subagent-1'), null);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex synchronizer leaves indexed sessions untitled when no name is available', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-session-sync-indexed-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    // A CLI-created session has no app row; its first user message must NOT be
    // used as the title, preserving the existing indexing behavior.
    await writeCodexTranscript(tempRoot, 'codex-indexed-1', workspacePath, 'This prompt should be ignored');
    await withIsolatedDatabase(async () => {
      const synchronizer = new CodexSessionSynchronizer();
      await synchronizer.synchronize();

      assert.equal(sessionsDb.getSessionById('codex-indexed-1')?.custom_name, 'Untitled Codex Session');
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('Codex history renders Promise.all shell wrappers as Bash activity', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-exec-history-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const providerSessionId = 'codex-exec-1';
    const transcriptPath = await writeCodexTranscript(tempRoot, providerSessionId, workspacePath);
    const execInput = 'const cmds = ["echo one", "echo two"]; await Promise.all(cmds.map(command => tools.shell_command({ command })));';
    const planInput = 'await tools.update_plan({ plan: [] });';
    await writeFile(transcriptPath, [
      JSON.stringify({ type: 'session_meta', payload: { id: providerSessionId, cwd: workspacePath } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'exec-1', input: execInput } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'exec-1', output: 'done' } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'plan-1', input: planInput } }),
      JSON.stringify({ type: 'response_item', payload: { type: 'custom_tool_call_output', call_id: 'plan-1', output: 'done' } }),
    ].join('\n') + '\n', 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-exec-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-exec-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const history = await new CodexSessionsProvider().fetchHistory('app-exec-1');
      const toolUses = history.messages.filter((message) => message.kind === 'tool_use');
      const toolResults = history.messages.filter((message) => message.kind === 'tool_result');

      assert.equal(toolUses.length, 1);
      assert.equal(toolUses[0].toolName, 'Bash');
      assert.equal(toolUses[0].toolInput, JSON.stringify({ command: 'echo one\necho two' }));
      assert.equal(toolResults.some((message) => message.toolCallId === 'plan-1'), false);
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * React keys the chat list by message id. A transcript entry with no id of its
 * own used to fall back to a random uuid, minted fresh on every read, so two
 * identical reads returned two different sets of ids. The client then remounted
 * every message on each refresh, which destroyed the browser's scroll anchor
 * and jumped the viewport of anyone reading further up.
 */
test('Codex history assigns the same message ids on repeated reads', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-stable-ids-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const providerSessionId = 'codex-stable-1';
    const transcriptPath = await writeCodexTranscript(tempRoot, providerSessionId, workspacePath);
    await writeFile(transcriptPath, [
      JSON.stringify({ type: 'session_meta', payload: { id: providerSessionId, cwd: workspacePath } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'first question' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'first answer' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'second question' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'second answer' } }),
    ].join('\n') + '\n', 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-stable-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-stable-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const provider = new CodexSessionsProvider();
      const first = await provider.fetchHistory('app-stable-1');
      const second = await provider.fetchHistory('app-stable-1');

      assert.ok(first.messages.length > 0, 'expected the transcript to produce messages');
      assert.equal(first.messages.length, second.messages.length);
      assert.deepEqual(
        second.messages.map((message) => message.id),
        first.messages.map((message) => message.id),
        'message ids must be identical across reads so React can reuse the DOM nodes',
      );
      assert.equal(
        new Set(first.messages.map((message) => message.id)).size,
        first.messages.length,
        'message ids must stay unique within a transcript',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

/**
 * Position-derived ids are only sound if an entry keeps its ordinal as the
 * transcript grows. That is the live case: the agent appends while the reader
 * sits further up, and any id churn among the messages already on screen would
 * remount them and jump the viewport — the very thing the ids were made stable
 * to prevent.
 */
test('Codex history keeps existing message ids when the transcript grows', { concurrency: false }, async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'codex-grow-ids-'));
  const workspacePath = path.join(tempRoot, 'workspace');
  await mkdir(workspacePath, { recursive: true });
  const restoreHomeDir = patchHomeDir(tempRoot);

  try {
    const providerSessionId = 'codex-grow-1';
    const transcriptPath = await writeCodexTranscript(tempRoot, providerSessionId, workspacePath);
    const openingLines = [
      JSON.stringify({ type: 'session_meta', payload: { id: providerSessionId, cwd: workspacePath } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'first question' } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'first answer' } }),
    ];
    await writeFile(transcriptPath, openingLines.join('\n') + '\n', 'utf8');

    await withIsolatedDatabase(async () => {
      sessionsDb.createAppSession('app-grow-1', 'codex', workspacePath);
      sessionsDb.assignProviderSessionId('app-grow-1', providerSessionId);
      await new CodexSessionSynchronizer().synchronize();

      const provider = new CodexSessionsProvider();
      const before = await provider.fetchHistory('app-grow-1');

      // The agent keeps working: two more turns land at the end of the rollout.
      await writeFile(transcriptPath, [
        ...openingLines,
        JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'second question' } }),
        JSON.stringify({ type: 'event_msg', payload: { type: 'agent_message', message: 'second answer' } }),
      ].join('\n') + '\n', 'utf8');

      const after = await provider.fetchHistory('app-grow-1');

      assert.ok(before.messages.length > 0, 'expected the opening transcript to produce messages');
      assert.ok(
        after.messages.length > before.messages.length,
        'expected the appended turns to produce more messages',
      );
      assert.deepEqual(
        after.messages.slice(0, before.messages.length).map((message) => message.id),
        before.messages.map((message) => message.id),
        'ids of already-rendered messages must not change when new ones are appended',
      );
    });
  } finally {
    restoreHomeDir();
    await rm(tempRoot, { recursive: true, force: true });
  }
});
