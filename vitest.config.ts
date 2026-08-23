import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Client-side unit tests only. Server tests run under `node --test` via
// `npm test`; the two runners stay separate because the server relies on
// tsx path aliases and better-sqlite3 native bindings.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // These are written against node:test + node:assert, not Vitest, and are
    // out of scope for this plan. Under Vitest they fail with
    // "No test suite found" because they import Node's real `test` function
    // outside a `node --test` context.
    exclude: [
      'src/utils/unreadSessionSync.test.ts',
      'src/stores/sessionMessageReconciliation.test.ts',
      'src/components/git-panel/utils/commitGraph.test.ts',
    ],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
