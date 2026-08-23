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
  /** While true, resolution skips the O(n) content fallback scan (see below). */
  isStreaming?: boolean;
}

export function useBookmarks({
  sessionId,
  provider,
  projectPath,
  messages,
  isStreaming = false,
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
      // A session switch can render the new session's messages before the
      // fetch for its bookmarks lands, leaving stale bookmarks from the
      // previous session in state. Resolving (and self-healing) those against
      // the wrong session's messages would permanently corrupt their anchor.
      if (bookmark.sessionId !== sessionId) {
        continue;
      }
      const resolved = resolveBookmarkTarget(bookmark, messages, { skipFallback: isStreaming });
      const resolvedId = resolved?.message.id;
      if (resolved && typeof resolvedId === 'string') {
        byBookmarkId.set(bookmark.id, { messageId: resolvedId, viaFallback: resolved.viaFallback });
      }
    }
    return byBookmarkId;
  }, [bookmarks, messages, sessionId, isStreaming]);

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
        .catch(() => { /* the fallback still resolves; healing retries next time sessionId changes, which resets healedRef */ });
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
    // Roll back only the row this call removed, not the whole array — another
    // pin/rename/self-heal can land while the DELETE is in flight, and
    // restoring a stale snapshot would clobber that already-persisted change.
    let removed: MessageBookmark | null = null;
    setBookmarks((current) => {
      removed = current.find((b) => b.id === bookmarkId) ?? null;
      return current.filter((b) => b.id !== bookmarkId);
    });

    const restore = () => {
      if (!removed) return;
      setBookmarks((current) => (
        current.some((b) => b.id === removed!.id)
          ? current
          // Match the server's ORDER BY message_timestamp ASC, id ASC so a
          // rollback does not visibly reshuffle the rail.
          : [...current, removed!].sort((a, b) => (
            new Date(a.messageTimestamp).getTime() - new Date(b.messageTimestamp).getTime() || a.id - b.id
          ))
      ));
    };

    void authenticatedFetch(`/api/bookmarks/${bookmarkId}`, { method: 'DELETE' })
      .then((response) => { if (!response.ok) restore(); })
      .catch(restore);
  }, []);

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

  return useMemo(
    () => ({ bookmarks, bookmarkForMessage, resolvedMessageIds, pin, unpin, rename }),
    [bookmarks, bookmarkForMessage, resolvedMessageIds, pin, unpin, rename],
  );
}
