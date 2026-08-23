import { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../utils/api';
import { emitBookmarksChanged, onBookmarksChanged } from '../../../../utils/bookmarkSync';
import type { MessageBookmark } from '../../../chat/types/bookmarks';

interface SidebarBookmarkListProps {
  /** Reuses the conversation-search navigation, which already lands on a message. */
  onBookmarkClick: (
    sessionId: string,
    provider: string,
    messageTimestamp: string,
    messageSnippet: string,
    projectPath: string | null,
  ) => void;
  /** Case-insensitive filter against each bookmark's label and snippet. */
  searchFilter: string;
}

function SidebarBookmarkList({ onBookmarkClick, searchFilter }: SidebarBookmarkListProps) {
  const { t } = useTranslation('sidebar');
  const [bookmarks, setBookmarks] = useState<MessageBookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      authenticatedFetch('/api/bookmarks')
        .then((response) => (response.ok ? response.json() : []))
        .then((rows: MessageBookmark[]) => {
          if (!cancelled) setBookmarks(Array.isArray(rows) ? rows : []);
        })
        .catch(() => { if (!cancelled) setBookmarks([]); })
        .finally(() => { if (!cancelled) setIsLoading(false); });
    };

    load();
    // Pinning or unpinning from a chat bubble mutates the same rows this list
    // shows, so those changes have to reach it without a reload.
    const unsubscribe = onBookmarksChanged(load);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const startEditing = (bookmark: MessageBookmark) => {
    setEditingId(bookmark.id);
    setEditingValue(bookmark.label ?? bookmark.snippet);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditingValue('');
  };

  const commitRename = (bookmarkId: number) => {
    // An empty rename clears the label back to the snippet.
    const label = editingValue.trim().length > 0 ? editingValue.trim() : null;
    cancelEditing();

    void authenticatedFetch(`/api/bookmarks/${bookmarkId}`, {
      method: 'PATCH',
      body: JSON.stringify({ label }),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((updated: MessageBookmark | null) => {
        if (updated) {
          setBookmarks((current) => current.map((b) => (b.id === updated.id ? updated : b)));
          emitBookmarksChanged();
        }
      })
      .catch(() => { /* label unchanged */ });
  };

  const deleteBookmark = (bookmarkId: number) => {
    const removed = bookmarks.find((b) => b.id === bookmarkId) ?? null;
    setBookmarks((current) => current.filter((b) => b.id !== bookmarkId));

    void authenticatedFetch(`/api/bookmarks/${bookmarkId}`, { method: 'DELETE' })
      .then((response) => {
        if (response.ok) {
          // The rail in the open session holds its own copy of this row; without
          // this it keeps rendering a marker for a bookmark that no longer exists.
          emitBookmarksChanged();
        } else if (removed) {
          setBookmarks((current) => (
            current.some((b) => b.id === removed.id) ? current : [...current, removed]
          ));
        }
      })
      .catch(() => {
        if (removed) {
          setBookmarks((current) => (
            current.some((b) => b.id === removed.id) ? current : [...current, removed]
          ));
        }
      });
  };

  if (isLoading) {
    return (
      <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('bookmarks.loading', { defaultValue: 'Loading bookmarks…' })}
      </div>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('bookmarks.empty', { defaultValue: 'No bookmarks yet. Pin a message to see it here.' })}
      </div>
    );
  }

  const needle = searchFilter.trim().toLowerCase();
  const visibleBookmarks = needle.length === 0
    ? bookmarks
    : bookmarks.filter((bookmark) => (
      (bookmark.label ?? '').toLowerCase().includes(needle)
      || bookmark.snippet.toLowerCase().includes(needle)
    ));

  if (visibleBookmarks.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('bookmarks.noMatches', { defaultValue: 'No bookmarks match this search.' })}
      </div>
    );
  }

  return (
    <div className="space-y-1 px-2 py-2">
      {visibleBookmarks.map((bookmark) => (
        <div
          key={bookmark.id}
          className="group flex items-center gap-1 rounded-lg px-2 py-1.5 hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          {editingId === bookmark.id ? (
            <input
              autoFocus
              value={editingValue}
              onChange={(event) => setEditingValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitRename(bookmark.id);
                } else if (event.key === 'Escape') {
                  cancelEditing();
                }
              }}
              onBlur={() => commitRename(bookmark.id)}
              className="min-w-0 flex-1 rounded border border-gray-300 bg-white px-1.5 py-0.5 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-200"
            />
          ) : (
            <button
              type="button"
              onClick={() => onBookmarkClick(
                bookmark.sessionId,
                bookmark.provider,
                bookmark.messageTimestamp,
                bookmark.snippet,
                bookmark.projectPath,
              )}
              className="min-w-0 flex-1 text-left"
            >
              <div className="truncate text-xs text-gray-800 dark:text-gray-200">
                {bookmark.label || bookmark.snippet}
              </div>
              <div className="truncate text-[10px] text-gray-400 dark:text-gray-500">
                {bookmark.projectPath || bookmark.sessionId}
              </div>
            </button>
          )}

          {editingId !== bookmark.id && (
            /* Always visible, not hover-revealed: hover does not exist on touch,
               and the first tap would land on the row button and navigate away
               instead. Same reasoning as the pin control on chat bubbles. */
            <div className="flex flex-shrink-0 items-center gap-0.5 opacity-60 transition-opacity hover:opacity-100">
              <button
                type="button"
                onClick={() => startEditing(bookmark)}
                title={t('bookmarks.rename', { defaultValue: 'Rename bookmark' })}
                aria-label={t('bookmarks.rename', { defaultValue: 'Rename bookmark' })}
                className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => deleteBookmark(bookmark.id)}
                title={t('bookmarks.delete', { defaultValue: 'Delete bookmark' })}
                aria-label={t('bookmarks.delete', { defaultValue: 'Delete bookmark' })}
                className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/40 dark:hover:text-red-400"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export default SidebarBookmarkList;
