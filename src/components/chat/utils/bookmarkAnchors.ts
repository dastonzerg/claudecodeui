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
