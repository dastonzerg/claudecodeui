import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { authenticatedFetch } from '../../../../utils/api';
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
}

function SidebarBookmarkList({ onBookmarkClick }: SidebarBookmarkListProps) {
  const { t } = useTranslation('sidebar');
  const [bookmarks, setBookmarks] = useState<MessageBookmark[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    authenticatedFetch('/api/bookmarks')
      .then((response) => (response.ok ? response.json() : []))
      .then((rows: MessageBookmark[]) => {
        if (!cancelled) setBookmarks(Array.isArray(rows) ? rows : []);
      })
      .catch(() => { if (!cancelled) setBookmarks([]); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  }, []);

  if (isLoading) {
    return (
      <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('bookmarks.loading', 'Loading bookmarks…')}
      </div>
    );
  }

  if (bookmarks.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-sm text-gray-500 dark:text-gray-400">
        {t('bookmarks.empty', 'No bookmarks yet. Pin a message to see it here.')}
      </div>
    );
  }

  return (
    <div className="space-y-1 px-2 py-2">
      {bookmarks.map((bookmark) => (
        <button
          key={bookmark.id}
          type="button"
          onClick={() => onBookmarkClick(
            bookmark.sessionId,
            bookmark.provider,
            bookmark.messageTimestamp,
            bookmark.snippet,
            bookmark.projectPath,
          )}
          className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-gray-100 dark:hover:bg-gray-800"
        >
          <div className="truncate text-xs text-gray-800 dark:text-gray-200">
            {bookmark.label || bookmark.snippet}
          </div>
          <div className="truncate text-[10px] text-gray-400 dark:text-gray-500">
            {bookmark.projectPath || bookmark.sessionId}
          </div>
        </button>
      ))}
    </div>
  );
}

export default SidebarBookmarkList;
