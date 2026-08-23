import { createContext, useContext } from 'react';

import type { ChatMessage } from '../components/chat/types/types';
import type { MessageBookmark } from '../components/chat/types/bookmarks';

export interface BookmarkContextValue {
  bookmarks: MessageBookmark[];
  /** The bookmark pinning this message, if any. */
  bookmarkForMessage: (message: ChatMessage) => MessageBookmark | null;
  /** Bookmark id to the message id it currently resolves to. Drives the rail. */
  resolvedMessageIds: Map<number, string>;
  pin: (message: ChatMessage) => void;
  unpin: (bookmarkId: number) => void;
  rename: (bookmarkId: number, label: string | null) => void;
}

const BookmarkContext = createContext<BookmarkContextValue | null>(null);

export function useBookmarkState(): BookmarkContextValue | null {
  return useContext(BookmarkContext);
}

export default BookmarkContext;
