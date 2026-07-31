# Fork feature inventory — carry-forward tracking for the v1.37.0 merge

Everything this fork adds on top of upstream `siteboon/claudecodeui`, so nothing is
silently lost when merging upstream v1.37.0.

> **Status: merged.** `merge/v1.37.0` @ `9cb3cd5`. Typecheck clean, lint 0 errors,
> tests 245 pass / 5 fail (the same 5 fail on a pristine v1.37.0 checkout on this
> machine — verified in a throwaway worktree), build green, server boots and serves.
> Everything in §1 and §2 was carried forward except where §4 records a deliberate
> decision to take upstream's version instead.
>
> **Entrypoint changed:** `dist-server/server/cli.js` no longer exists. It is now
> `dist-server/server/modules/cli/cli.js`.
>
> The §5 checklist is still **unverified by hand** — that is the remaining work.

| | |
|---|---|
| Fork point | `d8dfb2c` (upstream `v1.35.1`) |
| Range covered | `a7ba021` … `a03cac9` (28 commits) |
| Branch | `feat/resume-in-cli` |
| Pushed to | `dastonzerg/feat/resume-in-cli` @ `a03cac9` |
| Merging against | upstream `v1.37.0` (`264e094`) — 370 files, +24.6k / −13.6k |

Merge dry-run (`git merge-tree HEAD v1.37.0`): **21 conflicted files**, of which
**2 are modify/delete** and 5 are frontend. Git rename detection maps the old
provider entrypoints onto their new module locations, so most server edits land in
the right file as ordinary content conflicts.

Risk key: **A** = auto-merges, review only · **B** = ordinary conflict, hand-resolve ·
**C** = must be hand-ported or it is lost · **D** = decide whether to drop in favour of upstream

---

## 1. Features

| # | Feature | Commits | Key files | Risk | Verify after merge |
|---|---|---|---|---|---|
| F1 | **Resume session in CLI** — dialog + endpoint emitting the provider's own resume command for the open session | `a7ba021`, `f2a20f1` | `provider.routes.ts`, `sessions.service.ts`, `shell-websocket.service.ts`, `SessionResumeDialog.tsx`, `MainContentHeader.tsx`, `api.js`, `types/app.ts` | **B** | Open a session → Resume in CLI → command is correct and runs |
| F2 | **Unread tab** — cross-project list of sessions that finished a run. State is observed (processing→finished transition), not time-inferred; persisted server-side in `app_config` under one JSON key (no schema change) so it is shared across devices; 60s refetch | `e989fcf` | `projects.routes.ts`, `unread-sessions.service.ts` *(new)*, `useSidebarController.ts`, `Sidebar.tsx`, `SidebarContent.tsx`, `SidebarHeader.tsx`, `api.js` | **B** | Finish a run → session appears under Unread → still there in another browser |
| F3 | **Per-session mark-as-read** — replaced the global "mark all read" with a button in the open chat's header, shown only while that session is unread. `DELETE /api/projects/unread-sessions/:sessionId` | `60a100e`, `c23b111` | `useSessionUnreadStatus.ts` *(new)*, `unreadSessionSync.ts` *(new)*, `MainContentHeader.tsx`, `projects.routes.ts` | **B** | Mark read in chat → row clears in sidebar without manual refresh |
| F4 | **Upload into selected folder** — uploads target the selected folder; clicking an already-selected folder deselects and falls back to project root | `c914158`, `a1e5893` | `useFileTreeUpload.ts`, `FileTree.tsx` | **B** | Select folder → upload lands there; deselect → lands at root |
| F5 | **Mobile long-press file context menu** — bound directly to the row element | `14ab9f9`, `b9550a3`, `7afc781` | `FileContextMenu.tsx` | **A** | Long-press a file row on mobile → menu opens |
| F6 | **Draggable desktop sidebar resize handle** | `0775e59` | `SidebarContent.tsx` | **A** | Drag the sidebar edge |
| F7 | **Live Claude model discovery** — `query(...).supportedModels()` over the SDK control channel with `persistSession: false` (this is what stops the throwaway query registering a phantom project). Executable resolved the same way chat runs resolve it, so the list matches the installed CLI. 30s AbortController timeout, degrades to a static version-free alias list (`opus`, `opus[1m]`, `sonnet`, `haiku`). `claude` moved into the TTL cache, `codex` out of it | `468a614` | `claude-models.provider.ts`, `provider-models.service.ts`, `provider-models.service.test.ts` | **C** | Model list reflects installed CLI; no phantom project appears in the sidebar |
| F8 | **Sign-out button** — `logout` existed in `AuthContext` but was never called from any UI. Placed in the About tab | `a03cac9` | `AboutTab.tsx`, `settings.json` | **B** | Sign out returns to login form |
| F9 | **Abbreviated mobile permission-mode label** — Ask/Auto/Edits/Bypass/Plan instead of a bare colour dot | `468a614` | `ChatComposer.tsx` | **B** | Narrow viewport shows the word, not a dot |
| F10 | **Session conversation search** (work in progress on this branch) | `468a614` | `session-conversations-search.service.ts` + test | **B** | — |

---

## 2. Fixes

| # | Fix | Commits | Key files | Risk | Verify after merge |
|---|---|---|---|---|---|
| X1 | **Codex context usage per request, not per session** — `total_token_usage` accumulates across every turn and runs far past the window, pinning the indicator at 0% permanently. Prefer `last_token_usage`, fall back only for older transcripts. Fixed in all **three** independent places: REST endpoint, live websocket, session loader. Real case: 903,594/258,400 → 46,147/258,400 | `737360b`, `2ee3b09` | `server/index.js` ⚠, `openai-codex.js`, `codex-sessions.provider.ts` | **C** | Open a long Codex session → % left is sane, stays sane after a run and after reload |
| X2 | **Claude context window resolution / "0% left" mid-turn** — `message.model` has the `[1m]` marker stripped, so a 1M run resolved to a 200k window. Resolve from the model *selection* (`/model` line in transcript, else saved global default, trusted only when the family matches), and treat usage above the resolved window as proof of the larger one | `468a614` | `server/index.js` ⚠, `claude-context-window.ts` *(new, no upstream equivalent)*, `claude-models.provider.ts` | **C** | 1M-context Claude session reports a 1M window, not 200k |
| X3 | **Base64 image blobs in tool results** — Codex `view_image` and Claude `Read` embed the file as a base64 data URL in `tool_result`; one photo produced a 928KB JSON line, re-parsed and stringified on every history fetch, reproducibly hanging the tab. Replaced server-side with an `[image #1]` placeholder. Side effect: text-only tool results render as plain text instead of stringified arrays | `3e30cbe` | `claude-sessions.provider.ts`, `codex-sessions.provider.ts` | **B** | Open a session containing a read image → loads fast, shows placeholder |
| X4 | **Expired-token recovery** — token expires after 7 days; auto-refresh only rolls it forward on a still-valid request, so a PWA or phone left resident crosses expiry and holds a dead token. Nothing recovered: every call 403'd while the UI still believed it was signed in, and the only escape was clearing site data (losing theme, sort order, permission modes). Now `authenticatedFetch` drops the token and emits `auth:unauthorized` on 401/403 **only when a token was actually sent**; `AuthContext` listens and clears the session | `a03cac9` | `AuthContext.tsx`, `api.js` | **B ⚠** | Overlaps upstream `432b3ff`. See §4 |
| X5 | **GPU burn from infinite CSS animations** — an infinite animation keeps the compositor producing frames at refresh rate; on a hybrid-GPU high-refresh machine each frame costs a cross-adapter blit, holding the GPU process at ~35% copy-engine (vs ~2% idle) for as long as a session ran. Established by A/B/A measurement. `steps()` throttling does not help — Chromium composites every frame regardless. Added finite `pulse-brief`, made shimmer finite (3 iterations), converted 9 infinite badges, replaced spinners with static indicators | `468a614` | `tailwind.config.js`, `ActivityIndicator.tsx`, `BashCommandDisplay.tsx`, `SubagentContainer.tsx`, `SidebarCollapsed.tsx`, `SidebarFooter.tsx`, `SidebarSessionItem.tsx`, `AppContent.tsx`, `MainContent*.tsx`, `Queue.tsx` | **B** | Run a session, watch GPU copy engine — must not sit at ~35% |
| X6 | **Theme flash on mobile** — `ThemeContext` sets the `dark` class from an effect that only runs after a 2.7MB bundle parses, so first paint used the light palette and the global 200ms transition turned the correction into a visible fade through grey. Blocking head script now resolves theme (saved preference → `prefers-color-scheme`) before first paint and corrects `theme-color` / iOS status bar meta tags | `c0906cf` | `index.html` | **A** | Hard refresh on mobile in dark mode → no white flash |
| X7 | **Escape pass corrupting code blocks** — `unescapeWithMathProtection` protected LaTeX but not code, so `bin\tokensave.EXE` in a code block had its `\t` eaten and rendered as a real tab. Protect fenced and inline code with the same placeholder technique | `4e9927c` | `chatFormatting.ts` | **A** | Windows paths in code blocks survive intact |
| X8 | **Chat snapping to bottom mid-scroll** — auto-follow keyed on `isUserScrolledUp`, which flips purely off scroll position, so scrolling *down* toward the bottom re-triggered the effect and force-snapped, fighting the gesture. Gate on message count actually growing | `b22d919` | `useChatSessionState.ts` | **A** | Scroll down manually → no snap |
| X9 | **Scroll-triggered history fetch → explicit "Load more"** — auto-fetch at a scroll threshold landed the scroll-restore compensation mid-gesture, reading as page shake on mobile | `f45e683` | `useChatSessionState.ts`, `ChatInterface.tsx`, `ChatMessagesPane.tsx`, `chat.json` | **B** | Scroll to top of history on mobile → no shake, button appears |
| X10 | **"Load all messages" shifting the viewport** — it faded in/out on its own 2500ms timer, mounting independently of list height changes. Now rendered in the same persistent block as Load more | `2bd0ca4` | `LoadAllMessagesOverlay.tsx`, `ChatMessagesPane.tsx` | **B** | Button appears/disappears without moving content |
| X11 | **Message blocks resizing while scrolling** — `.chat-message` had `content-visibility: auto` with a flat `contain-intrinsic-size` guess, so blocks snapped to real height on approach. Dropped `content-visibility`, kept the harmless containment (list is already windowed by pagination) | `556eb75` | `src/index.css` | **A** | Scroll old history → no growing blocks |
| X12 | **Mobile rename cancelling on tap** — outside-click-cancel tracked only the desktop panel ref, so every tap on the mobile input read as "outside". Also `active:scale` on the row suppressed iOS's text-selection callout during long-press | `6d2f2bb` | `SidebarSessionItem.tsx`, `SidebarProjectItem.tsx`, `SidebarMobileTitleEditing.test.js`, `index.css` | **B ⚠** | Overlaps upstream. See §4 |
| X13 | **New projects sinking to the bottom** — `getProjectLastActivity` used the epoch as the sort key for projects with no sessions. Treat "no sessions yet" as newest. Deliberately reverted an earlier `created_at` column/migration fix (`38316c5`) as over-engineered and requiring a restart | `853186a` | `sidebar/utils/utils.ts` | **A** | Create a project → appears at top |
| X14 | **Permission mode reverting to Default** — the mode is persisted keyed by session id, but there is no session id on the empty-state composer, so once the session was established the read-back found nothing and reset to `default`. The first message went out correctly; every message after it silently ran in Default | `ab21918` | `ChatInterface.tsx` | **B** | Pick a mode before first message → still set on message 2 |
| X15 | **`/models` popup ignoring the picked model** — `resolveCommandModel` could not distinguish "found a real value" from "silently defaulted". Affected `/models`, `/cost`, `/status` displays only; real generations were always correct | `c4184b9` | `server/routes/commands.js` → upstream `commands.routes.ts` | **D** | See §4 |
| X16 | **Model override resolved by app session id** — the override was resolved against the provider-native id, which rotates independently of the stable app session id, so lookups missed. Active-model badge had the same class of bug | `7b630f8` | `claude-models.provider.ts`, `chat-websocket.service.ts`, `claude-sdk.js`, `openai-codex.js`, `opencode-cli.js`, `cursor-cli.js`, `gemini-cli.js` | **D** | See §4 |
| X17 | **Comment correction** — a comment in `claude-sdk.js` claimed interactive tools cannot reach the UI in auto/bypass modes. Verified false against `claude-agent-sdk` 0.3.165 | `468a614` | `claude-sdk.js` → `claude-runtime.provider.js` | **A** | — |

---

## 3. ⚠ The one that will be lost silently

`server/index.js` conflicts as **modify/delete**: upstream dissolved its 1,651 lines
into `server/modules/`, and git resolves that by *leaving our version in the tree*.

Running `git add .` therefore produces a dead `server/index.js` sitting beside
upstream's `index.ts`, holding the **only copy of X1 and X2**, wired to nothing and
looking committed. The regression is invisible until someone notices the context
percentage is wrong again.

**Upstream did not fix these.** Their new `server/modules/providers/services/provider-token-usage.service.ts`
relocated the old code unchanged — verified: 0 occurrences of `last_token_usage`,
Claude path still hardcodes `160_000`, no per-model window resolution, no 1M detection.
X1 and X2 are **not** redundant.

Required steps:

- [ ] Port the 46 changed lines of `server/index.js` into `provider-token-usage.service.ts`
- [ ] Carry `server/shared/claude-context-window.ts` over as a new file (no upstream equivalent)
- [ ] Carry the three helpers — `getClaudeSelectedModelFromLines`, `getClaudeConfiguredDefaultModel`, `getClaudeModelFamily` (0 occurrences upstream)
- [ ] `git rm server/index.js` only after the above is done
- [ ] Re-verify X1 and X2 by hand

Reference diff: `git diff d8dfb2c..a03cac9 -- server/index.js`

---

## 4. Decisions to make before merging

| Item | Situation | Decision taken |
|---|---|---|
| **X15 + X16** (model override) | Upstream added a real `sessions.model` column and **deleted** the sidecar our fix built on | **Dropped ours, took upstream.** Their `resolveSessionModel` prefers the session's recorded model and falls back to the composer's current pick — same semantics as X15, backed by the DB column |
| **X4** (expired token) | Collides with upstream `432b3ff`; both touch `AuthContext.tsx` and `api.js` | **Merged into one mechanism.** Dropped our `auth:unauthorized` event; `authenticatedFetch` now calls upstream's `expireAuthSession()` on a 401/403 that carried a token. Ours is still broader than upstream's header-only `X-Auth-Error` check. Sign-out button (F8) kept |
| **X12** (mobile rename) | Upstream shipped its own mobile rename fix | **Kept ours.** Ours also tracks the mobile container ref separately and disables `active:scale`; upstream's did not cover the iOS callout half |
| **F7 caching policy** | Upstream sets `UNCACHED_PROVIDERS = ['claude']`; our F7 inverted it | **Kept ours** (`['codex']`). Our Claude catalog comes from a live SDK query that spawns a subprocess, so it must stay cached. Upstream's two caching tests were rewritten to assert this — revisit if the live query is ever removed |
| **F9 mobile label** | Upstream replaced the inline permission button with an icon-only `ComposerPermissionMenu` | **Re-applied to the new component** — short label shows below the `sm` breakpoint |
| **X3 image placeholder** | Upstream's new `extractCodexToolOutput` drops non-text parts, avoiding the crash but losing the marker | **Composed both** — sanitize first so images become `[image #N]`, then extract |
| **`server/gemini-cli.js`** | Gemini deleted upstream | **Deleted.** Also removed the now-dead gemini branches in `buildProviderShellCommand`, `shell-websocket.service.ts` and `SessionResumeDialog.tsx` |
| **Gemini overall** | v1.37.0 removes the provider entirely | **Confirmed unused** — not a regression for us |
| **`npm test` script** | Upstream's new script does not point tsx at `server/tsconfig.json`, so every `@/` import fails (49 of 76 tests) | **Fixed** via `cross-env TSX_TSCONFIG_PATH=server/tsconfig.json`. Worth reporting upstream |

---

## 5. Post-merge verification checklist

Run `npm test` first — upstream added a real suite we inherit as a safety net.

- [ ] Codex: long session shows sane % left — on open, during a run, **and after reload** (X1 — three code paths)
- [ ] Claude: 1M-context session reports a 1M window (X2)
- [ ] Model list reflects installed CLI; no phantom project registered (F7)
- [ ] Session with a read image loads fast, shows `[image #1]` (X3)
- [ ] GPU copy engine does not sit at ~35% during a run (X5)
- [ ] Unread tab populates and persists across devices (F2, F3)
- [ ] Resume in CLI emits the right command (F1)
- [ ] Permission mode survives the first message (X14)
- [ ] Mobile: no theme flash, no scroll shake, long-press menu works, rename does not cancel (X6, X9, F5, X12)
- [ ] Expired token → login form, not a wall of 403s (X4)
- [ ] Upload into selected folder, and to root when deselected (F4)
