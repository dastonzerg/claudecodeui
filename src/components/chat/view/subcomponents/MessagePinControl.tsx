import { useTranslation } from 'react-i18next';

import { useBookmarkState } from '../../../../contexts/BookmarkContext';
import type { ChatMessage } from '../../types/types';

/**
 * Always visible rather than hover-revealed like the copy and speak controls:
 * hover does not exist on touch, and this row already occupies its own line so
 * a persistent icon costs no extra height.
 */
const MessagePinControl = ({ message }: { message: ChatMessage }) => {
  const { t } = useTranslation('chat');
  const bookmarkState = useBookmarkState();

  if (!bookmarkState || typeof message.id !== 'string') {
    return null;
  }

  const bookmark = bookmarkState.bookmarkForMessage(message);
  const isPinned = Boolean(bookmark);

  return (
    <button
      type="button"
      aria-pressed={isPinned}
      title={isPinned ? t('bookmarks.unpin', 'Remove bookmark') : t('bookmarks.pin', 'Bookmark this message')}
      aria-label={isPinned ? t('bookmarks.unpin', 'Remove bookmark') : t('bookmarks.pin', 'Bookmark this message')}
      onClick={() => {
        if (bookmark) {
          bookmarkState.unpin(bookmark.id);
        } else {
          bookmarkState.pin(message);
        }
      }}
      className={`inline-flex h-5 w-5 items-center justify-center rounded transition-opacity hover:opacity-100 ${
        isPinned ? 'opacity-100' : 'opacity-50'
      }`}
    >
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 24 24"
        fill={isPinned ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth={2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-4-7 4V5z"
        />
      </svg>
    </button>
  );
};

export default MessagePinControl;
