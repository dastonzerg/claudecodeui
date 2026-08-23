/** A pinned message, exactly as `/api/bookmarks` returns it. */
export interface MessageBookmark {
  id: number;
  sessionId: string;
  provider: string;
  projectPath: string | null;
  messageId: string | null;
  messageTimestamp: string;
  snippet: string;
  label: string | null;
  messageType: string;
  createdAt: string;
}
