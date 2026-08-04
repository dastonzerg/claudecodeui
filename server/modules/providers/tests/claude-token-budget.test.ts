import assert from 'node:assert/strict';
import test from 'node:test';

import { extractTokenBudget } from '@/modules/providers/list/claude/claude-runtime.provider.js';

/**
 * An assistant message carries the usage of the request that produced it, which
 * is what actually occupies the context window.
 */
const assistantMessage = (inputTokens: number, outputTokens: number) => ({
  type: 'assistant',
  message: {
    model: 'claude-opus-4-8',
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
  },
});

/**
 * The terminal result message sums usage across every API call in the turn, so
 * after a long tool-using turn it reads far higher than the live window.
 */
const resultMessage = (cumulativeInput: number, cumulativeOutput: number, contextWindow?: number) => ({
  type: 'result',
  subtype: 'success',
  usage: {
    input_tokens: cumulativeInput,
    output_tokens: cumulativeOutput,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  },
  modelUsage: {
    'claude-opus-4-8': {
      cumulativeInputTokens: cumulativeInput,
      cumulativeOutputTokens: cumulativeOutput,
      ...(contextWindow ? { contextWindow } : {}),
    },
  },
});

test('assistant messages report the usage of their own request', () => {
  const budget = extractTokenBudget(assistantMessage(440_000, 3_000), 'opus');

  assert.equal(budget?.used, 443_000);
});

test('the terminal result message does not overwrite used with the turn total', () => {
  // A long turn: the last request held 443k, but the turn summed to 5.3M.
  const live = extractTokenBudget(assistantMessage(440_000, 3_000), 'opus');
  const final = extractTokenBudget(resultMessage(5_200_000, 100_000), 'opus', live);

  assert.equal(final?.used, 443_000, 'must keep the per-request figure, not the 5.3M turn total');
  assert.equal(final?.inputTokens, live?.inputTokens);
  assert.equal(final?.outputTokens, live?.outputTokens);
});

test('the result message still contributes the real context window', () => {
  const live = extractTokenBudget(assistantMessage(440_000, 3_000), 'opus');
  const final = extractTokenBudget(resultMessage(5_200_000, 100_000, 1_000_000), 'opus', live);

  assert.equal(final?.total, 1_000_000);
});

test('a turn total above the window no longer pins the indicator at 0% left', () => {
  const live = extractTokenBudget(assistantMessage(440_000, 3_000), 'opus');
  const final = extractTokenBudget(resultMessage(5_200_000, 100_000, 800_000), 'opus', live);

  const percentLeft = Math.round(((final!.total - final!.used) / final!.total) * 100);
  assert.equal(percentLeft, 45);
});

test('a result with no preceding assistant budget still reports something', () => {
  const final = extractTokenBudget(resultMessage(120_000, 5_000, 200_000), 'opus');

  assert.equal(final?.used, 125_000);
});
