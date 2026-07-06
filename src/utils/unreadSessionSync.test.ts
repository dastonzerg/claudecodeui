import assert from 'node:assert/strict';
import test from 'node:test';

import {
  emitSessionMarkedRead,
  onSessionMarkedRead,
} from './unreadSessionSync';

test('emits marked-read events with the session id', async () => {
  const sessionId = 'session-123';
  const seen = await new Promise<string>((resolve) => {
    const dispose = onSessionMarkedRead((nextSessionId) => {
      dispose();
      resolve(nextSessionId);
    });

    emitSessionMarkedRead(sessionId);
  });

  assert.equal(seen, sessionId);
});

test('stops notifying listeners after dispose', () => {
  let calls = 0;
  const dispose = onSessionMarkedRead(() => {
    calls += 1;
  });

  dispose();
  emitSessionMarkedRead('session-123');

  assert.equal(calls, 0);
});
