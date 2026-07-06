import { useCallback, useEffect, useState } from 'react';

import { api } from '../../../utils/api';

const POLL_INTERVAL_MS = 15000;

/**
 * Tracks whether the given session is currently in the server-persisted
 * "Unread" set (see the sidebar's Unread tab), independent of the sidebar's
 * own state - self-contained so the chat header doesn't need shared state
 * with the sidebar to show its own "Mark as read" button.
 */
export function useSessionUnreadStatus(sessionId: string | undefined) {
  const [isUnread, setIsUnread] = useState(false);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setIsUnread(false);
      return;
    }

    try {
      const response = await api.getUnreadSessionIds();
      const data = await response.json();
      const sessionIds = Array.isArray(data.sessionIds) ? data.sessionIds : [];
      setIsUnread(sessionIds.includes(sessionId));
    } catch {
      // Leave current state as-is if the fetch fails.
    }
  }, [sessionId]);

  useEffect(() => {
    void refresh();

    if (!sessionId) {
      return;
    }

    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [refresh, sessionId]);

  const markRead = useCallback(() => {
    if (!sessionId) {
      return;
    }

    setIsUnread(false);
    void api.markSessionRead(sessionId);
  }, [sessionId]);

  return { isUnread, markRead };
}
