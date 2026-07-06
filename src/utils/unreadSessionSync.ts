type SessionMarkedReadListener = (sessionId: string) => void;

const sessionMarkedReadListeners = new Set<SessionMarkedReadListener>();

export function emitSessionMarkedRead(sessionId: string): void {
  sessionMarkedReadListeners.forEach((listener) => {
    listener(sessionId);
  });
}

export function onSessionMarkedRead(
  listener: SessionMarkedReadListener,
): () => void {
  sessionMarkedReadListeners.add(listener);
  return () => {
    sessionMarkedReadListeners.delete(listener);
  };
}
