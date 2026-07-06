import { appConfigDb } from '@/modules/database/index.js';

// Stored as a JSON array under a single app_config key rather than a new
// sessions column - this is a client-facing reminder ("finished a run, not
// dismissed yet"), not data the rest of the app needs to query by, so it
// doesn't need a schema change.
const UNREAD_SESSION_IDS_CONFIG_KEY = 'unread_session_ids';

function readUnreadSessionIds(): string[] {
  const raw = appConfigDb.get(UNREAD_SESSION_IDS_CONFIG_KEY);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
}

function writeUnreadSessionIds(sessionIds: string[]): void {
  appConfigDb.set(UNREAD_SESSION_IDS_CONFIG_KEY, JSON.stringify(sessionIds));
}

export function getUnreadSessionIds(): string[] {
  return readUnreadSessionIds();
}

/**
 * Merges the given session ids into the persisted unread set (idempotent).
 */
export function addUnreadSessionIds(sessionIdsToAdd: string[]): string[] {
  const merged = new Set(readUnreadSessionIds());
  for (const sessionId of sessionIdsToAdd) {
    const trimmed = sessionId.trim();
    if (trimmed) {
      merged.add(trimmed);
    }
  }

  const next = [...merged];
  writeUnreadSessionIds(next);
  return next;
}

export function clearUnreadSessionIds(): string[] {
  writeUnreadSessionIds([]);
  return [];
}
