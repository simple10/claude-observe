# Logs Modal Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-modal search to the Raw Event Logs modal that highlights matches across every event's payload JSON, with prev/next navigation, a 200ms debounce that cancels on keydown, and zero memory leaks across modal opens / query changes.

**Architecture:** All logic lives in `app/client/src/components/main-panel/logs-modal.tsx` (single-file change) plus two `::highlight(...)` rules in `app/client/src/index.css`. Highlighting uses the CSS Custom Highlight API with two priority-ordered named highlights (`logs-search-all`, `logs-search-current`). A pre-stringified search index, debounced query commits, and split build/paint effects keep typing responsive and avoid re-walking DOM on navigation.

**Tech Stack:** React 18+, TypeScript, vitest + @testing-library/react, Radix UI Dialog, CSS Custom Highlight API.

**Spec:** `docs/plans/2026-05-08-logs-modal-search-design.md`

---

## File Structure

**Modify:**

- `app/client/src/components/main-panel/logs-modal.tsx` — all state, effects, handlers, UI changes.
- `app/client/src/index.css` — two `::highlight(...)` rules.

**Create:**

- `app/client/src/components/main-panel/logs-modal.test.tsx` — component tests.

**Touch (test setup only):**

- `app/client/src/test/setup.ts` — add `CSS.highlights` + `Highlight` polyfills for jsdom.

No store, API, or schema changes.

---

## Conventions for Every Task

- Run tests with: `cd app/client && npm test -- logs-modal` (filters to this file).
- Run all client tests: `cd app/client && npm test`.
- Run full check: `just check` (tests + format).
- Always commit at the end of each task.
- Commit prefix: `feat:` for new functionality, `test:` for test-only commits, `refactor:` for code restructuring with no behavior change, `chore:` for setup/config.
- After every task, run `cd app/client && npx tsc --noEmit` to catch type errors before committing.

---

## Task 1: jsdom polyfills for CSS Custom Highlight API

**Files:**
- Modify: `app/client/src/test/setup.ts`

The CSS Custom Highlight API is not in jsdom. Tests need a minimal polyfill so `new Highlight(...)`, `CSS.highlights.set/delete/get`, and `'highlights' in CSS` work as expected. The polyfill mirrors the spec's surface only — actual paint behavior is irrelevant in jsdom.

- [ ] **Step 1: Read the current setup file**

Run: `cat app/client/src/test/setup.ts`
Expected: existing setup that imports `@testing-library/jest-dom/vitest`, polyfills element dimensions, etc.

- [ ] **Step 2: Append the polyfills**

Add at the end of `app/client/src/test/setup.ts`:

```ts
// CSS Custom Highlight API polyfill for jsdom.
// Real browsers paint these; jsdom doesn't render — we just need the
// surface so tests can construct, register, and assert on highlights.
if (typeof (globalThis as any).Highlight === 'undefined') {
  class HighlightPolyfill {
    private ranges = new Set<Range>()
    priority = 0
    constructor(...ranges: Range[]) {
      for (const r of ranges) this.ranges.add(r)
    }
    add(range: Range) { this.ranges.add(range) }
    has(range: Range) { return this.ranges.has(range) }
    delete(range: Range) { return this.ranges.delete(range) }
    clear() { this.ranges.clear() }
    get size() { return this.ranges.size }
    [Symbol.iterator]() { return this.ranges[Symbol.iterator]() }
  }
  ;(globalThis as any).Highlight = HighlightPolyfill
}

if (typeof CSS !== 'undefined' && !('highlights' in CSS)) {
  ;(CSS as any).highlights = new Map()
}

// Element.prototype.scrollBy is not implemented in jsdom; LogsModal's
// scrollMatchIntoView calls it on <pre> and the modal scroller. Make it
// a no-op so tests don't throw. Tests that need to assert on scroll
// behavior patch this prototype themselves.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollBy !== 'function') {
  Element.prototype.scrollBy = function scrollByNoop() {} as typeof Element.prototype.scrollBy
}
```

- [ ] **Step 3: Run any existing test to confirm setup still loads**

Run: `cd app/client && npm test -- session-item 2>&1 | tail -20`
Expected: tests pass; no syntax errors from the appended polyfill.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/test/setup.ts
git commit -m "chore: add CSS Custom Highlight API polyfill for jsdom tests"
```

---

## Task 2: CSS highlight rules

**Files:**
- Modify: `app/client/src/index.css`

- [ ] **Step 1: Read the current index.css to find a sensible insertion point**

Run: `head -40 app/client/src/index.css`
Expected: see Tailwind layers and any custom CSS rules.

- [ ] **Step 2: Append the two `::highlight(...)` rules**

Add at the end of `app/client/src/index.css` (or after other custom rules — use whatever the file's existing convention is):

```css
/* Logs modal search — paints matches found by LogsModal's
   CSS Custom Highlight API integration. logs-search-current has
   higher priority so the active match shows orange over yellow. */
::highlight(logs-search-all) {
  background-color: rgb(250 204 21 / 0.35);
}
::highlight(logs-search-current) {
  background-color: rgb(249 115 22 / 0.75);
  color: black;
}
```

- [ ] **Step 3: Verify the file still compiles**

Run: `cd app/client && npx tsc --noEmit && npm run fmt`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/index.css
git commit -m "feat: add logs-search highlight CSS rules"
```

---

## Task 3: Test scaffold for LogsModal

**Files:**
- Create: `app/client/src/components/main-panel/logs-modal.test.tsx`

Create the test file with provider setup, mocks, and a "renders the modal" smoke test that we'll extend in later tasks.

- [ ] **Step 1: Look at an existing modal test to mirror the mocking pattern**

Run: `head -80 app/client/src/components/settings/session-modal.tsx 2>/dev/null; cat app/client/src/components/settings/project-modal.test.tsx | head -60`
Expected: shows how `vi.hoisted` + `vi.mock` is used for `api-client` and hooks.

- [ ] **Step 2: Create the test file**

```tsx
// app/client/src/components/main-panel/logs-modal.test.tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { screen, fireEvent, cleanup, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '@/test/test-utils'
import { LogsModal } from './logs-modal'
import { useUIStore } from '@/stores/ui-store'
import type { ParsedEvent } from '@/types'

// Polyfill ResizeObserver for Radix UI (Dialog) in jsdom.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver

// ── Mock data ──────────────────────────────────────────────

// Stable-ref holder: the mocked useEvents returns the SAME array
// reference between setMockEvents calls, but a NEW reference each time
// setMockEvents runs. This:
//   - prevents an infinite render loop (a fresh `[...mockEvents]` on
//     every render would re-trigger the existing `[open, events]`
//     effect → setReadyEvents → re-render → fresh array → loop), AND
//   - still flips identity for the streaming-rebuild tests (Tasks 17,
//     20, 22) because each setMockEvents call assigns a new array.
const { eventsHolder } = vi.hoisted(() => ({
  eventsHolder: { current: [] as ParsedEvent[] },
}))

function setMockEvents(events: ParsedEvent[]) {
  eventsHolder.current = events // swap reference once per call
}

vi.mock('@/hooks/use-events', () => ({
  useEvents: () => ({ data: eventsHolder.current }),
}))

// ── Helpers ─────────────────────────────────────────────────

function makeEvent(id: number, payload: Record<string, unknown>): ParsedEvent {
  return {
    id,
    agentId: 'agent-1',
    sessionId: 'sess-1',
    hookName: 'PreToolUse',
    timestamp: 1700000000000 + id * 1000,
    cwd: null,
    _meta: null,
    payload,
  }
}

async function openModal() {
  const user = userEvent.setup()
  const trigger = screen.getByTitle(/view raw event logs/i)
  await user.click(trigger)
  // Wait for the deferred (useTransition) load to settle
  await screen.findByText(/raw event logs/i)
  return user
}

/**
 * Advance fake timers and drain microtasks so any Promise.then chains
 * triggered by the resulting state updates resolve before assertions.
 *
 * Why this exists: LogsModal's debounced commit triggers Effect A,
 * which calls `buildMatches(...).then(...)`. Even when buildMatches'
 * body runs synchronously, the .then callback is a microtask. A plain
 * `act(() => vi.advanceTimersByTime(N))` flushes timers + effects but
 * NOT pending microtasks — so state updates inside .then haven't
 * landed when the next line runs. `await act(async () => …)` waits
 * for the implicit microtask boundary at the end of the async fn.
 */
async function flushTimers(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
    // Two microtask flushes: one for buildMatches.then, one for the
    // setState updates inside .then to commit + rerun Effect B.
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * Fire Enter (optionally with Shift) on the search input. Wraps in
 * act() and drains microtasks so a force-commit's buildMatches.then
 * resolves before the next assertion. Safe to use even when Enter
 * just navigates (no .then chain).
 */
async function pressEnter(input: HTMLElement, opts?: { shiftKey?: boolean }) {
  await act(async () => {
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: !!opts?.shiftKey })
    await Promise.resolve()
    await Promise.resolve()
  })
}

beforeEach(() => {
  setMockEvents([])
  useUIStore.setState({ selectedSessionId: 'sess-1' })
  if ('highlights' in CSS) {
    ;(CSS as any).highlights.clear?.()
    ;(CSS as any).highlights.delete('logs-search-all')
    ;(CSS as any).highlights.delete('logs-search-current')
  }
})

afterEach(() => {
  cleanup()
})

// ── Smoke ───────────────────────────────────────────────────

describe('LogsModal — smoke', () => {
  it('renders the modal when opened', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash', cmd: 'ls' })])
    renderWithProviders(<LogsModal />)
    await openModal()
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    expect(screen.getByText(/1 events/i)).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run the test and confirm it fails on missing search elements (it should pass for now since we only assert on existing UI)**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: the smoke test passes — current LogsModal already renders the title and event count.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "test: scaffold LogsModal test file with smoke test"
```

---

## Task 4: Search input UI (no behavior yet)

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Add the always-on search input to the modal header, mirroring `event-filter-bar.tsx`'s styling. Just the visual + controlled input — no debounce, no highlights yet.

- [ ] **Step 1: Write the failing test**

Add to `logs-modal.test.tsx`:

```tsx
describe('LogsModal — search input', () => {
  it('renders a search input in the header', async () => {
    setMockEvents([makeEvent(1, { foo: 'bar' })])
    renderWithProviders(<LogsModal />)
    await openModal()
    expect(screen.getByPlaceholderText(/search payloads/i)).toBeInTheDocument()
  })

  it('updates the input value as the user types', async () => {
    setMockEvents([makeEvent(1, { foo: 'bar' })])
    renderWithProviders(<LogsModal />)
    const user = await openModal()
    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await user.type(input, 'hello')
    expect(input.value).toBe('hello')
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: FAIL — `getByPlaceholderText` throws "Unable to find an element with the placeholder text: /search payloads/i".

- [ ] **Step 3: Implement the input**

In `logs-modal.tsx`:

a. Add `Search` to the existing `lucide-react` import:

```ts
import {
  ScrollText,
  Copy,
  Check,
  ArrowDownToLine,
  CloudDownload,
  ClipboardCopy,
  X,
  LoaderCircle,
  Search, // <-- add
} from 'lucide-react'
```

b. Add the `Input` import (new line near the other UI imports):

```ts
import { Input } from '@/components/ui/input'
```

c. Add `query` state inside the component (near other useState calls):

```ts
const [query, setQuery] = useState('')
```

d. Replace the entire right-hand action group `<div className="flex items-center gap-1 ml-auto">…</div>` so the search input becomes its first child. The existing buttons stay in place — only their wrapper now starts with the search input:

```tsx
<div className="flex items-center gap-1 ml-auto">
  {/* Search input — first child of the action group. */}
  <div className="relative w-56 mr-1">
    <Search
      className={cn(
        'absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5',
        query ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
      )}
    />
    <Input
      placeholder="Search payloads..."
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      className={cn(
        'h-7 pl-7 text-xs',
        query &&
          'border-green-600 dark:border-green-400 ring-1 ring-green-600/30 dark:ring-green-400/30',
      )}
    />
  </div>

  {/* Existing buttons — unchanged. */}
  <Button
    variant="ghost"
    size="sm"
    className="h-7 gap-1.5 text-xs"
    onClick={handleCopyAll}
    title="Copy all logs"
    disabled={loading}
  >
    {copiedAll ? (
      <Check className="h-3 w-3 text-green-500" />
    ) : (
      <ClipboardCopy className="h-3 w-3" />
    )}
    {copiedAll ? 'Copied' : 'Copy all'}
  </Button>
  <Button
    variant="ghost"
    size="icon"
    className="h-7 w-7"
    onClick={() => {
      if (!events) return
      const json = JSON.stringify(events, null, 2)
      const blob = new Blob([json], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `logs-${selectedSessionId}.json`
      a.click()
      URL.revokeObjectURL(url)
    }}
    title="Download logs as JSON"
    disabled={loading || !events}
  >
    <CloudDownload className="h-3.5 w-3.5" />
  </Button>
  <Button
    variant="ghost"
    size="icon"
    className="h-7 w-7"
    onClick={scrollToBottom}
    title="Jump to bottom"
    disabled={loading}
  >
    <ArrowDownToLine className="h-3.5 w-3.5" />
  </Button>
  <DialogClose asChild>
    <Button variant="ghost" size="icon" className="h-7 w-7" title="Close">
      <X className="h-4 w-4" />
    </Button>
  </DialogClose>
</div>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "feat: add search input to logs modal header"
```

---

## Task 5: Debounce + committed-query state

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Add the 200ms debounce (driven off `onChange` so paste/programmatic edits also commit), the `committedQuery` state, IME composition guard, and `onKeyDown` timer-cancel.

- [ ] **Step 1: Write the failing test**

Add to `logs-modal.test.tsx`:

```tsx
describe('LogsModal — debounce', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('commits the query 200ms after the last change', async () => {
    setMockEvents([makeEvent(1, { foo: 'bar' })])
    renderWithProviders(<LogsModal />)
    // userEvent with fake timers needs `advanceTimers`
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await user.type(input, 'foo')
    expect(input.value).toBe('foo')

    // Before debounce fires, no committed-query side effect (we'll observe
    // via the absence of the match counter UI which we'll add later — for
    // now just assert the input value is right and that advancing timers
    // doesn't throw).
    await flushTimers(199)
    await flushTimers(2)
  })

  it('clears immediately when the input is emptied', async () => {
    setMockEvents([makeEvent(1, { foo: 'bar' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await user.type(input, 'foo')
    await user.clear(input)
    expect(input.value).toBe('')
    // Empty input should NOT schedule a delayed commit.
    await flushTimers(500)
  })
})
```

These tests are intentionally weak (they only assert input value and that fake timers advance cleanly) because we have no visible side effect of `committedQuery` yet. Later tasks will tighten them.

- [ ] **Step 2: Run the test and verify it currently passes (the assertions are loose)**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS — but we still need to add the `committedQuery` logic so it doesn't break later tasks.

- [ ] **Step 3: Implement debounce + committed query**

In `logs-modal.tsx`, near the `query` state, add:

```ts
const [committedQuery, setCommittedQuery] = useState('')
const debounceRef    = useRef<ReturnType<typeof setTimeout>>(undefined)
const isComposingRef = useRef(false)

function scheduleCommit(next: string) {
  clearTimeout(debounceRef.current)
  if (next === '') {
    setCommittedQuery('')
    return
  }
  if (isComposingRef.current) return
  debounceRef.current = setTimeout(() => setCommittedQuery(next), 200)
}
```

Replace the input's `onChange` and add the new handlers:

```tsx
<Input
  placeholder="Search payloads..."
  value={query}
  onChange={(e) => {
    setQuery(e.target.value)
    scheduleCommit(e.target.value)
  }}
  onKeyDown={(e) => {
    // Cancel pending commit so a new keystroke resets the 200ms window.
    // Does NOT abort in-flight builds — Effect A's cleanup handles that.
    // Esc is handled by Radix's onEscapeKeyDown on DialogContent (later task).
    clearTimeout(debounceRef.current)
  }}
  onCompositionStart={() => { isComposingRef.current = true }}
  onCompositionEnd={(e) => {
    isComposingRef.current = false
    scheduleCommit((e.target as HTMLInputElement).value)
  }}
  className={cn(...)}
/>
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "feat: debounce search input commit by 200ms"
```

---

## Task 6: Search index + `<pre>` ref-callback

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`

Add the `searchIndex` memo and the `<pre>` ref-callback so we can find each event's rendered element. No tests yet — the indices and refs are exercised through later tasks' behavioral tests.

- [ ] **Step 1: Add `useMemo` to the React import**

The original file imports `useState, useRef, useEffect, useTransition`. Extend to include `useMemo`:

```ts
import { useState, useRef, useEffect, useTransition, useMemo } from 'react'
```

- [ ] **Step 2: Add the searchIndex memo**

Inside the component body, after the existing useState/useRef declarations:

```ts
const searchIndex = useMemo(
  () => readyEvents?.map((e) => JSON.stringify(e.payload, null, 2).toLowerCase()) ?? [],
  [readyEvents],
)
```

(`readyEvents` is the deferred events array set by the existing useTransition effect.)

- [ ] **Step 3: Add the preRefs ref**

Near other refs:

```ts
const preRefs = useRef<Map<number, HTMLPreElement>>(new Map())
```

- [ ] **Step 4: Wire the ref-callback on each `<pre>`**

In the JSX where `<pre>` is rendered for each event, change:

```tsx
<pre className={cn(...)}>{JSON.stringify(event.payload, null, 2)}</pre>
```

to:

```tsx
<pre
  ref={(el) => {
    if (el) preRefs.current.set(event.id, el)
    else preRefs.current.delete(event.id)
  }}
  className={cn(...)}
>
  {JSON.stringify(event.payload, null, 2)}
</pre>
```

- [ ] **Step 5: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Run existing tests to ensure nothing broke**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx
git commit -m "feat: pre-stringify search index and capture pre refs"
```

---

## Task 7: `buildMatches` helper

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`

Add the async `buildMatches` function. Defined inside the file (not exported) — it's used only by Effect A in Task 9.

- [ ] **Step 1: Add the function and the Match type at the top of the module (above the LogsModal export)**

```ts
type Match = { eventId: number; range: Range }

async function buildMatches(
  query: string,
  events: ParsedEvent[],
  index: string[],
  preMap: Map<number, HTMLPreElement>,
  signal: AbortSignal,
): Promise<Match[]> {
  // Note: positions found in `haystack` (lowercased) are mapped 1:1 onto
  // the original textNode for Range offsets. This assumes
  // `String.prototype.toLowerCase()` is length-preserving, which is true
  // for ASCII (the dominant case for JSON-stringified payloads) but NOT
  // for some Unicode (e.g. Turkish `İ` → `i̇`). If that ever
  // matters, build positions against the un-lowercased text using
  // `localeCompare` or `Intl.Segmenter`.
  const lower = query.toLowerCase()
  const out: Match[] = []
  const CAP = 1000

  for (let i = 0; i < events.length; i++) {
    if (signal.aborted) return out
    if (out.length >= CAP) break

    if (!index[i]?.includes(lower)) continue
    const event = events[i]

    const pre = preMap.get(event.id)
    if (!pre) continue

    // Walk siblings rather than assume firstChild is the text node.
    // Comments / Suspense markers can appear before it.
    let textNode: Text | null = null
    for (let n: Node | null = pre.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE) { textNode = n as Text; break }
    }
    if (!textNode) continue

    const haystack = textNode.textContent!.toLowerCase()
    let pos = 0
    while ((pos = haystack.indexOf(lower, pos)) !== -1) {
      if (out.length >= CAP) break
      const range = document.createRange()
      range.setStart(textNode, pos)
      range.setEnd(textNode, pos + lower.length)
      out.push({ eventId: event.id, range })
      pos += lower.length
    }

    if (i > 0 && i % 500 === 0) {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    }
  }
  return out
}
```

- [ ] **Step 2: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Run existing tests**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -20`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx
git commit -m "feat: add buildMatches helper for logs-modal search"
```

---

## Task 8: `scrollMatchIntoView` helper

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`

- [ ] **Step 1: Add the function below `buildMatches` (still module-level)**

```ts
function scrollMatchIntoView(range: Range, outer: HTMLElement | null) {
  const text = range.startContainer as Text
  const pre  = text.parentElement?.closest('pre') as HTMLElement | null

  // 1. Center the match inside its <pre>'s inner scroll.
  if (pre) {
    const rangeRect = range.getBoundingClientRect()
    const preRect   = pre.getBoundingClientRect()
    const delta = (rangeRect.top + rangeRect.height / 2)
                - (preRect.top + preRect.height / 2)
    pre.scrollBy({ top: delta, behavior: 'instant' })
  }

  // 2. Center the (now-positioned) match inside the modal's outer scroll.
  if (outer) {
    const rangeRect = range.getBoundingClientRect()
    const outerRect = outer.getBoundingClientRect()
    const delta = (rangeRect.top + rangeRect.height / 2)
                - (outerRect.top + outerRect.height / 2)
    outer.scrollBy({ top: delta, behavior: 'instant' })
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors. (`scrollBy` with `'instant'` requires `lib.dom.d.ts` ScrollOptions — supported in TS 5.x.)

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx
git commit -m "feat: add scrollMatchIntoView helper for logs-modal search"
```

---

## Task 9: Effect A — build the match list

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Wire up the build effect. After this task, typing into the search input should populate `CSS.highlights.get('logs-search-all')` with matching ranges.

- [ ] **Step 1: Write the failing test**

Add to `logs-modal.test.tsx`:

```tsx
describe('LogsModal — match building', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('populates logs-search-all when the query matches', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash', cmd: 'ls -la' }),
      makeEvent(2, { tool_name: 'Read', path: '/etc/hosts' }),
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    // Drain any deferred event load
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)

    const all = (CSS as any).highlights.get('logs-search-all')
    expect(all).toBeDefined()
    expect(all.size).toBe(1)
  })

  it('clears logs-search-all when the query is empty', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)
    expect((CSS as any).highlights.get('logs-search-all')).toBeDefined()

    await user.clear(input)
    // Empty clears immediately, no debounce
    await flushTimers(0)
    expect((CSS as any).highlights.get('logs-search-all')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: FAIL — `all` is undefined because Effect A doesn't exist yet.

- [ ] **Step 3: Add the state + ref scaffolding for Effect A**

In `LogsModal`, near the other state:

```ts
const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
const [matchCount, setMatchCount]               = useState(0)
const [rebuildEpoch, setRebuildEpoch]           = useState(0)
const matchesRef                                = useRef<Match[]>([])
const lastBuiltQueryRef                         = useRef('')
const scrollOnNextPaintRef                      = useRef(false)
```

- [ ] **Step 4: Add Effect A**

After the existing `useEffect`s in the component:

```ts
useEffect(() => {
  if (!('highlights' in CSS)) return                  // graceful degrade

  if (!committedQuery || !readyEvents) {
    CSS.highlights.delete('logs-search-all')
    CSS.highlights.delete('logs-search-current')
    matchesRef.current = []
    setMatchCount(0)
    setCurrentMatchIndex(0)
    setRebuildEpoch((e) => e + 1)
    lastBuiltQueryRef.current = ''
    return
  }

  const ctrl = new AbortController()
  buildMatches(committedQuery, readyEvents, searchIndex, preRefs.current, ctrl.signal)
    .then((matches) => {
      if (ctrl.signal.aborted) return

      const isNewQuery = committedQuery !== lastBuiltQueryRef.current

      // Order matters: write refs synchronously BEFORE state updates that
      // trigger Effect B. Effect B reads matchesRef.current.
      matchesRef.current = matches
      lastBuiltQueryRef.current = committedQuery

      setMatchCount(matches.length)
      setRebuildEpoch((e) => e + 1)
      setCurrentMatchIndex((prev) => {
        if (matches.length === 0) return 0
        if (isNewQuery) {
          scrollOnNextPaintRef.current = true
          return 0
        }
        return Math.min(prev, matches.length - 1)
      })

      if (matches.length > 0) {
        const all = new Highlight()
        for (const m of matches) all.add(m.range)
        all.priority = 0
        CSS.highlights.set('logs-search-all', all)
      } else {
        CSS.highlights.delete('logs-search-all')
        CSS.highlights.delete('logs-search-current')
      }
    })

  return () => {
    ctrl.abort()
    // Don't delete highlights here — would flicker on streaming rebuilds.
  }
}, [committedQuery, readyEvents, searchIndex])
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "feat: build search match list and paint logs-search-all"
```

---

## Task 10: Effect B — paint current + scroll-on-intent

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

Add:

```tsx
describe('LogsModal — current-match paint', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('paints logs-search-current when a query has matches', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)

    const current = (CSS as any).highlights.get('logs-search-current')
    expect(current).toBeDefined()
    expect(current.size).toBe(1)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: FAIL — `logs-search-current` is undefined (Effect B doesn't exist).

- [ ] **Step 3: Add Effect B**

```ts
useEffect(() => {
  if (!('highlights' in CSS)) return
  const matches = matchesRef.current
  if (matches.length === 0) {
    CSS.highlights.delete('logs-search-current')
    scrollOnNextPaintRef.current = false
    return
  }
  const idx = Math.min(currentMatchIndex, matches.length - 1)
  const current = new Highlight()
  current.add(matches[idx].range)
  current.priority = 1
  CSS.highlights.set('logs-search-current', current)

  if (scrollOnNextPaintRef.current) {
    scrollMatchIntoView(matches[idx].range, scrollRef.current)
    scrollOnNextPaintRef.current = false
  }
}, [currentMatchIndex, matchCount, rebuildEpoch])
```

- [ ] **Step 4: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "feat: paint current match highlight and scroll on intent"
```

---

## Task 11: `next` / `prev` callbacks + ref mirror

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`

`next`/`prev` are referenced from the document-level Cmd+G listener (next task). They must be wrapped in `useCallback` and mirrored into refs so the listener doesn't re-attach on every match-count change.

- [ ] **Step 1: Extend the React import with `useCallback`**

After Task 6 the import line reads `useState, useRef, useEffect, useTransition, useMemo`. Add `useCallback`:

```ts
import { useState, useRef, useEffect, useTransition, useMemo, useCallback } from 'react'
```

- [ ] **Step 2: Add `next` / `prev` and the ref mirror near the other handlers**

```ts
const next = useCallback(() => {
  if (matchCount === 0) return
  scrollOnNextPaintRef.current = true
  setCurrentMatchIndex((i) => (i + 1) % matchCount)
}, [matchCount])

const prev = useCallback(() => {
  if (matchCount === 0) return
  scrollOnNextPaintRef.current = true
  setCurrentMatchIndex((i) => (i - 1 + matchCount) % matchCount)
}, [matchCount])

const nextRef = useRef(next)
const prevRef = useRef(prev)
useEffect(() => {
  nextRef.current = next
  prevRef.current = prev
}, [next, prev])
```

- [ ] **Step 3: Type-check + run tests**

Run: `cd app/client && npx tsc --noEmit && npm test -- logs-modal 2>&1 | tail -10`
Expected: no errors, all tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx
git commit -m "feat: add next/prev nav callbacks with ref mirror"
```

---

## Task 12: Match counter + nav buttons UI

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Render the `3/47 ▲ ▼ ✕` cluster when `committedQuery !== ''`. Wire ▲/▼ to `prev`/`next`, ✕ to clear.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('LogsModal — nav cluster', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('shows match counter once the query is committed', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)

    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('shows "0 matches" when the query has no hits', async () => {
    setMockEvents([makeEvent(1, { foo: 'bar' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'zzz')
    await flushTimers(250)

    expect(screen.getByText(/0 matches/i)).toBeInTheDocument()
  })

  it('advances current match when ▼ is clicked', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)

    expect(screen.getByText('1/2')).toBeInTheDocument()
    await user.click(screen.getByTitle(/next match/i))
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('clears the query when ✕ is clicked', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await user.type(input, 'Bash')
    await flushTimers(250)

    await user.click(screen.getByTitle(/clear search/i))
    expect(input.value).toBe('')
    expect(screen.queryByText(/1\/1/)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: FAIL — counter and buttons don't exist yet.

- [ ] **Step 3: Add ChevronUp + ChevronDown imports**

```ts
import {
  ScrollText, Copy, Check, ArrowDownToLine, CloudDownload,
  ClipboardCopy, X, LoaderCircle, Search,
  ChevronUp, ChevronDown,                                  // <-- add
} from 'lucide-react'
```

- [ ] **Step 4: Add the nav cluster**

Inside the same `<div className="flex items-center gap-1 ml-auto">` wrapper Task 4 added the search input to. Place the cluster immediately after the search input's wrapper div (`<div className="relative w-56 mr-1">…</div>`) and before the existing Copy all / Download / Scroll-bottom / Close buttons:

```tsx
{committedQuery !== '' && (
  <div className="flex items-center gap-0.5 mr-1 text-xs">
    {matchCount === 0 ? (
      <span className="text-destructive mr-1">0 matches</span>
    ) : (
      <span className="text-muted-foreground mr-1 tabular-nums">
        {currentMatchIndex + 1}/{matchCount}{matchCount >= 1000 ? '+' : ''}
      </span>
    )}
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={prev}
      disabled={matchCount === 0}
      title="Previous match"
    >
      <ChevronUp className="h-3.5 w-3.5" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={next}
      disabled={matchCount === 0}
      title="Next match"
    >
      <ChevronDown className="h-3.5 w-3.5" />
    </Button>
    <Button
      variant="ghost"
      size="icon"
      className="h-6 w-6"
      onClick={() => {
        setQuery('')
        setCommittedQuery('')
        clearTimeout(debounceRef.current)
      }}
      title="Clear search"
    >
      <X className="h-3.5 w-3.5" />
    </Button>
  </div>
)}
```

- [ ] **Step 5: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "feat: add match counter and prev/next/clear nav cluster"
```

---

## Task 13: Document-level `Cmd/Ctrl+G` listener

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Listener is attached to `document` only when `committedQuery !== ''` and modal is open. Uses `e.code === 'KeyG'` to handle Shift+G (uppercase `key`). Verifies `e.target` is inside the dialog before firing.

- [ ] **Step 1: Write the failing test**

```tsx
describe('LogsModal — Cmd+G listener', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('advances current match on Cmd+G when committedQuery is non-empty', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)
    expect(screen.getByText('1/2')).toBeInTheDocument()

    // Dispatch native keyboard event from inside the dialog
    const dialog = screen.getByRole('dialog')
    const ev = new KeyboardEvent('keydown', {
      key: 'g', code: 'KeyG', metaKey: true, bubbles: true, cancelable: true,
    })
    act(() => { dialog.dispatchEvent(ev) })

    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('moves to previous match on Cmd+Shift+G (uppercase key)', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)

    const dialog = screen.getByRole('dialog')
    const ev = new KeyboardEvent('keydown', {
      key: 'G', code: 'KeyG', metaKey: true, shiftKey: true, bubbles: true, cancelable: true,
    })
    act(() => { dialog.dispatchEvent(ev) })

    // Wraps from 1 to 2
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('does NOT listen when committedQuery is empty', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    // No query typed — bindings inactive
    const dialog = screen.getByRole('dialog')
    const ev = new KeyboardEvent('keydown', {
      key: 'g', code: 'KeyG', metaKey: true, bubbles: true, cancelable: true,
    })
    // Should not throw or change anything visible
    act(() => { dialog.dispatchEvent(ev) })
    expect(ev.defaultPrevented).toBe(false)
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: FAIL — Cmd+G has no effect.

- [ ] **Step 3: Add the document-level listener effect**

This codebase's `DialogContent` (in `app/client/src/components/ui/dialog.tsx`) is a
plain function component — it does NOT use `React.forwardRef`, so attaching a
ref to it would be a TypeScript error and a no-op at runtime. Instead, the
modal-scope check uses `closest('[role="dialog"]')` — Radix sets `role="dialog"`
on `DialogPrimitive.Content` automatically.

```ts
useEffect(() => {
  if (committedQuery === '' || !open) return
  if (!('highlights' in CSS)) return

  function onDocKeyDown(e: KeyboardEvent) {
    // e.code instead of e.key — Shift+G yields key='G' on macOS.
    if (e.code !== 'KeyG') return
    if (!(e.metaKey || e.ctrlKey)) return

    // Make sure the event came from inside a Radix Dialog. This guards
    // against the modal listener firing for keystrokes in unrelated UI
    // (e.g. another stacked dialog or a detached portal).
    const target = e.target as Element | null
    if (!target?.closest?.('[role="dialog"]')) return

    e.preventDefault()
    if (e.shiftKey) prevRef.current()
    else            nextRef.current()
  }
  document.addEventListener('keydown', onDocKeyDown)
  return () => document.removeEventListener('keydown', onDocKeyDown)
}, [committedQuery, open])
```

- [ ] **Step 4: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: PASS for all three new tests.

- [ ] **Step 5: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "feat: bind Cmd/Ctrl+G to next/prev match in logs modal"
```

---

## Task 14: Force-commit on Enter, navigate on Enter / Shift+Enter

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Extends the input's `onKeyDown` to:
- Enter with uncommitted change: clear timer, force-commit immediately.
- Enter with already-committed query: next match.
- Shift+Enter: previous match.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('LogsModal — Enter / Shift+Enter', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('Enter force-commits the query (skips the 200ms debounce)', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    // Don't advance the debounce timer — press Enter instead
    await pressEnter(input)
    // Counter should appear immediately (no 200ms wait)
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('Enter on committed query advances current match', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)
    expect(screen.getByText('1/2')).toBeInTheDocument()

    await pressEnter(input)
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('Shift+Enter retreats current match', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)

    await pressEnter(input, { shiftKey: true })
    // Wraps from 1 to 2
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: FAIL — Enter does nothing useful yet.

- [ ] **Step 3: Update the input's `onKeyDown`**

Replace the existing onKeyDown block with:

```tsx
onKeyDown={(e) => {
  if (e.key === 'Enter') {
    clearTimeout(debounceRef.current)
    if (query !== committedQuery) {
      // Force-commit. Effect A will reset index + scroll.
      setCommittedQuery(query)
    } else if (matchCount > 0) {
      // Already committed — navigate.
      if (e.shiftKey) prev()
      else            next()
    }
    e.preventDefault()
    return
  }
  // Otherwise just cancel the pending commit so a new keystroke resets
  // the 200ms window. (Esc is handled by Radix's onEscapeKeyDown — see Task 15.)
  clearTimeout(debounceRef.current)
}}
```

- [ ] **Step 4: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "feat: handle Enter/Shift+Enter for force-commit and nav"
```

---

## Task 15: Esc handling via Radix's `onEscapeKeyDown`

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Esc with non-empty query clears the query without closing the modal. Esc with empty query closes the modal (Radix default).

- [ ] **Step 1: Write the failing tests (against real Radix Dialog — no mocking)**

```tsx
describe('LogsModal — Esc handling', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('Esc with non-empty query clears the query and keeps modal open', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await user.type(input, 'Bash')
    await flushTimers(250)

    // Dispatch Esc on the dialog content (Radix listens at that level)
    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })

    expect(input.value).toBe('')
    // Dialog still open
    expect(screen.queryByRole('dialog')).toBeInTheDocument()
  })

  it('Esc with empty query closes the modal', async () => {
    setMockEvents([makeEvent(1, { foo: 'bar' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })

    // Radix unmounts the dialog
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: FAIL on the first test — Esc closes the modal even when query is non-empty.

- [ ] **Step 3: Add `onEscapeKeyDown` to `<DialogContent>`**

`DialogContent` spreads `...props` into `DialogPrimitive.Content`, so
`onEscapeKeyDown` flows through cleanly without needing forwardRef.

```tsx
<DialogContent
  onEscapeKeyDown={(e) => {
    if (query !== '') {
      e.preventDefault()
      setQuery('')
      setCommittedQuery('')
      clearTimeout(debounceRef.current)
    }
    // else: don't preventDefault, Radix closes as usual.
  }}
  aria-describedby={undefined}
  className="w-[90vw] max-w-5xl h-[85vh] flex flex-col p-0"
>
```

- [ ] **Step 4: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "feat: clear-then-close Esc handling via Radix onEscapeKeyDown"
```

---

## Task 16: Modal-close cleanup + unmount safety net

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Extend the existing close-effect to reset `query` + `committedQuery` so the search UI returns to its initial state on reopen. Add an unmount-only useEffect to delete CSS.highlights even when the close-effect doesn't run.

- [ ] **Step 1: Write the failing tests**

```tsx
describe('LogsModal — cleanup', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('clears highlights and query when modal closes via X', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await user.type(input, 'Bash')
    await flushTimers(250)
    expect((CSS as any).highlights.get('logs-search-all')).toBeDefined()

    // Click the close X (exact title — distinct from "Clear search")
    await user.click(screen.getByTitle('Close'))
    await act(async () => { await Promise.resolve() })

    expect((CSS as any).highlights.get('logs-search-all')).toBeUndefined()
    expect((CSS as any).highlights.get('logs-search-current')).toBeUndefined()

    // Reopen — query state is reset
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)
    const reopened = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    expect(reopened.value).toBe('')
  })

  it('clears highlights when LogsModal unmounts', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    const { unmount } = renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)
    expect((CSS as any).highlights.get('logs-search-all')).toBeDefined()

    unmount()
    expect((CSS as any).highlights.get('logs-search-all')).toBeUndefined()
    expect((CSS as any).highlights.get('logs-search-current')).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: FAIL on both tests.

- [ ] **Step 3: Extend the existing close-effect**

Find the existing `useEffect` keyed on `[open, events]` (around line 39–57 in the original) and update its close branch:

```ts
useEffect(() => {
  if (!open) {
    hasInitiallyLoaded.current = false
    setReadyEvents(null)
    setQuery('')
    setCommittedQuery('')
    clearTimeout(debounceRef.current)
    // Highlights are cleared by Effect A's empty-query branch when
    // committedQuery becomes ''.
    return
  }
  if (open && events) { /* ...existing logic... */ }
}, [open, events])
```

- [ ] **Step 4: Add the unmount-only safety net**

```ts
useEffect(() => {
  return () => {
    if ('highlights' in CSS) {
      CSS.highlights.delete('logs-search-all')
      CSS.highlights.delete('logs-search-current')
    }
  }
}, [])
```

- [ ] **Step 5: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -40`
Expected: PASS.

- [ ] **Step 6: Type-check**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.tsx app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "feat: reset search state on modal close and clean up on unmount"
```

---

## Task 17: Streaming-while-searching regression test

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

The "current match" pointer must not snap to #1 when new events stream in mid-search. The implementation already handles this via `lastBuiltQueryRef` + clamp-vs-reset; this task pins the behavior with a test.

- [ ] **Step 1: Write the regression test**

Add to `logs-modal.test.tsx`:

```tsx
describe('LogsModal — streaming while searching', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('does NOT reset currentMatchIndex when new events stream in', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
      makeEvent(3, { tool_name: 'Bash' }),
    ])
    const { rerender } = renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)
    expect(screen.getByText('1/3')).toBeInTheDocument()

    // Advance to match #2
    await pressEnter(input)
    expect(screen.getByText('2/3')).toBeInTheDocument()

    // New event streams in (mock change + rerender)
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
      makeEvent(3, { tool_name: 'Bash' }),
      makeEvent(4, { tool_name: 'Bash' }),
    ])
    rerender(<LogsModal />)
    await flushTimers(0)

    // currentMatchIndex stays at 2 (1-indexed display), matchCount goes to 4
    expect(screen.getByText('2/4')).toBeInTheDocument()
  })

  it('DOES reset currentMatchIndex on a new query', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)
    await pressEnter(input)  // advance to 2/2
    expect(screen.getByText('2/2')).toBeInTheDocument()

    // Replace the query
    await user.clear(input)
    await user.type(input, 'tool_name')
    await flushTimers(250)

    expect(screen.getByText('1/2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify pass (no implementation needed if the spec was followed)**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS — Effect A's clamp-vs-reset logic already handles this.

If they FAIL, recheck Task 9's `setCurrentMatchIndex` updater for the `isNewQuery` branch.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "test: pin streaming-while-searching index behavior"
```

---

## Task 18: Indented-JSON match test

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Pins the `JSON.stringify(_, null, 2)` index parity — guards against silently regressing the cheap-skip when someone changes one stringify and not the other.

- [ ] **Step 1: Write the test**

```tsx
describe('LogsModal — indented-JSON parity', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('matches a query that exists only in the indented JSON form', async () => {
    setMockEvents([makeEvent(1, { foo: 1 })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    // `"foo": 1` (with space after colon) appears in indented JSON,
    // not in flat JSON `{"foo":1}`. The cheap-skip must use the same
    // form as what's rendered.
    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, '"foo": 1')
    await flushTimers(250)

    expect(screen.getByText('1/1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "test: pin indented-JSON parity in search index"
```

---

## Task 19: 1000-match cap test

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
describe('LogsModal — match cap', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('caps match count at 1000 and renders 1/1000+', async () => {
    // Build an event whose payload contains "x" 5000 times so a
    // single-character query produces well over 1000 matches.
    const longString = 'x'.repeat(5000)
    setMockEvents([makeEvent(1, { data: longString })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'x')
    await flushTimers(250)

    expect(screen.getByText('1/1000+')).toBeInTheDocument()
    const all = (CSS as any).highlights.get('logs-search-all')
    expect(all.size).toBe(1000)
  })
})
```

- [ ] **Step 2: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "test: pin 1000-match cap and 1000+ display"
```

---

## Task 20: Scroll-on-intent test

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

The reviewer flagged this explicitly: a streaming rebuild must not call `scrollMatchIntoView`. Spy on `scrollBy` on the modal scroller and assert.

- [ ] **Step 1: Write the test**

```tsx
describe('LogsModal — scroll-on-intent', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  // Patch Element.prototype.scrollBy globally so we capture every
  // scroll attempt without iterating individual elements (which is
  // fragile against DOM changes during the test).
  function spyScrollBy() {
    const spy = vi.fn()
    const original = Element.prototype.scrollBy
    Element.prototype.scrollBy = function patched(this: Element, opts?: ScrollToOptions) {
      spy(opts)
      // Don't invoke original — jsdom's no-op scrollBy is a function but
      // calling it requires layout that jsdom doesn't compute.
    } as typeof Element.prototype.scrollBy
    return {
      spy,
      restore: () => { Element.prototype.scrollBy = original },
    }
  }

  it('does NOT scroll on a streaming rebuild that does not change index', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    const { rerender } = renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)

    // Attach spy AFTER the initial scroll for match #1.
    const { spy, restore } = spyScrollBy()
    try {
      // Stream a new event in
      setMockEvents([
        makeEvent(1, { tool_name: 'Bash' }),
        makeEvent(2, { tool_name: 'Bash' }),
        makeEvent(3, { tool_name: 'Read' }),
      ])
      rerender(<LogsModal />)
      await flushTimers(0)

      // matchCount stays at 2 (new event doesn't match), index stays at 0.
      expect(screen.getByText('1/2')).toBeInTheDocument()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('DOES scroll when next is pressed', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)

    const { spy, restore } = spyScrollBy()
    try {
      await pressEnter(input)
      expect(spy).toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})
```

- [ ] **Step 2: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS.

If the streaming-no-scroll test fails, recheck Task 9's `scrollOnNextPaintRef.current = true` is only set when `isNewQuery`, NOT on every rebuild.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "test: pin scroll-on-intent vs no-scroll-on-stream behavior"
```

---

## Task 21: Abort race test

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
describe('LogsModal — abort race', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('discards results from a superseded query', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),     // matches "B" and "Bash"
      makeEvent(2, { tool_name: 'BashRun' }),  // matches "B" and "Bash"
    ])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    // First commit "B"
    await user.type(input, 'B')
    await flushTimers(250)

    // Quickly switch to "Bash" — the second commit must replace the first.
    await user.type(input, 'ash')
    await flushTimers(250)

    // Final state reflects "Bash" — not "B".
    expect((input as HTMLInputElement).value).toBe('Bash')
    expect(screen.getByText(/\d+\/\d+/)).toBeInTheDocument()
    // 2 matches for Bash (one in each event)
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS — Effect A's cleanup aborts the previous build's `ctrl`.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "test: pin abort behavior across rapid query changes"
```

---

## Task 22: rebuildEpoch re-paint test

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Verifies Effect B re-runs after a rebuild even when matchCount and currentMatchIndex stay the same — needed to ensure `logs-search-current` paints against the new Range, not a stale one.

- [ ] **Step 1: Write the test**

```tsx
describe('LogsModal — rebuildEpoch', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('re-paints logs-search-current when streaming rebuild keeps same match count and index', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
    ])
    const { rerender } = renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await user.type(input, 'Bash')
    await flushTimers(250)

    const before = (CSS as any).highlights.get('logs-search-current')
    expect(before).toBeDefined()

    // Stream in a non-matching event — matchCount + index unchanged
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
      makeEvent(3, { tool_name: 'Read' }),
    ])
    rerender(<LogsModal />)
    await flushTimers(0)

    const after = (CSS as any).highlights.get('logs-search-current')
    expect(after).toBeDefined()
    // Effect B re-ran — it always constructs a new Highlight, so this
    // is a fresh object reference even though matchCount/index didn't
    // change. Without rebuildEpoch, `after` would be the same reference
    // as `before`.
    expect(after).not.toBe(before)
  })
})
```

- [ ] **Step 2: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "test: pin rebuildEpoch re-paint behavior"
```

---

## Task 23: Browser-degrade guard

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.tsx`
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

Already implemented as `if (!('highlights' in CSS)) return` at the top of Effect A, Effect B, and the document keydown effect. This task adds a test that verifies the component doesn't crash when `'highlights' in CSS === false`.

- [ ] **Step 1: Write the test**

```tsx
describe('LogsModal — browser degrade', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => {
    vi.useRealTimers()
    // Restore in case the test modified CSS.highlights
    if (!('highlights' in CSS)) {
      ;(CSS as any).highlights = new Map()
    }
  })

  it('does not crash when CSS.highlights is unavailable', async () => {
    // Simulate an old browser
    const original = (CSS as any).highlights
    delete (CSS as any).highlights

    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    // Typing should not throw
    await user.type(input, 'Bash')
    await flushTimers(250)

    // Restore for afterEach cleanup
    ;(CSS as any).highlights = original
  })
})
```

- [ ] **Step 2: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS — all three guarded effects bail early.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "test: verify modal degrades gracefully without CSS.highlights"
```

---

## Task 24: Paste + IME composition tests

**Files:**
- Modify: `app/client/src/components/main-panel/logs-modal.test.tsx`

The spec calls these out as required regression guards. Both behaviors are
already supported by the implementation (debounce is driven off `onChange`,
which fires for paste/programmatic edits; IME is gated by `isComposingRef`).
This task pins them.

- [ ] **Step 1: Write the tests**

```tsx
describe('LogsModal — paste & IME', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('debounces commit when input value is set via paste (no keydown/keyup)', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    // Simulate a paste — fire change directly with no preceding keydown/keyup.
    fireEvent.change(input, { target: { value: 'Bash' } })
    expect(input.value).toBe('Bash')
    // Counter not yet visible (debounce window)
    expect(screen.queryByText('1/1')).not.toBeInTheDocument()
    // After 200ms, commit fires
    await flushTimers(250)
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('does NOT commit during IME composition; commits on compositionend', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    await user.click(screen.getByTitle(/view raw event logs/i))
    await screen.findByText(/raw event logs/i)
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement

    // Start composition. Fire change events for partial composing text —
    // these must NOT schedule a commit.
    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'B' } })
    fireEvent.change(input, { target: { value: 'Ba' } })
    fireEvent.change(input, { target: { value: 'Bash' } })
    await flushTimers(250)
    // No commit while composing
    expect(screen.queryByText('1/1')).not.toBeInTheDocument()

    // End composition — schedules a commit
    fireEvent.compositionEnd(input, { data: 'Bash' })
    await flushTimers(250)
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run and verify pass**

Run: `cd app/client && npm test -- logs-modal 2>&1 | tail -30`
Expected: PASS — `onChange`-driven debounce handles paste; `isComposingRef` blocks IME mid-stream.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/main-panel/logs-modal.test.tsx
git commit -m "test: pin paste-bypass-debounce and IME composition behaviors"
```

---

## Task 25: Final integration check

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd app/client && npm test 2>&1 | tail -40`
Expected: all tests pass, no console warnings about act() or unmounted components.

- [ ] **Step 2: Run the full project check**

Run: `just check`
Expected: tests pass + formatter clean.

- [ ] **Step 3: Manually verify in dev mode**

Run: `just dev` in one terminal. Open `http://localhost:5174` in a browser. Navigate to a session with at least 50 events.

Walk through this checklist:

- [ ] Open the Raw Event Logs modal — search input visible in header.
- [ ] Type "Bash" — after ~200ms, matches highlight in yellow with one in orange.
- [ ] Counter shows "1/N" — N is correct.
- [ ] Press Cmd+G — orange highlight moves to next match, viewport scrolls to center it.
- [ ] Press Cmd+Shift+G — orange moves backward.
- [ ] Press Enter on focused input — same as Cmd+G.
- [ ] Press Shift+Enter on focused input — same as Cmd+Shift+G.
- [ ] Click ▲ ▼ buttons — same nav.
- [ ] Click ✕ — query clears, highlights gone, counter gone.
- [ ] Type a query that exists only inside a tall payload (>240px). Press Cmd+G repeatedly — viewport tracks each match smoothly.
- [ ] Type "x" (single char) on a session with many events — counter shows `1/1000+` if >1000 matches, otherwise the real count.
- [ ] With a query active, watch a session that's actively streaming new events — current-match pointer doesn't snap to #1; counter denominator updates as new matches arrive.
- [ ] Close the modal (X button or Esc with empty query) — reopen — query starts empty, no leftover highlights.
- [ ] Press Esc with non-empty query — query clears, modal stays open. Press Esc again — modal closes.
- [ ] Test under both light and dark themes — yellow/orange contrast is readable.

- [ ] **Step 4: If everything checks out, no commit needed**

The previous task commits cover the implementation.

---

## Self-Review Checklist (for the implementer to glance at before final commit)

1. **Spec coverage:** Each section of `2026-05-08-logs-modal-search-design.md` maps to at least one task — State (Task 9 + others), debounce (Task 5), Effect A (Task 9), Effect B (Task 10), Cmd+G (Task 13), Esc (Task 15), cleanup (Task 16), tests (Tasks 17–22), browser-degrade (Task 23). ✓
2. **No placeholders:** Every step shows actual code or a precise command. ✓
3. **Type consistency:** `Match`, `buildMatches`, `scrollMatchIntoView`, `scrollOnNextPaintRef`, `lastBuiltQueryRef`, `nextRef`, `prevRef`, `rebuildEpoch`, `matchesRef` — names used identically across tasks. ✓
4. **Test coverage of regression-guard concerns:** streaming-no-reset (T17), indented-JSON parity (T18), 1000-cap (T19), scroll-on-intent (T20), abort race (T21), rebuildEpoch (T22), browser-degrade (T23). ✓
