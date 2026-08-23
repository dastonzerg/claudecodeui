/**
 * Cross-component notification that the bookmark set changed.
 *
 * Two independent places hold bookmark state: `useBookmarks` (the marker rail
 * and the pin control, scoped to the open session) and `SidebarBookmarkList`
 * (every bookmark the user owns). Each fetches its own slice, so a mutation in
 * one left the other showing stale rows until a reload — deleting from the
 * sidebar, for instance, left the rail marker behind.
 *
 * Rather than hoist both into a shared store, mutations announce themselves
 * here and every holder re-fetches. Follows the same module-level listener-set
 * pattern as `unreadSessionSync`.
 *
 * Only user-initiated membership or label changes should emit. The self-heal
 * anchor PATCH deliberately does not: it rewrites a stored message id without
 * changing what any view displays, so broadcasting it would cost a refetch in
 * every holder for no visible difference.
 */

type BookmarksChangedListener = () => void;

const bookmarksChangedListeners = new Set<BookmarksChangedListener>();

export function emitBookmarksChanged(): void {
  bookmarksChangedListeners.forEach((listener) => {
    listener();
  });
}

export function onBookmarksChanged(listener: BookmarksChangedListener): () => void {
  bookmarksChangedListeners.add(listener);
  return () => {
    bookmarksChangedListeners.delete(listener);
  };
}
