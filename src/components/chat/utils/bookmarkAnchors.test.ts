import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '../types/types';
import type { MessageBookmark } from '../types/bookmarks';

import { makeSnippet, resolveBookmarkTarget } from './bookmarkAnchors';

function message(id: string, type: string, timestamp: string, content: string, isThinking?: boolean): ChatMessage {
  return { id, type, timestamp, content, isThinking };
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

  it('skips a thinking message even when it ties on timestamp and matches the snippet', () => {
    const assistantBookmark: MessageBookmark = {
      ...bookmark,
      messageId: 'm-2',
      messageType: 'assistant',
    };
    const messages = [
      message('reloaded-thinking', 'assistant', '2026-08-22T10:00:00.000Z', 'the pinned sentence and more', true),
      message('reloaded-final', 'assistant', '2026-08-22T10:00:00.000Z', 'the pinned sentence and more'),
    ];

    const resolved = resolveBookmarkTarget(assistantBookmark, messages);
    expect(resolved).toEqual({ message: messages[1], viaFallback: true });
  });

  it('skips the content fallback when skipFallback is set, even with an id miss', () => {
    const messages = [
      message('reloaded-b', 'user', '2026-08-22T10:00:02.000Z', 'the pinned sentence and more'),
    ];

    expect(resolveBookmarkTarget(bookmark, messages, { skipFallback: true })).toBeNull();
  });
});
