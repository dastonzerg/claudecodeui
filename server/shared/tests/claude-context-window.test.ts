import assert from 'node:assert/strict';
import test from 'node:test';

import { getClaudeContextWindow } from '@/shared/claude-context-window.js';

// Fable's 1M window is native rather than a beta opt-in, and transcripts
// record the bare id (`claude-fable-5`) with the `[1m]` selector stripped, so
// the suffix check alone would understate every Fable session by 5x.
test('Fable is 1M with or without the [1m] selector', () => {
  assert.equal(getClaudeContextWindow('claude-fable-5'), 1_000_000);
  assert.equal(getClaudeContextWindow('claude-fable-5[1m]'), 1_000_000);
  assert.equal(getClaudeContextWindow('fable'), 1_000_000);
  assert.equal(getClaudeContextWindow('Fable'), 1_000_000);
});

test('the [1m] beta still opts other families into 1M', () => {
  assert.equal(getClaudeContextWindow('opus[1m]'), 1_000_000);
  assert.equal(getClaudeContextWindow('claude-opus-5[1m]'), 1_000_000);
  assert.equal(getClaudeContextWindow('sonnet[1m]'), 1_000_000);
});

test('families without the beta stay at 200k', () => {
  assert.equal(getClaudeContextWindow('opus'), 200_000);
  assert.equal(getClaudeContextWindow('sonnet'), 200_000);
  assert.equal(getClaudeContextWindow('haiku'), 200_000);
  assert.equal(getClaudeContextWindow('claude-haiku-4-5'), 200_000);
});

test('non-Claude models return null so callers keep their own fallback', () => {
  assert.equal(getClaudeContextWindow('gpt-5.6-sol'), null);
  assert.equal(getClaudeContextWindow(''), null);
  assert.equal(getClaudeContextWindow(null), null);
  assert.equal(getClaudeContextWindow(undefined), null);
});
