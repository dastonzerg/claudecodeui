import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A resource-level 403 (for example the file-tree service refusing a path
 * outside the project root) must not be mistaken for a rejected token. The
 * auth middleware always answers 401 and sets `X-Auth-Error`, so anything
 * else is an ordinary application error.
 */
describe('authenticatedFetch auth-failure detection', () => {
  const store = new Map<string, string>();
  let dispatched: string[];

  beforeEach(() => {
    store.clear();
    dispatched = [];
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    });
    vi.stubGlobal('window', {
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: (event: Event) => {
        dispatched.push(event.type);
        return true;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const respond = (status: number, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify({ error: 'nope' }), { status, headers });

  const runWithStoredToken = async (response: Response) => {
    // A syntactically valid, far-future JWT so the stored token is accepted.
    const payload = btoa(JSON.stringify({ iat: 1, exp: 4_000_000_000 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    store.set('auth-token', `header.${payload}.signature`);

    const { authenticatedFetch } = await import('./api.js');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await authenticatedFetch('/api/some/resource');
    return store.has('auth-token');
  };

  it('keeps the session when a resource returns 403 without X-Auth-Error', async () => {
    expect(await runWithStoredToken(respond(403))).toBe(true);
    expect(dispatched).not.toContain('auth-session-expired');
  });

  it('clears the session when the auth middleware returns 401', async () => {
    expect(
      await runWithStoredToken(respond(401, { 'X-Auth-Error': 'invalid-token' })),
    ).toBe(false);
    expect(dispatched).toContain('auth-session-expired');
  });
});
