/**
 * Temporary diagnostics for the chat scroll position.
 *
 * Investigating a jump seen when a session is actively generating, the user is
 * parked partway up the transcript, and the page is then refreshed or the
 * websocket reconnects. Several things write `scrollTop` in that window — the
 * initial bottom-pin's rAF loop, the new-message follow effect, the
 * load-older restore, and the search/bookmark jump — so the goal is to see
 * which one moves the viewport, and when.
 *
 * Off unless explicitly enabled, so it costs nothing in normal use:
 *
 *   localStorage.setItem('debug-chat-scroll', '1')   // then reload
 *   localStorage.removeItem('debug-chat-scroll')     // to stop
 *
 * Remove this module once the cause is found.
 */

let enabled: boolean | null = null;

function isEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = typeof window !== 'undefined'
        && window.localStorage.getItem('debug-chat-scroll') === '1';
    } catch {
      // Private-mode or blocked storage: treat as off rather than throwing on
      // every log call.
      enabled = false;
    }
  }
  return enabled;
}

type ScrollSnapshot = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  /** Distance from the bottom; 0 means pinned. */
  fromBottom: number;
};

export function snapshotScroll(container: HTMLElement | null): ScrollSnapshot | null {
  if (!container) return null;
  const { scrollTop, scrollHeight, clientHeight } = container;
  return {
    scrollTop: Math.round(scrollTop),
    scrollHeight: Math.round(scrollHeight),
    clientHeight: Math.round(clientHeight),
    fromBottom: Math.round(scrollHeight - scrollTop - clientHeight),
  };
}

/**
 * `event` names the site that ran, `data` carries whatever that site decided
 * on. Timestamps are ms since page load so the ordering across effects,
 * timeouts, and animation frames is readable at a glance.
 */
export function logScroll(event: string, data?: Record<string, unknown>): void {
  if (!isEnabled()) return;
  const at = Math.round(performance.now());
  // eslint-disable-next-line no-console
  console.log(`[chat-scroll +${at}ms] ${event}`, data ?? {});
}

export function isScrollDebugEnabled(): boolean {
  return isEnabled();
}
