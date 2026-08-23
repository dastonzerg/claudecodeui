# Message Bookmarks — Design

**Date:** 2026-08-22
**Status:** Approved, ready for implementation planning

## Problem

Long chat sessions have no way to mark a message and come back to it. Users
scroll to find the prompt where they described a requirement, or the response
that contained the answer. Bookmarks must survive a reload and be visible on
another device, so they have to live in the database rather than in
`localStorage`.

## Scope

- Pin any **user prompt** or **assistant text response**. Tool-use and
  tool-result blocks are not pinnable.
- Bookmarks belong to a **session** and are rendered on a rail at the right
  edge of the chat scroll viewport.
- A **global list** in the sidebar shows every bookmark across sessions and
  jumps into the target session.
- Bookmarks are labeled with an auto-captured snippet and can be renamed.

Out of scope: sharing bookmarks between users, folders/tags, exporting
bookmarks, and pinning tool blocks.

## The anchoring problem

A bookmark must point at a message that survives reload and travels to another
device.

History messages carry a stable id derived from the provider JSONL `uuid`
(`server/modules/providers/list/claude/claude-sessions.provider.ts:386`, and
the equivalent in the Codex provider). That id is regenerated identically every
time the transcript is re-read from disk, so it is a durable anchor.

A message pinned **while it is streaming live** is different: its id comes from
`generateMessageId` (`server/shared/utils.ts:327`), which is a fresh random
UUID. After a reload the same message returns from the JSONL with a different
id, and an id-only bookmark would dangle.

Additionally, `normalizedToChatMessages` currently drops `msg.id` when it builds
`sharedMetadata` (`src/components/chat/hooks/useChatMessages.ts:83-91`), so the
UI never sees the provider id at all today.

### Chosen approach: provider id primary, content fingerprint fallback

Store the provider `message_id` **plus** `message_timestamp` and an 80-character
`snippet` captured at pin time. Resolve by id; fall back to
nearest-timestamp-corroborated-by-snippet; rewrite the stored id on a successful
fallback so the bookmark self-heals after the first reload.

Approaches rejected:

- **Content fingerprint only** (timestamp + snippet hash, no id). Uniform, but
  breaks on repeated identical messages such as "continue" or "yes", and on any
  change to content normalization. The id is available and free.
- **Ordinal index** ("message #47"). Trivial to compute and immediately wrong
  after a history compaction, a session resume, or a change in which messages a
  normalizer filters out.

## Data model

New table, added to `server/modules/database/schema.ts` as a
`CREATE TABLE IF NOT EXISTS` and re-run from `migrations.ts` for existing
installs, matching how every other table in this codebase is introduced.

```sql
CREATE TABLE IF NOT EXISTS message_bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL,
    project_path TEXT,               -- denormalized so the global list can render
    message_id TEXT,                 -- provider id; stale until fallback self-heals it
    message_timestamp TEXT NOT NULL, -- fallback anchor 1
    snippet TEXT NOT NULL,           -- fallback anchor 2, also the default label
    label TEXT,                      -- user rename; NULL means "show snippet"
    message_type TEXT NOT NULL,      -- 'user' | 'assistant'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, session_id, message_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_bookmarks_user_session
  ON message_bookmarks(user_id, session_id);
```

There is deliberately **no foreign key to `sessions`**. A session id can be
rewritten mid-run when the provider announces its own id (see
`provider_session_id` in `SESSIONS_TABLE_SCHEMA_SQL`), and a hard FK would
reject inserts during that window.

`UNIQUE(user_id, session_id, message_id)` prevents double-pinning the same
message. SQLite treats NULLs as distinct in a UNIQUE constraint, so rows whose
`message_id` has not yet been resolved do not collide with each other; the
service layer rejects a duplicate pin of an already-pinned message by checking
before insert.

## Server

**Repository:** `server/modules/database/repositories/message-bookmarks.db.ts`,
exported from `server/modules/database/index.ts` as `messageBookmarksDb`.
Same shape as `appConfigDb`.

| Method | Purpose |
|---|---|
| `listForSession(userId, sessionId)` | session's bookmarks, ordered by `message_timestamp` |
| `listAllForUser(userId)` | every bookmark, newest `created_at` first |
| `create(userId, input)` | insert a pin |
| `rename(userId, id, label)` | set/clear the user label |
| `remove(userId, id)` | unpin |
| `updateMessageId(userId, id, messageId)` | the self-heal write |

Every method takes `userId` and includes it in the `WHERE` clause, so ownership
is enforced at the query, not only at the route.

**Module:** `server/modules/bookmarks/` containing `index.ts`,
`bookmarks.module.ts`, `bookmarks.routes.ts`, and `bookmarks.service.ts`,
mirroring `server/modules/settings/`. Mounted in `server/index.ts`:

```ts
app.use('/api/bookmarks', authenticateToken, bookmarksRoutes);
```

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/bookmarks?sessionId=…` | session's bookmarks |
| `GET` | `/api/bookmarks` | all of the user's bookmarks, for the global list |
| `POST` | `/api/bookmarks` | pin |
| `PATCH` | `/api/bookmarks/:id` | rename (`{ label }`) |
| `PATCH` | `/api/bookmarks/:id/anchor` | self-heal (`{ messageId }`) |
| `DELETE` | `/api/bookmarks/:id` | unpin |

Routes are thin transport wrappers around the service and read the user via
`userId(req)`, exactly as `settings.routes.ts` does.

## Client

### Message id plumbing

Add `id: msg.id` to the `sharedMetadata` object in
`src/components/chat/hooks/useChatMessages.ts` so `ChatMessage` carries the
provider id. Side benefit: `getIntrinsicMessageKey` already prefers
`message.id` (`src/components/chat/utils/messageKeys.ts:16`), so React list keys
become more stable as well.

### Anchor resolution

`src/components/chat/utils/bookmarkAnchors.ts` exports a pure
`resolveBookmarkTarget(bookmark, messages)`:

1. Match `message.id === bookmark.message_id`. Exact; the normal path.
2. Otherwise find the message whose timestamp is nearest
   `bookmark.message_timestamp` **and** whose text contains `bookmark.snippet`.
   This is the fallback chain the search-jump already uses at
   `src/components/chat/hooks/useChatSessionState.ts:640-660`, tightened:
   search accepts a timestamp-only match, bookmarks require the snippet to
   corroborate, because a wrong jump is worse than a failed one.
3. On a step-2 hit, the caller (`useBookmarks`) fires
   `PATCH /api/bookmarks/:id/anchor` with the real id, so step 2 runs at most
   once per bookmark. The resolver itself stays pure: it returns
   `{ message, viaFallback }` and performs no I/O, which is what makes it
   directly unit-testable.
4. No match: the marker stays in the unresolved cluster at the top of the rail
   and the entry is greyed in the global list. Nothing is auto-deleted — a
   stale bookmark is the user's to remove.

### State

A `useBookmarks(sessionId)` hook owned by `ChatInterface`, mirroring how it
already owns `useSessionStore`. Exposed through a `BookmarkContext.Provider`
alongside the existing `PermissionContext.Provider`
(`src/components/chat/view/ChatInterface.tsx:339`), because `MessageComponent`
renders both directly from `ChatMessagesPane` and nested inside
`ToolGroupContainer` — context avoids drilling the same props down two paths.

Pin/unpin writes optimistically and reconciles against the response.

The sidebar's global list fetches `GET /api/bookmarks` independently and needs
no shared state.

### Pin control

`MessagePinControl.tsx`, placed in the two footer rows that already render
persistently: the user bubble's metadata row
(`src/components/chat/view/subcomponents/MessageComponent.tsx:131`) and the
assistant control row (`:405`). Always visible, not hover-gated, so it behaves
identically on touch and desktop, and it consumes no new vertical space.
Filled icon when pinned, outline when not. Rendered only for `user` and
`assistant` messages with non-empty text.

### Bookmark rail

`BookmarkRail.tsx`, absolutely positioned at the right edge of the scroll
viewport. Requires one markup change in `ChatMessagesPane.tsx`: wrap the
existing scroll div in a `relative flex min-h-0 flex-1` parent so the rail is a
**sibling** of the scrolling element rather than a child of it — a child would
scroll away with the content. `scrollContainerRef` continues to point at the
scrolling div.

Marker position uses the standard minimap mapping against
`data-bookmark-id` attributes on the bubbles:

```
top% = (el.offsetTop + el.clientHeight / 2) / container.scrollHeight
```

This is scroll-independent, so positions recompute only when the message list
changes or the container resizes (`ResizeObserver`), never per scroll frame.

Bookmarks whose message is not currently loaded stack in a cluster at the top of
the rail; clicking one triggers load-all, then jumps. This follows the decision
to position markers by the scroll offset of loaded messages only, rather than by
index in the full session.

Hover or tap shows the label or snippet; click scrolls to the message and
applies the existing 4-second `search-highlight-flash`. **No pulsing or
infinite CSS animation on markers** — infinite animations are measurably
expensive on the target hardware, and the finite flash is sufficient.

The rail sits at `right-0`. The existing export menu is `sticky right-4 top-3`
(`src/components/chat/view/subcomponents/ChatMessagesPane.tsx:165`) and is
nudged clear if the two overlap in practice.

### Global list

A bookmarks panel in the sidebar, next to the existing search. It reuses the
search's cross-session navigation verbatim: `Sidebar.tsx:277-295` already builds
`{ __searchTargetTimestamp, __searchTargetSnippet }`, selects the project, and
calls `handleSessionClick` to land on a specific message in another session.
Feeding that path with the bookmark's stored timestamp and snippet means
cross-session jumping needs no new navigation machinery and works on mobile,
because the sidebar already does.

Rename is inline, both in the rail tooltip and in the global list.

## Testing

`npm test` runs `node --test` over `server/**/*.test.ts` only
(`package.json:49`); there is no frontend runner today.

**Server (existing `node --test` setup):**

- `server/modules/database/tests/message-bookmarks.db.integration.test.ts` —
  CRUD, the duplicate-pin path, cascade delete when a user is removed, and that
  `listForSession` orders by `message_timestamp`. Follows
  `sessions.db.integration.test.ts`.
- `server/modules/bookmarks/tests/bookmarks.service.test.ts` — user scoping:
  user B cannot read, rename, or delete user A's bookmark.

**Frontend (new):** wire up Vitest for `src/` with a `test:ui` script and a
config file under a `test:client` script (not `test:ui`, which reads as
Vitest's own `--ui` flag), and write one focused spec for
`resolveBookmarkTarget` covering the
id hit, the snippet-corroborated fallback, the ambiguous-timestamp case where
the snippet disqualifies the nearest message, and the no-match case. This also
gives the currently-unrun `QuestionAnswerContent.test.tsx` a home.

**Manual verification:**

1. Pin and unpin on a desktop viewport and on a narrow viewport.
2. Jump to a bookmark whose message has not been loaded yet.
3. Pin a message while it is still streaming, reload, and confirm the anchor
   self-healed rather than dangling.
4. Cross-session jump from the sidebar global list.
5. `npm run typecheck` and `npm run lint` clean.

## Risks

- **Fallback resolution mismatches.** Mitigated by requiring both timestamp
  proximity and snippet containment, and by never auto-deleting a bookmark that
  fails to resolve.
- **Rail positions drift on long sessions** while earlier messages load, since
  `scrollHeight` changes. Recomputation on `ResizeObserver` and on message-list
  change covers this.
- **Snippet capture on a streaming message** may catch partial text if the user
  pins mid-stream. The snippet is captured from the message content at click
  time; a partial snippet still matches by `includes` against the final text, so
  fallback resolution remains valid.
