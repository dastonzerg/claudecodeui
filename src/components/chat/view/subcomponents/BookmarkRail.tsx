import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useBookmarkState } from '../../../../contexts/BookmarkContext';
import type { MessageBookmark } from '../../types/bookmarks';

interface BookmarkRailProps {
  scrollContainerRef: RefObject<HTMLDivElement>;
  /** The inner content wrapper whose height changes as messages render/stream. */
  contentRef: RefObject<HTMLDivElement>;
  /** Bumped whenever the rendered message list changes, to recompute offsets. */
  messagesRevision: number;
  onLoadAllMessages: () => void;
}

interface MarkerPosition {
  bookmark: MessageBookmark;
  /** Percentage down the rail, or null when the message is not loaded. */
  topPercent: number | null;
}

const HIGHLIGHT_CLASS = 'search-highlight-flash';
const HIGHLIGHT_DURATION_MS = 4000;
/** Breathing room above a jumped-to message, clear of the sticky export menu. */
const JUMP_TOP_PADDING_PX = 12;

function BookmarkRail({ scrollContainerRef, contentRef, messagesRevision, onLoadAllMessages }: BookmarkRailProps) {
  const { t } = useTranslation('chat');
  const bookmarkState = useBookmarkState();
  const [positions, setPositions] = useState<MarkerPosition[]>([]);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const pendingJumpRef = useRef<number | null>(null);

  const bookmarks = bookmarkState?.bookmarks;
  const resolvedMessageIds = bookmarkState?.resolvedMessageIds;

  // Offsets depend on layout, not on scroll position, so this recomputes only
  // when the list changes or the container/content resizes — never per scroll frame.
  const recompute = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !bookmarks || !resolvedMessageIds) {
      setPositions([]);
      return;
    }

    const scrollHeight = container.scrollHeight || 1;
    setPositions(bookmarks.map((bookmark) => {
      const messageId = resolvedMessageIds.get(bookmark.id);
      const element = messageId
        ? container.querySelector<HTMLElement>(`[data-bookmark-id="${CSS.escape(messageId)}"]`)
        : null;

      if (!element) {
        return { bookmark, topPercent: null };
      }

      const center = element.offsetTop + element.clientHeight / 2;
      return { bookmark, topPercent: Math.min(100, Math.max(0, (center / scrollHeight) * 100)) };
    }));
  }, [scrollContainerRef, bookmarks, resolvedMessageIds]);

  useLayoutEffect(() => { recompute(); }, [recompute, messagesRevision]);

  // Recompute when the scroll container's own box resizes (e.g. window resize)
  // AND when the inner content wrapper's height changes — the latter is what
  // actually moves as a streaming message grows taller without the message
  // count changing, so `messagesRevision` alone would miss it.
  useEffect(() => {
    const container = scrollContainerRef.current;
    const content = contentRef.current;
    if (typeof ResizeObserver === 'undefined' || (!container && !content)) {
      return;
    }
    const observer = new ResizeObserver(() => recompute());
    if (container) observer.observe(container);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [scrollContainerRef, contentRef, recompute]);

  const scrollToBookmark = useCallback((bookmarkId: number) => {
    const container = scrollContainerRef.current;
    const messageId = resolvedMessageIds?.get(bookmarkId);
    if (!container || !messageId) {
      return false;
    }

    const element = container.querySelector<HTMLElement>(`[data-bookmark-id="${CSS.escape(messageId)}"]`);
    if (!element) {
      return false;
    }

    // Land on the message's first line rather than its middle, which is what a
    // reader expects from a bookmark. `scrollIntoView({ block: 'start' })` would
    // tuck that line under the sticky export menu, so scroll the container
    // directly: `offsetTop` is measured against this same container (it is the
    // bubbles' offsetParent), which is the coordinate space the marker
    // positions above already use.
    //
    // Jump instantly rather than smooth-scrolling: a bookmark is a destination,
    // and animating a long transcript means watching hundreds of messages blur
    // past before arriving. The highlight flash below is what confirms where
    // you landed.
    container.scrollTo({
      top: Math.max(0, element.offsetTop - JUMP_TOP_PADDING_PX),
      behavior: 'auto',
    });
    element.classList.add(HIGHLIGHT_CLASS);
    setTimeout(() => element.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_DURATION_MS);
    return true;
  }, [scrollContainerRef, resolvedMessageIds]);

  // A jump to an unloaded message asks for the full transcript, then retries
  // once the newly rendered messages bump `messagesRevision`.
  useEffect(() => {
    const pending = pendingJumpRef.current;
    if (pending === null) {
      return;
    }
    if (scrollToBookmark(pending)) {
      pendingJumpRef.current = null;
    }
  }, [messagesRevision, scrollToBookmark]);

  const handleMarkerClick = (bookmarkId: number) => {
    if (scrollToBookmark(bookmarkId)) {
      return;
    }
    pendingJumpRef.current = bookmarkId;
    onLoadAllMessages();
  };

  if (!bookmarkState || positions.length === 0) {
    return null;
  }

  const unresolved = positions.filter((position) => position.topPercent === null);
  const resolved = positions.filter((position) => position.topPercent !== null);

  const markerLabel = (bookmark: MessageBookmark) => bookmark.label || bookmark.snippet;

  return (
    <div
      className="pointer-events-none absolute inset-y-0 right-0 z-20 w-4"
      aria-label={t('bookmarks.railLabel', { defaultValue: 'Bookmarks' })}
    >
      {resolved.map(({ bookmark, topPercent }) => (
        <button
          key={bookmark.id}
          type="button"
          onClick={() => handleMarkerClick(bookmark.id)}
          onMouseEnter={() => setHoveredId(bookmark.id)}
          onMouseLeave={() => setHoveredId((current) => (current === bookmark.id ? null : current))}
          style={{ top: `${topPercent}%` }}
          title={markerLabel(bookmark)}
          aria-label={markerLabel(bookmark)}
          className="pointer-events-auto absolute right-0.5 h-1.5 w-3 -translate-y-1/2 rounded-sm bg-blue-500/70 hover:bg-blue-500 dark:bg-blue-400/70 dark:hover:bg-blue-400"
        >
          {hoveredId === bookmark.id && (
            <span className="pointer-events-none absolute right-5 top-1/2 w-56 -translate-y-1/2 truncate rounded bg-gray-900 px-2 py-1 text-left text-[11px] text-white shadow-lg dark:bg-gray-700">
              {markerLabel(bookmark)}
            </span>
          )}
        </button>
      ))}

      {unresolved.length > 0 && (
        <button
          type="button"
          onClick={() => handleMarkerClick(unresolved[0].bookmark.id)}
          title={t('bookmarks.unloaded', {
            count: unresolved.length,
            defaultValue: '{{count}} bookmark(s) in messages not loaded yet',
          })}
          className="pointer-events-auto absolute right-0.5 top-1 flex h-4 w-3 items-center justify-center rounded-sm bg-gray-400/70 text-[8px] font-semibold text-white hover:bg-gray-500 dark:bg-gray-500/70"
        >
          {unresolved.length}
        </button>
      )}
    </div>
  );
}

export default BookmarkRail;
