# Chat Viewport Controller Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat viewport move only when the reader asks it to, by replacing six independent `scrollTop` writers with one layout effect holding a `following`/`anchored` mode.

**Architecture:** A new `useChatViewport` hook owns the scroll container and is the only code that assigns `scrollTop`. One `useLayoutEffect` with no dependency array runs after every commit, before paint, and applies the current mode — pin to bottom, or hold a chosen element at a fixed offset from the top of the viewport. All scroll-position arithmetic lives in a pure `viewportMath` module so it can be unit-tested without a DOM.

**Tech Stack:** React 18 hooks, TypeScript, Vitest (`environment: 'node'`, no jsdom), Tailwind.

**Spec:** `docs/superpowers/specs/2026-09-05-chat-viewport-controller-design.md`

## Global Constraints

- Behaviour contract: **returning to the app never moves the reader.** If they were mid-transcript they stay; if parked at the bottom they stay and following resumes.
- `useChatViewport` must be the **only** code that assigns `container.scrollTop`. No `setTimeout`-based scrolling anywhere.
- Corrections run in `useLayoutEffect` (pre-paint), never in `useEffect` or a timer.
- Anchored arithmetic must never read `clientHeight` as a distance-from-bottom, so an iOS toolbar resize cannot perturb it.
- This repo has **no jsdom**; `vitest.config.ts` sets `environment: 'node'`. Only pure functions get unit tests. React wiring is verified manually.
- Line endings: source files are CRLF in the working tree (`core.autocrlf=true`). Write CRLF or `git add` warns and lint-staged's backup step fails with `fatal: Needed a single revision`.
- Commit messages follow conventional-commits (commitlint is a `commit-msg` hook).
- Every commit must pass `npm run typecheck`, `npx eslint <changed files>`, and `npx vitest run`.

---

## File Structure

| file | responsibility |
| --- | --- |
| `src/components/chat/utils/viewportMath.ts` | new. Pure scroll arithmetic and mode decisions. No DOM. |
| `src/components/chat/utils/viewportMath.test.ts` | new. Vitest coverage for the above. |
| `src/components/chat/hooks/useChatViewport.ts` | new. The controller: owns the container ref, the mode, and the single layout effect. |
| `src/components/chat/hooks/useChatSessionState.ts` | modify. Delete four scroll writers; consume the controller. |
| `src/components/chat/hooks/useChatComposerState.ts` | modify. Send calls `follow()` instead of a timeout. |
| `src/components/chat/view/subcomponents/BookmarkRail.tsx` | modify. Jump via `anchorTo`. |
| `src/components/chat/view/ChatInterface.tsx` | modify. Pass the controller down; drop `onWheel`/`onTouchMove` plumbing. |

---

### Task 1: Pure viewport arithmetic

**Files:**
- Create: `src/components/chat/utils/viewportMath.ts`
- Test: `src/components/chat/utils/viewportMath.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `type ViewportMode = 'following' | 'anchored'`; `type ViewportMetrics = { scrollTop: number; scrollHeight: number; clientHeight: number }`; `BOTTOM_THRESHOLD_PX: number`; `isAtBottom(m: ViewportMetrics): boolean`; `followingScrollTop(m: ViewportMetrics): number`; `anchoredScrollTop(anchorTop: number, viewportOffset: number, m: ViewportMetrics): number`; `shouldRepickAnchor(viewportOffset: number, clientHeight: number): boolean`; `isLayoutInducedScroll(previousClientHeight: number, clientHeight: number): boolean`; `nextMode(m: ViewportMetrics, layoutInduced: boolean, current: ViewportMode): ViewportMode`.

- [ ] **Step 1: Write the failing test**

Create `src/components/chat/utils/viewportMath.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  anchoredScrollTop,
  followingScrollTop,
  isAtBottom,
  isLayoutInducedScroll,
  nextMode,
  shouldRepickAnchor,
} from './viewportMath';

const metrics = (scrollTop: number, scrollHeight = 10_000, clientHeight = 800) =>
  ({ scrollTop, scrollHeight, clientHeight });

describe('followingScrollTop', () => {
  it('returns the clamped bottom rather than scrollHeight', () => {
    expect(followingScrollTop(metrics(0))).toBe(9_200);
  });

  it('never returns a negative offset when content is shorter than the viewport', () => {
    expect(followingScrollTop(metrics(0, 300, 800))).toBe(0);
  });
});

describe('isAtBottom', () => {
  it('is true exactly at the bottom', () => {
    expect(isAtBottom(metrics(9_200))).toBe(true);
  });

  it('tolerates a small gap so sub-pixel rounding does not unpark the reader', () => {
    expect(isAtBottom(metrics(9_150))).toBe(true);
  });

  it('is false once the reader has genuinely scrolled up', () => {
    expect(isAtBottom(metrics(4_000))).toBe(false);
  });
});

describe('anchoredScrollTop', () => {
  it('keeps the anchor at the same offset from the top of the viewport', () => {
    // Anchor sat 300px below the viewport top; after content grew above it,
    // the anchor now starts at 5_400 instead of 5_000.
    expect(anchoredScrollTop(5_400, 300, metrics(4_700))).toBe(5_100);
  });

  it('clamps to the top', () => {
    expect(anchoredScrollTop(100, 300, metrics(0))).toBe(0);
  });

  it('clamps to the bottom', () => {
    expect(anchoredScrollTop(9_900, 0, metrics(0))).toBe(9_200);
  });
});

describe('shouldRepickAnchor', () => {
  it('keeps an anchor inside the viewport', () => {
    expect(shouldRepickAnchor(400, 800)).toBe(false);
  });

  it('keeps an anchor just above the viewport', () => {
    expect(shouldRepickAnchor(-400, 800)).toBe(false);
  });

  it('drops an anchor that has drifted far above', () => {
    expect(shouldRepickAnchor(-1_600, 800)).toBe(true);
  });

  it('drops an anchor that has drifted far below', () => {
    expect(shouldRepickAnchor(2_400, 800)).toBe(true);
  });
});

describe('isLayoutInducedScroll', () => {
  it('is true when the viewport height changed between events', () => {
    expect(isLayoutInducedScroll(800, 720)).toBe(true);
  });

  it('is false when the height held steady', () => {
    expect(isLayoutInducedScroll(800, 800)).toBe(false);
  });

  it('is false on the first event, when no previous height is known', () => {
    expect(isLayoutInducedScroll(0, 800)).toBe(false);
  });
});

describe('nextMode', () => {
  it('arms following when the reader reaches the bottom', () => {
    expect(nextMode(metrics(9_200), false, 'anchored')).toBe('following');
  });

  it('anchors when the reader scrolls away from the bottom', () => {
    expect(nextMode(metrics(4_000), false, 'following')).toBe('anchored');
  });

  it('leaves the mode alone when the scroll came from a viewport resize', () => {
    // An iOS toolbar hiding shrinks clientHeight and can land the reader
    // within the bottom threshold without them having moved.
    expect(nextMode(metrics(9_200), true, 'anchored')).toBe('anchored');
    expect(nextMode(metrics(4_000), true, 'following')).toBe('following');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/chat/utils/viewportMath.test.ts`
Expected: FAIL — `Failed to resolve import "./viewportMath"`.

- [ ] **Step 3: Write the implementation**

Create `src/components/chat/utils/viewportMath.ts`:

```ts
/**
 * Scroll arithmetic for the chat viewport, kept free of the DOM so it can be
 * tested — this project has no jsdom, and these are the decisions most likely
 * to hide an off-by-one.
 */

export type ViewportMode = 'following' | 'anchored';

export type ViewportMetrics = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/**
 * Distance from the bottom at or under which the reader counts as parked
 * there. Generous enough to absorb sub-pixel rounding and a fractional device
 * pixel ratio, which would otherwise unpark a reader who never moved.
 */
export const BOTTOM_THRESHOLD_PX = 64;

/**
 * How far outside the viewport an anchor may drift before a nearer element is
 * chosen, in multiples of the viewport height. Re-picking is a DOM sweep, so
 * it should be rare; holding a wildly offscreen anchor costs nothing until it
 * is unmounted.
 */
const ANCHOR_DRIFT_VIEWPORTS = 1;

const maxScrollTop = (metrics: ViewportMetrics): number =>
  Math.max(0, metrics.scrollHeight - metrics.clientHeight);

export function isAtBottom(metrics: ViewportMetrics): boolean {
  return maxScrollTop(metrics) - metrics.scrollTop <= BOTTOM_THRESHOLD_PX;
}

/**
 * The clamped bottom, not `scrollHeight`. Assigning `scrollHeight` relies on
 * the browser clamping it, which makes the value we wrote differ from the one
 * we read back and defeats the "did this change anything" check.
 */
export function followingScrollTop(metrics: ViewportMetrics): number {
  return maxScrollTop(metrics);
}

/** The offset that keeps `anchorTop` sitting `viewportOffset` below the top. */
export function anchoredScrollTop(
  anchorTop: number,
  viewportOffset: number,
  metrics: ViewportMetrics,
): number {
  return Math.min(Math.max(0, anchorTop - viewportOffset), maxScrollTop(metrics));
}

export function shouldRepickAnchor(viewportOffset: number, clientHeight: number): boolean {
  const slack = clientHeight * ANCHOR_DRIFT_VIEWPORTS;
  return viewportOffset < -slack || viewportOffset > clientHeight + slack;
}

/**
 * A scroll event arriving in the same breath as a viewport height change is
 * the layout moving, not the reader. iOS Safari's dynamic toolbar does this on
 * every hide and show.
 */
export function isLayoutInducedScroll(previousClientHeight: number, clientHeight: number): boolean {
  return previousClientHeight !== 0 && previousClientHeight !== clientHeight;
}

export function nextMode(
  metrics: ViewportMetrics,
  layoutInduced: boolean,
  current: ViewportMode,
): ViewportMode {
  if (layoutInduced) {
    return current;
  }
  return isAtBottom(metrics) ? 'following' : 'anchored';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/chat/utils/viewportMath.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Normalise line endings, lint, typecheck**

```bash
node -e "const fs=require('fs');for(const f of ['src/components/chat/utils/viewportMath.ts','src/components/chat/utils/viewportMath.test.ts']){const s=fs.readFileSync(f,'latin1');fs.writeFileSync(f,s.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'),'latin1');}"
npx eslint src/components/chat/utils/viewportMath.ts src/components/chat/utils/viewportMath.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/components/chat/utils/viewportMath.ts src/components/chat/utils/viewportMath.test.ts
git commit -m "feat: add pure scroll arithmetic for the chat viewport"
```

---

### Task 2: The controller hook

**Files:**
- Create: `src/components/chat/hooks/useChatViewport.ts`

**Interfaces:**
- Consumes: everything exported by `viewportMath.ts` in Task 1.
- Produces: `useChatViewport(sessionId: string | null): ChatViewport` where
  `ChatViewport = { containerRef: RefObject<HTMLDivElement>; isUserScrolledUp: boolean; follow: () => void; anchorTo: (element: HTMLElement, offsetPx?: number) => void }`.

The hook is written but not yet consumed, so this task is verified by typecheck and build rather than behaviour. That keeps Task 3's diff readable.

- [ ] **Step 1: Write the hook**

Create `src/components/chat/hooks/useChatViewport.ts`:

```ts
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';

import {
  anchoredScrollTop,
  followingScrollTop,
  isLayoutInducedScroll,
  nextMode,
  shouldRepickAnchor,
  type ViewportMetrics,
  type ViewportMode,
} from '../utils/viewportMath';

/** Every message bubble and tool group carries this class. */
const MESSAGE_SELECTOR = '.chat-message';

export type ChatViewport = {
  containerRef: RefObject<HTMLDivElement>;
  /** True while the reader is holding a position rather than following. */
  isUserScrolledUp: boolean;
  /** Pin to the newest content and keep following it. */
  follow: () => void;
  /** Hold `element` at `offsetPx` from the top of the viewport. */
  anchorTo: (element: HTMLElement, offsetPx?: number) => void;
};

const readMetrics = (container: HTMLElement): ViewportMetrics => ({
  scrollTop: container.scrollTop,
  scrollHeight: container.scrollHeight,
  clientHeight: container.clientHeight,
});

/**
 * The only writer of the chat container's `scrollTop`.
 *
 * Six separate writers used to move the viewport, three of them on timers that
 * landed after paint, so each correction was a visible jump and they could
 * overlap. This holds one mode instead: pin to the bottom, or keep one element
 * visually still. Prepend-restore, load-all restore, reflow compensation,
 * remount recovery and return-from-background are then the same operation.
 *
 * Applying the mode is idempotent and runs pre-paint, so overlapping commits
 * cannot fight and nothing is visible mid-correction.
 */
export function useChatViewport(sessionId: string | null): ChatViewport {
  const containerRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<ViewportMode>('following');
  const anchorElementRef = useRef<HTMLElement | null>(null);
  const viewportOffsetRef = useRef(0);
  const previousClientHeightRef = useRef(0);
  /** Set immediately before we assign scrollTop, so the resulting scroll event
   *  is not mistaken for the reader moving. */
  const selfWriteRef = useRef(false);
  const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);

  const pickAnchor = useCallback((container: HTMLDivElement) => {
    const elements = container.querySelectorAll<HTMLElement>(MESSAGE_SELECTOR);
    for (const element of elements) {
      // The first message whose bottom edge is still below the viewport top.
      if (element.offsetTop + element.offsetHeight > container.scrollTop) {
        anchorElementRef.current = element;
        viewportOffsetRef.current = element.offsetTop - container.scrollTop;
        return;
      }
    }
    anchorElementRef.current = null;
  }, []);

  const setMode = useCallback((mode: ViewportMode) => {
    modeRef.current = mode;
    setIsUserScrolledUp(mode === 'anchored');
  }, []);

  const applyTo = useCallback((container: HTMLDivElement, target: number) => {
    // Skip no-op writes: a write that does not move the viewport fires no
    // scroll event, which would leave selfWriteRef set and swallow the
    // reader's next real gesture.
    if (Math.round(target) === Math.round(container.scrollTop)) {
      return;
    }
    selfWriteRef.current = true;
    container.scrollTop = target;
  }, []);

  const follow = useCallback(() => {
    anchorElementRef.current = null;
    setMode('following');
    const container = containerRef.current;
    if (container) {
      applyTo(container, followingScrollTop(readMetrics(container)));
    }
  }, [applyTo, setMode]);

  const anchorTo = useCallback((element: HTMLElement, offsetPx = 0) => {
    const container = containerRef.current;
    if (!container) return;
    anchorElementRef.current = element;
    viewportOffsetRef.current = offsetPx;
    setMode('anchored');
    applyTo(container, anchoredScrollTop(element.offsetTop, offsetPx, readMetrics(container)));
  }, [applyTo, setMode]);

  // No dependency array: this must run after every commit, before paint.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const metrics = readMetrics(container);

    if (modeRef.current === 'following') {
      applyTo(container, followingScrollTop(metrics));
      return;
    }

    const anchor = anchorElementRef.current;
    if (!anchor || !container.contains(anchor)) {
      // Nothing to hold on to yet, or the anchor was unmounted. Adopt whatever
      // is on screen now rather than moving the reader.
      pickAnchor(container);
      return;
    }

    applyTo(container, anchoredScrollTop(anchor.offsetTop, viewportOffsetRef.current, metrics));
  });

  // The scroll listener is the only thing that changes mode.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    previousClientHeightRef.current = container.clientHeight;

    const onScroll = () => {
      if (selfWriteRef.current) {
        selfWriteRef.current = false;
        return;
      }

      const metrics = readMetrics(container);
      const layoutInduced = isLayoutInducedScroll(previousClientHeightRef.current, metrics.clientHeight);
      previousClientHeightRef.current = metrics.clientHeight;

      const mode = nextMode(metrics, layoutInduced, modeRef.current);
      if (mode !== modeRef.current) {
        setMode(mode);
      }
      if (mode !== 'anchored') {
        return;
      }

      const anchor = anchorElementRef.current;
      if (!anchor || !container.contains(anchor)) {
        pickAnchor(container);
        return;
      }
      const offset = anchor.offsetTop - metrics.scrollTop;
      if (shouldRepickAnchor(offset, metrics.clientHeight)) {
        pickAnchor(container);
        return;
      }
      viewportOffsetRef.current = offset;
    };

    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [pickAnchor, setMode]);

  // A newly opened session starts pinned to its newest message.
  useEffect(() => {
    anchorElementRef.current = null;
    modeRef.current = 'following';
    setIsUserScrolledUp(false);
  }, [sessionId]);

  // Stable identity: consumers put these in dependency arrays, and a fresh
  // object each render would re-run their effects on every commit.
  return useMemo(
    () => ({ containerRef, isUserScrolledUp, follow, anchorTo }),
    [isUserScrolledUp, follow, anchorTo],
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

```bash
node -e "const fs=require('fs');const f='src/components/chat/hooks/useChatViewport.ts';const s=fs.readFileSync(f,'latin1');fs.writeFileSync(f,s.replace(/\r\n/g,'\n').replace(/\n/g,'\r\n'),'latin1');"
npm run typecheck
npx eslint src/components/chat/hooks/useChatViewport.ts
npx vitest run
```
Expected: typecheck clean, eslint clean, all tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/hooks/useChatViewport.ts
git commit -m "feat: add the chat viewport controller hook"
```

---

### Task 3: Make the controller the only writer

This is the atomic swap. The old writers cannot be removed one at a time — with the controller active, any leftover writer is undone by the next commit.

**Files:**
- Modify: `src/components/chat/hooks/useChatSessionState.ts`
- Modify: `src/components/chat/view/ChatInterface.tsx`

**Interfaces:**
- Consumes: `useChatViewport` from Task 2.
- Produces: `useChatSessionState` keeps returning `scrollContainerRef`, `isUserScrolledUp`, `scrollToBottom`, `scrollToBottomAndReset` with unchanged names and call signatures, so `ChatInterface` and `ChatMessagesPane` need no prop changes. `scrollToBottom` becomes `() => void` with no arguments.

- [ ] **Step 1: Wire the controller in**

In `src/components/chat/hooks/useChatSessionState.ts`, add the import beside the other local hook imports:

```ts
import { useChatViewport } from './useChatViewport';
```

Replace the `const scrollContainerRef = useRef<HTMLDivElement>(null);` declaration with:

```ts
  const viewport = useChatViewport(selectedSession?.id ?? null);
  const scrollContainerRef = viewport.containerRef;
```

Delete the `const [isUserScrolledUp, setIsUserScrolledUp] = useState(false);` declaration and read it from the controller instead:

```ts
  const isUserScrolledUp = viewport.isUserScrolledUp;
```

- [ ] **Step 2: Replace `scrollToBottom` and delete `isNearBottom`**

Replace the whole `scrollToBottom` callback with a delegation, and delete `isNearBottom` entirely:

```ts
  // `follow` is already a stable useCallback, so alias it rather than wrapping
  // it in another one keyed on the viewport object.
  const scrollToBottom = viewport.follow;
```

`scrollToBottomAndReset` keeps its body; it already calls `scrollToBottom()`.

- [ ] **Step 3: Delete the four superseded writers**

Remove each of these in full:

1. The initial bottom-pin `useLayoutEffect` containing the `requestAnimationFrame` `tick` loop (the block that begins `if (!pendingInitialScrollRef.current || !scrollContainerRef.current || isLoadingSessionMessages) return;`).
2. The restore `useLayoutEffect` that reads `pendingScrollRestoreRef` and assigns `container.scrollTop = top + Math.max(newScrollHeight - height, 0)`.
3. Inside the follow effect, the whole `if (!isUserScrolledUp) { setTimeout(() => scrollToBottom(), 50); return; }` branch — and with it the effect itself, since its only remaining job was the stay-put comment.
4. Inside the external-update effect, the `if (isNearBottom()) { setTimeout(() => scrollToBottom(), 200); }` block. Keep the `refreshFromServer` call.

Then delete the refs and state that no longer have readers: `pendingScrollRestoreRef`, `pendingInitialScrollRef`, `scrollPositionRef`, `lastFollowedMessageCountRef`, the `useEffect` that only assigns `scrollPositionRef`, and the `handleScroll` callback plus the `useEffect` that registers it (the controller owns the scroll listener now).

Every write to a deleted ref must go too — including the assignments inside `loadOlderMessages`, `loadAllMessages`, and the session-reset effect. In `loadOlderMessages` and `loadAllMessages`, delete the `previousScrollHeight` / `previousScrollTop` locals and the `pendingScrollRestoreRef.current = { ... }` assignment; the anchor holds the position instead.

- [ ] **Step 4: Drop the wheel and touch plumbing**

`onWheel`/`onTouchMove` existed only to feed `handleScroll`. In `src/components/chat/view/ChatInterface.tsx` remove the `onWheel={handleScroll}` and `onTouchMove={handleScroll}` props (around line 354), and remove `handleScroll` from the destructured hook result. In `ChatMessagesPane.tsx` remove the `onWheel` and `onTouchMove` entries from the props type, the destructuring, and the two JSX attributes.

- [ ] **Step 5: Verify it compiles with nothing orphaned**

```bash
npm run typecheck
npx eslint src/components/chat/hooks/useChatSessionState.ts src/components/chat/view/ChatInterface.tsx src/components/chat/view/subcomponents/ChatMessagesPane.tsx
```
Expected: typecheck clean. eslint must report **no new** `is assigned a value but never used` warnings — if it does, a ref or callback was left behind; delete it. Three pre-existing warnings in `useChatSessionState.ts` (`isLoadingSessionRef`, `storeMessages`, and a missing-deps warning) are expected and must remain the only ones.

Confirm nothing still writes scrollTop outside the controller:

```bash
grep -rn "scrollTop =" src/components/chat --include=*.ts --include=*.tsx | grep -v useChatViewport
```
Expected: only `useChatComposerState.ts:541` (`inputHighlightRef.current.scrollTop`), which is the composer textarea, not the message list.

- [ ] **Step 6: Manual verification**

```bash
npm run build
```
Then hard-refresh and check, on desktop:
1. Opening a long session lands at the newest message with no visible flash at the top.
2. With the agent generating and the view parked at the bottom, output follows.
3. Scrolled up mid-transcript, generating output does not move the view; the "Scroll to bottom" button appears.
4. Pressing "Scroll to bottom" returns to the bottom and re-arms following.
5. "Load more" prepends older history without moving the visible text.
6. "Load all" does the same.

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/hooks/useChatSessionState.ts src/components/chat/view/ChatInterface.tsx src/components/chat/view/subcomponents/ChatMessagesPane.tsx
git commit -m "refactor: make the viewport controller the only writer of scrollTop"
```

---

### Task 4: Route the jumps through the controller

Search and bookmark jumps currently move the viewport themselves. They survive today because any external scroll fires a scroll event that the controller absorbs — but that is luck, not design: a smooth-scrolling `scrollIntoView` overlapping a store refresh can still land wrong. Routing them through `anchorTo` makes the destination explicit.

**Files:**
- Modify: `src/components/chat/view/subcomponents/BookmarkRail.tsx`
- Modify: `src/components/chat/hooks/useChatSessionState.ts`

**Interfaces:**
- Consumes: `anchorTo(element, offsetPx)` from Task 2.
- Produces: `useChatSessionState` returns `anchorTo` so `ChatMessagesPane` can hand it to `BookmarkRail`.

- [ ] **Step 1: Expose `anchorTo` from the session hook**

In `useChatSessionState.ts`, add `anchorTo: viewport.anchorTo,` to the returned object, next to `scrollToBottom`.

- [ ] **Step 2: Use it for the search jump**

In the search-target block, replace:

```ts
          targetElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
```

with:

```ts
          // Land the hit a third of the way down rather than at the very top,
          // so the lines above it give context. Anchoring (instead of
          // scrollIntoView) means a store refresh landing mid-jump holds this
          // position instead of undoing it.
          viewport.anchorTo(targetElement as HTMLElement, container.clientHeight / 3);
```

- [ ] **Step 3: Use it for the bookmark jump**

`BookmarkRail` receives `scrollContainerRef` today. Add an `anchorTo` prop of type `(element: HTMLElement, offsetPx?: number) => void`, pass it from `ChatMessagesPane` (which receives it from `ChatInterface`), and replace:

```ts
    container.scrollTo({
      top: Math.max(0, element.offsetTop - JUMP_TOP_PADDING_PX),
      behavior: 'auto',
    });
```

with:

```ts
    anchorTo(element, JUMP_TOP_PADDING_PX);
```

The surrounding comment about landing on the message's first line still applies and should stay; delete only the sentence about scrolling the container directly, which is no longer what happens.

- [ ] **Step 4: Verify**

```bash
npm run typecheck
npx eslint src/components/chat/view/subcomponents/BookmarkRail.tsx src/components/chat/hooks/useChatSessionState.ts src/components/chat/view/subcomponents/ChatMessagesPane.tsx
npm run build
```
Then manually: jump to a bookmark from the rail and from the sidebar list, and jump to a search hit. Each should land with the target near the top (bookmark) or a third down (search), stay put while the agent generates, and keep the highlight flash.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/view/subcomponents/BookmarkRail.tsx src/components/chat/hooks/useChatSessionState.ts src/components/chat/view/subcomponents/ChatMessagesPane.tsx src/components/chat/view/ChatInterface.tsx
git commit -m "refactor: route search and bookmark jumps through the viewport controller"
```

---

### Task 5: Sending re-arms following without a timer

**Files:**
- Modify: `src/components/chat/hooks/useChatComposerState.ts`

**Interfaces:**
- Consumes: `scrollToBottom` from Task 3, which now delegates to `follow()`.
- Produces: no new exports.

- [ ] **Step 1: Replace the timer**

Around line 898, replace:

```ts
      setIsUserScrolledUp(false);
      setTimeout(() => scrollToBottom(), 100);
```

with:

```ts
      // Sending is an act of engagement: the reader wants to watch the reply,
      // so re-arm following. The controller pins on the next commit, which is
      // when the message actually lands — no timer needed to wait for it.
      scrollToBottom();
```

`setIsUserScrolledUp` is no longer passed into this hook. Remove it from the hook's argument type and destructuring, and stop passing it from `ChatInterface.tsx`.

- [ ] **Step 2: Verify**

```bash
npm run typecheck
npx eslint src/components/chat/hooks/useChatComposerState.ts src/components/chat/view/ChatInterface.tsx
grep -rn "setTimeout" src/components/chat/hooks/useChatSessionState.ts src/components/chat/hooks/useChatComposerState.ts | grep -i scroll
```
Expected: the grep returns nothing — no timer-driven scrolling remains.

Then manually: scroll up mid-transcript, send a message, and confirm the view goes to the bottom once and stays following.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/hooks/useChatComposerState.ts src/components/chat/view/ChatInterface.tsx
git commit -m "refactor: re-arm following on send without a timer"
```

---

### Task 6: Mobile verification and close-out

No code changes unless verification finds a problem. This task exists because the mobile paths are the reason for the work and cannot be checked by any of the above.

**Files:**
- Modify: none expected.

- [ ] **Step 1: Confirm the invariants hold in the built bundle**

```bash
npm run build
npx vitest run
npm run typecheck
```
Expected: all green.

- [ ] **Step 2: Verify on iOS Safari over the tailnet**

With an agent actively generating in a long session:

1. Scroll up mid-transcript. Confirm generation does not move the view.
2. Switch to another app, wait for several messages to arrive, switch back. The view must be exactly where it was left.
3. Repeat parked at the bottom: after returning, following should resume and new output should be visible.
4. Scroll slowly up and down so the Safari toolbar hides and shows. The view must not snap to the bottom when the toolbar changes.
5. Send a message while scrolled up; the view should go to the bottom once.

- [ ] **Step 3: If any step fails, gather evidence before changing code**

Restore the gated instrumentation rather than guessing:

```bash
git show 7658d5e:src/utils/scrollDebug.ts > src/utils/scrollDebug.ts
```

Wire `logScroll` into `useChatViewport`'s `applyTo` and scroll listener, rebuild, then on the device run `localStorage.setItem('debug-chat-scroll','1')`, reload, reproduce, and read the trace with `dumpChatScroll()`. A movement with no preceding `applyTo` line means something outside the controller moved the viewport. Remove `src/utils/scrollDebug.ts` and the instrumentation before the final commit.

- [ ] **Step 4: Update the spec status**

In `docs/superpowers/specs/2026-09-05-chat-viewport-controller-design.md`, change the `**Status:**` line to `Implemented`.

- [ ] **Step 5: Commit and push**

```bash
git add docs/superpowers/specs/2026-09-05-chat-viewport-controller-design.md
git commit -m "docs: mark the chat viewport controller design implemented"
git push dastonzerg zweipeng-main
```
