# Logs Modal Search — Design

Date: 2026-05-08
Status: Draft (awaiting user review)

## Problem

The Raw Event Logs modal (`app/client/src/components/main-panel/logs-modal.tsx`)
renders every event's payload as a `<pre>`-formatted JSON block. Users
have no way to find a specific value (a tool name, a file path, an
error string) inside the rendered logs short of `Cmd+F`-ing the
browser, which works only against text actually painted on screen and
gives no match navigation tuned to the data shape.

We want an in-modal search that:

- Searches the raw payload JSON across all events.
- Stays responsive while the user types (no jank on long sessions).
- Mirrors browser Find conventions for navigation so users don't have
  to learn a new keymap.
- Doesn't leak memory across modal opens or query changes.

## Goal

Add a search input to the modal header that highlights every match
across all events' payloads, with a "current match" pointer the user
can step through with keyboard or buttons. Non-matching events stay
visible — search highlights, it does not filter.

## Non-goals

- **No filtering.** Hiding non-matches confuses users when they're
  trying to read the surrounding event stream; we only highlight.
- **No regex / case toggle / whole-word.** Substring,
  case-insensitive only. Add later if requested.
- **No persistence.** Query resets when the modal closes.
- **No global Cmd+F hijacking.** Browser Find is untouched. Our
  shortcuts only activate while a search query is committed.
- **No worker / off-main-thread search.** A pre-stringified array is
  fast enough on the main thread for the session sizes this dashboard
  handles (typical ≤ a few thousand events).
- **No changes to how payloads render at rest.** The existing
  `max-h-60 overflow-y-auto` on each `<pre>` is preserved; we walk
  nested scrollers when jumping to a match instead of expanding pres.

## Architecture

Single-file change to `logs-modal.tsx` plus a small addition to
`app/client/src/index.css` for the highlight pseudo-element styling.
No store or API changes.

### State (all local to `LogsModal`)

```ts
const [query, setQuery] = useState('')                 // controlled input value
const [committedQuery, setCommittedQuery] = useState('')// debounced; drives search
const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
const [matchCount, setMatchCount] = useState(0)        // capped at 1000
const [rebuildEpoch, setRebuildEpoch] = useState(0)    // increments on every Effect A
                                                       //   build; lets Effect B re-paint the
                                                       //   "current" highlight against the
                                                       //   *new* Range when matchCount and
                                                       //   currentMatchIndex don't change

const debounceRef       = useRef<ReturnType<typeof setTimeout>>(undefined)
const isComposingRef    = useRef(false)                // IME composition guard
const lastBuiltQueryRef = useRef('')                   // tracks committedQuery used for the
                                                       //   matchesRef snapshot — lets Effect A
                                                       //   tell "new search" from "events streamed in"
const preRefs           = useRef<Map<number, HTMLPreElement>>(new Map())
                                                       // eventId → <pre> element; entries cleared
                                                       //   in the ref-callback when an event unmounts
const dialogContentRef  = useRef<HTMLDivElement>(null) // wired to <DialogContent ref={...}>;
                                                       //   used by the modal-wide Cmd+G listener
                                                       //   to verify keydown originated inside
                                                       //   this dialog (defends against stacked
                                                       //   dialogs / portals)
```

`AbortController` is **not** stored in a shared ref — each Effect A run owns its
own `ctrl` in closure scope, and the effect's cleanup function aborts it. This
prevents the back-to-back-keypress hazard where one effect's `ctrl.abort()`
would target the next effect's build.

### Pre-computed search index

```ts
const searchIndex = useMemo(
  () => readyEvents?.map((e) => JSON.stringify(e.payload, null, 2).toLowerCase()) ?? [],
  [readyEvents],
)
```

The `null, 2` indent **must match what's rendered in the `<pre>`**
(`logs-modal.tsx:197`). If the index uses unindented JSON, the cheap-skip
will incorrectly reject events when the query contains spaces or newlines
that only exist in the indented form (e.g. `"foo": 1` matches indented
output but not flat). Keep the two `JSON.stringify` calls in lockstep.

Memory: ~payload-size × event-count; for a 5k-event session at
~1KB/payload that's ~5MB, GC'd when `readyEvents` is reset to `null` on
modal close.

### Debounce + cancel-on-keydown

The user's stated intent — "wait 200ms after keyup before executing,
stop searching on keydown, remain responsive" — is achieved by
debouncing on **value change** (which catches paste, autofill, IME
composition end, drag-drop, programmatic edits as well as typing) and
canceling the pending fire on `keydown` (which keeps the input feeling
responsive while typing fast).

```ts
function scheduleCommit(next: string) {
  clearTimeout(debounceRef.current)
  if (next === '') {
    setCommittedQuery('')                             // empty: clear immediately
    return
  }
  if (isComposingRef.current) return                  // IME mid-composition
  debounceRef.current = setTimeout(() => setCommittedQuery(next), 200)
}

// onChange — fires for typing, paste, autofill, programmatic
function onChange(e: React.ChangeEvent<HTMLInputElement>) {
  setQuery(e.target.value)
  scheduleCommit(e.target.value)
}

// onKeyDown — preserves "feels responsive while typing" by cancelling
// the pending commit BEFORE the new value arrives via onChange.
// Does NOT abort in-flight builds — that's Effect A's cleanup job, and
// doing it here would race against back-to-back keypresses creating a
// new effect.
// Esc is NOT handled here — it's wired via Radix's onEscapeKeyDown
// on DialogContent (see Keyboard bindings below).
function onKeyDown(e: React.KeyboardEvent) {
  // ... Enter handling (force-commit + next/prev) — see Keyboard bindings
  clearTimeout(debounceRef.current)
}

// IME composition — block scheduling during composition, schedule once on end
function onCompositionStart() { isComposingRef.current = true }
function onCompositionEnd(e: React.CompositionEvent<HTMLInputElement>) {
  isComposingRef.current = false
  scheduleCommit((e.target as HTMLInputElement).value)
}
```

**Force-commit on Enter** (closes the 200ms-after-typing dead window so
the user can type and immediately press Enter to jump to the first
match):

```ts
// inside onKeyDown
if (e.key === 'Enter') {
  clearTimeout(debounceRef.current)
  if (query !== committedQuery) {
    setCommittedQuery(query)                          // force-commit
    // Effect A will reset currentMatchIndex to 0; Effect B scrolls.
    e.preventDefault()
    return
  }
  // already committed — fall through to Next/Prev nav (see Keyboard bindings)
}
```

### Highlight via CSS Custom Highlight API

```css
/* index.css — added once */
::highlight(logs-search-all)     { background-color: rgb(250 204 21 / 0.35); }
::highlight(logs-search-current) { background-color: rgb(249 115 22 / 0.75); color: black; }
```

Two effects with disjoint responsibilities. Splitting them keeps the
expensive DOM walk out of the navigation hot path.

**Effect A — build the match list.** Runs when `committedQuery` or
`readyEvents` change. Walks the DOM, stores the resulting `matches[]`
in a ref, paints `logs-search-all`, and either resets or clamps
`currentMatchIndex` depending on what triggered the rebuild.

```ts
const matchesRef = useRef<Match[]>([])

useEffect(() => {
  if (!('highlights' in CSS)) return              // graceful degrade

  if (!committedQuery || !readyEvents) {
    CSS.highlights.delete('logs-search-all')
    CSS.highlights.delete('logs-search-current')
    matchesRef.current = []
    setMatchCount(0)
    setCurrentMatchIndex(0)
    setRebuildEpoch((e) => e + 1)                   // uniform: every Effect A run bumps the
                                                     //   epoch, including teardown. Defends
                                                     //   against the corner case where
                                                     //   matchCount + index were both already
                                                     //   0 from a zero-match query.
    lastBuiltQueryRef.current = ''
    return
  }

  const ctrl = new AbortController()              // closure-scoped, NOT in a shared ref

  buildMatches(committedQuery, readyEvents, searchIndex, preRefs.current, ctrl.signal)
    .then((matches) => {
      if (ctrl.signal.aborted) return

      const isNewQuery = committedQuery !== lastBuiltQueryRef.current

      // Order matters: write matchesRef BEFORE state updates that may
      // synchronously re-render and run Effect B. Effect B reads from
      // matchesRef.current, so it must hold the new array first.
      matchesRef.current = matches
      lastBuiltQueryRef.current = committedQuery

      setMatchCount(matches.length)
      setRebuildEpoch((e) => e + 1)                   // forces Effect B to re-run even
                                                       //   when matchCount + index unchanged

      // New query → reset to first match AND request a scroll.
      // Same query (events streamed in) → clamp the existing pointer
      //   so the user's "where they were" doesn't snap to #1 on every
      //   incoming event, and DON'T scroll.
      setCurrentMatchIndex((prev) => {
        if (matches.length === 0) return 0
        if (isNewQuery) {
          scrollOnNextPaintRef.current = true
          return 0
        }
        return Math.min(prev, matches.length - 1)
      })

      // Replace logs-search-all atomically. Range objects from the
      // previous build are released for GC when the Highlight is
      // overwritten. Build incrementally with .add() rather than
      // spread args — Highlight is Set-like and .add() is the most
      // universally supported way to populate it (some Safari versions
      // were finicky about spread-into-constructor).
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
    ctrl.abort()                                  // cancels in-flight buildMatches
    // Note: don't delete highlights here. When the rebuild was caused
    // by readyEvents streaming in, deleting would cause a flicker
    // (the next paint comes after the new buildMatches resolves —
    // tens of ms). The next .then either overwrites or (on empty
    // results) explicitly deletes.
  }
}, [committedQuery, readyEvents, searchIndex])

// Unmount-only cleanup. CSS.highlights is global state and must be
// torn down when LogsModal goes away, even if Effect A's body never
// runs the empty-query branch (e.g. user closes the dashboard tab
// with the modal open).
useEffect(() => {
  return () => {
    if ('highlights' in CSS) {
      CSS.highlights.delete('logs-search-all')
      CSS.highlights.delete('logs-search-current')
    }
  }
}, [])
```

**Effect B — paint current + scroll.** Runs when `currentMatchIndex`
or `matchCount` change. No DOM walk, no `buildMatches` re-run.

A `scrollOnNextPaintRef` flag separates "user wants to jump to a
match" (new search, next, prev) from "rebuild caused by streaming
events." Without this flag, every incoming event would yank the
viewport back to the current match while the user is reading.

```ts
const scrollOnNextPaintRef = useRef(false)

useEffect(() => {
  if (!('highlights' in CSS)) return
  const matches = matchesRef.current
  if (matches.length === 0) {
    CSS.highlights.delete('logs-search-current')
    scrollOnNextPaintRef.current = false
    return
  }
  const idx = Math.min(currentMatchIndex, matches.length - 1)
  const current = new Highlight(matches[idx].range)
  current.priority = 1
  CSS.highlights.set('logs-search-current', current)

  if (scrollOnNextPaintRef.current) {
    scrollMatchIntoView(matches[idx].range)
    scrollOnNextPaintRef.current = false
  }
}, [currentMatchIndex, matchCount, rebuildEpoch])
```

`rebuildEpoch` is in the deps so Effect B re-runs after every Effect A
build, even when `matchCount` and `currentMatchIndex` happen to be
unchanged. Without it, `logs-search-current` could keep painting a
Range from the previous build's `matches[]` after `matchesRef.current`
has been replaced with new Range objects — visually fine if the
underlying text nodes are stable (today they are), but a latent
correctness issue if a future change ever invalidates them.

The flag is set in three places (and only there):

1. Effect A's `.then`, when `isNewQuery === true`. New search → scroll
   to the first match.
2. `next()` callback. User pressed next → scroll to the new match.
3. `prev()` callback. Same.

Streaming rebuilds don't touch the flag; Effect B paints the same
Range (cheap, invisible) but does not scroll.

### Match list lifecycle

`matches: { eventId: number; range: Range }[]` is held in a ref, not
state, because Range objects are tied to live DOM and shouldn't be
serialised through React's render cycle. Triggers for rebuild:

1. `committedQuery` changes (new search) — reset index to 0, scroll.
2. `readyEvents` identity changes (events streamed in) — clamp index,
   do not scroll.

`currentMatchIndex` changing does NOT rebuild matches — it only repaints
`logs-search-current` and (via `scrollOnNextPaintRef`) optionally
scrolls.

When `committedQuery` clears (empty input or modal close cascading
through `setReadyEvents(null)`), the ref is reset to `[]` and both
highlights are deleted via Effect A's empty-query branch.

### Building the match list

```ts
async function buildMatches(
  query: string,
  events: ParsedEvent[],
  index: string[],                                 // same length & order as events
  preMap: Map<number, HTMLPreElement>,
  signal: AbortSignal,
): Promise<Match[]> {
  const lower = query.toLowerCase()
  const out: Match[] = []
  const CAP = 1000

  // Iterate in event order so the resulting matches[] is in document
  // order — Next/Prev wrap-around then matches user expectation.
  for (let i = 0; i < events.length; i++) {
    if (signal.aborted) return out
    if (out.length >= CAP) break

    if (!index[i].includes(lower)) continue        // cheap skip
    const event = events[i]

    const pre = preMap.get(event.id)
    if (!pre) continue

    // Walk siblings rather than assume firstChild is the text node.
    // React ~always renders `<pre>{string}</pre>` as a single Text node,
    // but DevTools or future Suspense markers could insert a comment
    // node before it. If a future change wraps the JSON in a
    // syntax-highlighter component, this loop will silently produce
    // zero matches per event — re-evaluate the whole approach in that
    // case (probably switch to walking <span> children).
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

    // Yield by event index so a long no-match scan still gets aborted
    // quickly. requestAnimationFrame gives the abort signal time to
    // propagate and lets the next keystroke land first.
    if (i > 0 && i % 500 === 0) {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    }
  }
  return out
}
```

The `searchIndex.includes(lower)` cheap-skip handles the common case
(most events don't match) without walking text nodes. The Range walk
inside a matching `<pre>` is a simple `while (indexOf)` loop because
the only meaningful child is one Text node — JSON.stringify produces
no element children, and the sibling-walk above tolerates any stray
non-Text nodes (Suspense markers, DevTools comments).

The 1000-match cap protects against single-character queries that
would otherwise create tens of thousands of Ranges. When hit, the
counter renders as `i/1000+`.

### Scrolling to current match

The existing `<pre>` blocks have `max-h-60 overflow-y-auto`, so a
match deep in a tall payload could be hidden by the inner scroll. We
walk both scroll ancestors:

```ts
function scrollMatchIntoView(range: Range) {
  const text = range.startContainer as Text
  const pre  = text.parentElement?.closest('pre') as HTMLElement | null
  const outer = scrollRef.current                           // existing modal scroller

  // Centering: we want the range's vertical mid-point to align with
  // the container's vertical mid-point. Delta = rangeMid - containerMid.
  //   rangeMid     = rangeRect.top + rangeRect.height / 2
  //   containerMid = containerRect.top + containerRect.height / 2

  // 1. Inner pre's scroll. Pass behavior:'instant' explicitly so a
  // future global `scroll-behavior: smooth` rule can't break the
  // sync re-measurement below.
  if (pre) {
    const rangeRect = range.getBoundingClientRect()
    const preRect   = pre.getBoundingClientRect()
    const delta = (rangeRect.top + rangeRect.height / 2)
                - (preRect.top + preRect.height / 2)
    pre.scrollBy({ top: delta, behavior: 'instant' })
  }

  // 2. Outer modal scroll — re-measure after inner scroll. scrollBy
  // with 'instant' synchronously updates scrollTop and the next
  // getBoundingClientRect() reflects it.
  if (outer) {
    const rangeRect  = range.getBoundingClientRect()
    const outerRect  = outer.getBoundingClientRect()
    const delta = (rangeRect.top + rangeRect.height / 2)
                - (outerRect.top + outerRect.height / 2)
    outer.scrollBy({ top: delta, behavior: 'instant' })
  }
}
```

`behavior: 'instant'` is explicit — smooth scrolling through 50+ matches
on rapid Cmd+G presses feels sluggish, and a smooth scroll would also
break the inner→outer math by leaving stale rects.

### Floating navigation bar

In the modal header (currently: title • count • copy • download •
scroll-to-bottom • close), insert a search cluster on the right:

```
┌───────────────────────────────────────────────────────────────┐
│ Raw Event Logs   142 events    [🔍 Search payloads…__]  3/47 ▲ ▼ ✕   [⎘] [⬇] [↓] [✕] │
└───────────────────────────────────────────────────────────────┘
```

- `[🔍 Search payloads…]`: always present; mirrors `event-filter-bar`'s
  styling (icon, green border when non-empty, `pr-7`).
- `3/47 ▲ ▼ ✕`: only renders when `committedQuery !== ''`.
- `0 matches`: shown in muted/destructive color when query has zero
  hits (replaces the counter).
- `1/1000+`: shown when the cap is hit. The `+` means "1000 matches
  found, search was capped — refine your query for an exact count."
- `▲` (Up): previous match. `▼` (Down): next match. Both disabled
  when `matchCount === 0`.
- `✕`: clears `query` + `committedQuery`, returns focus to input.

**Pre ref-callback** — must handle unmount so the map doesn't leak entries
for events that have been replaced:

```tsx
<pre
  ref={(el) => {
    if (el) preRefs.current.set(event.id, el)
    else    preRefs.current.delete(event.id)
  }}
  ...
>
```

### Keyboard bindings

| Key | Action | Listener scope |
|---|---|---|
| `Enter` (with uncommitted change) | Force-commit query | Search input only |
| `Enter` (already committed) | Next match | Search input only |
| `Shift+Enter` | Previous match | Search input only |
| `Cmd/Ctrl+G` | Next match | Modal-wide, `committedQuery !== ''` only |
| `Cmd/Ctrl+Shift+G` | Previous match | Modal-wide, `committedQuery !== ''` only |
| `Esc` (`query !== ''`) | Clear query, keep modal open | Radix `DialogContent.onEscapeKeyDown` |
| `Esc` (`query === ''`) | Close modal (Radix default) | Radix `DialogContent.onEscapeKeyDown` |

The modal-wide listeners are attached via a `useEffect` whose body
is a no-op when `committedQuery === ''` — listeners are physically
absent from `document` when there's no committed query, so browser
defaults run untouched. (The user is concerned about hijacking
browser shortcuts; this guarantees we never do.)

`prev`/`next` are accessed through refs inside the listener so
re-creating those callbacks (which happens whenever `matchCount`
changes) doesn't tear down and re-attach the document listener:

```ts
const nextRef = useRef(next)
const prevRef = useRef(prev)
useEffect(() => {
  nextRef.current = next
  prevRef.current = prev
}, [next, prev])

useEffect(() => {
  if (committedQuery === '' || !open) return       // no listener attached
  if (!('highlights' in CSS)) return

  function onDocKeyDown(e: KeyboardEvent) {
    // Use `e.code` not `e.key` — Shift+G yields `key === 'G'` (uppercase)
    // on macOS, breaking a naive `e.key === 'g'` check.
    if (e.code !== 'KeyG') return
    if (!(e.metaKey || e.ctrlKey)) return

    // Make sure the event came from inside the modal. Guards against
    // stacked dialogs / detached Portals handling the same key.
    const inModal = (e.target instanceof Node)
                 && dialogContentRef.current?.contains(e.target)
    if (!inModal) return

    e.preventDefault()                              // suppresses browser's Find Again
    if (e.shiftKey) prevRef.current()
    else            nextRef.current()
  }
  document.addEventListener('keydown', onDocKeyDown)
  return () => document.removeEventListener('keydown', onDocKeyDown)
}, [committedQuery, open])
```

**Esc handling — via Radix's `onEscapeKeyDown`, NOT input-level.**
React synthetic events `stopPropagation()` does not affect Radix's
internal `onEscapeKeyDown` listener (which is wired at the
`Dialog.Content` level on the native event). So an input-level
handler that calls `e.stopPropagation()` will NOT prevent Radix from
closing the modal. The clean fix is Radix's own escape hook:

```tsx
<DialogContent
  ref={dialogContentRef}
  onEscapeKeyDown={(e) => {
    if (query !== '') {
      e.preventDefault()                            // prevents Radix from closing
      setQuery('')
      setCommittedQuery('')
      clearTimeout(debounceRef.current)
    }
    // else: don't preventDefault, Radix closes the modal as usual.
  }}
  ...
>
```

This also moves the `dialogContentRef` wiring onto the same element —
required for the `Cmd+G` `inModal` check above.

The input's own `onKeyDown` does NOT need to handle Esc; Radix's
hook covers it.

**Next/previous behavior:**

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
```

Both are no-ops when `matchCount === 0`.

### Memory & cleanup

Cleanup is layered so each concern has exactly one owner:

1. **Effect A's cleanup** — aborts the in-flight `buildMatches`. Does
   NOT delete highlights (would cause flicker on a streaming-event
   rebuild).
2. **Effect A's body, empty-query branch** — when `committedQuery`
   becomes `''` or `readyEvents` becomes `null`, deletes both
   highlights, clears `matchesRef`, resets count + index +
   `lastBuiltQueryRef`. This is the path the close-effect rides:
   `setReadyEvents(null)` → Effect A re-runs → empty branch fires.
3. **Existing close-effect (lines 39–57 of `logs-modal.tsx`)** — already
   nulls `readyEvents`. Extend to also reset `query` and
   `committedQuery` to `''` so the search UI returns to its initial
   state when the modal reopens.
4. **`<pre>` ref-callback** — deletes its `preRefs` entry on unmount,
   keeping the map from accumulating stale element refs as events
   stream in.
5. **Unmount-only `useEffect([])`** — final safety net: deletes both
   `CSS.highlights` entries when the component is removed from the
   tree. Necessary because `CSS.highlights` is global and would
   otherwise leak past the component's lifetime.

What dies automatically:

- Range objects: GC'd when their containing `Highlight` is overwritten
  or deleted.
- `searchIndex`: tied to `readyEvents` via `useMemo`; recomputed when
  events change, GC'd when modal closes.
- `matchesRef.current`: set to `[]` in the empty-query branch.
- `debounceRef`'s timer: timer IDs become no-ops once cleared with
  `clearTimeout`; even an uncleared one only holds a closure on
  `setCommittedQuery`, which is harmless.

### Browser support

CSS Custom Highlight API is in Chrome 105+, Safari 17.2+, Firefox
140+. All three are evergreen and shipped before this dashboard's
target audience would meet it. The effect guards `if (!('highlights'
in CSS)) return`, degrading to "search input does nothing visually"
rather than crashing — acceptable fallback for the unlikely case of
an old browser.

## File changes

- `app/client/src/components/main-panel/logs-modal.tsx` — all logic,
  state, UI changes.
- `app/client/src/index.css` — two `::highlight(...)` rules.

No store, API, or schema changes.

## Testing

Component test (`logs-modal.test.tsx`):

**Debounce / commit:**

- Typing populates `query` immediately, `committedQuery` only after
  200ms.
- A keystroke during the debounce window resets the timer.
- `onChange` triggered by paste (no preceding keydown/keyup) still
  schedules a commit — covers the paste-bypass-debounce hazard.
- IME composition: keypresses dispatched between `compositionstart`
  and `compositionend` do NOT schedule a commit; the
  `compositionend`'s value does.
- Clearing the input (`✕` button or `Esc` with non-empty query)
  clears highlights synchronously.

**Matching / index:**

- Match counter reflects total matches across all events' payloads,
  using indented JSON. Specifically: a query containing a space (e.g.
  `"a": 1`) finds matches that exist only after `JSON.stringify(_, null, 2)`.
- `Enter` on uncommitted change force-commits (skip 200ms wait); on
  committed query advances `currentMatchIndex`. `Shift+Enter`
  retreats. Both wrap modulo `matchCount`.
- 1000-match cap: query that would match 5000 times yields exactly
  1000 ranges and `1/1000+` display.

**Streaming-while-searching (regression guard for finding #1):**

- With a non-empty committed query and `currentMatchIndex` at e.g. 7,
  appending a new event to `readyEvents` does NOT reset
  `currentMatchIndex` to 0. It clamps to `matches.length - 1` if the
  new event reduces total matches (rare; events are append-only
  today), otherwise stays at 7.
- A `committedQuery` change DOES reset `currentMatchIndex` to 0.
- A streaming rebuild does NOT call `scrollMatchIntoView`. Spy on
  `scrollBy` (or stub `scrollMatchIntoView`) and assert zero calls
  for an event-append that doesn't change `currentMatchIndex`.
- A new query DOES call `scrollMatchIntoView` exactly once (to
  match #0).
- **`rebuildEpoch` re-paint guard:** with a committed query and
  current match at index 3, simulate a streaming rebuild where the
  new build produces the same `matchCount` and the same
  `currentMatchIndex`. Assert `CSS.highlights.set('logs-search-current', _)`
  was called again (Effect B re-ran via `rebuildEpoch` change), so
  the painted Range is from the new `matchesRef.current`, not the
  stale one.

**Bindings activation:**

- Bindings are not active when `committedQuery === ''`: dispatching
  `Cmd+G` on the modal-wide listener path is a no-op (assert via no
  `document.dispatchEvent` capture, or by checking
  `currentMatchIndex` doesn't change).
- `Cmd+G` / `Cmd+Shift+G` use `e.code === 'KeyG'`; verify with both
  `key: 'g'` and `key: 'G'` (shift held).
- `Esc` with non-empty query clears the query and does NOT close the
  modal (Dialog stays open).
- `Esc` with empty query falls through and closes the modal (Dialog's
  default).
- **Esc tests must use the real Radix `Dialog` component**, not a
  mock. The bug we're guarding against (React synthetic
  `stopPropagation` failing to prevent Radix's native handler) only
  reproduces when Radix's actual `onEscapeKeyDown` wiring is in
  place. Mock-based tests would falsely pass.

**Abort race (regression guard for finding #3):**

- Type `"a"` (matches a lot) → wait less than 200ms → type `"abc"`.
  Assert that the final highlights are for `"abc"`, not `"a"`. (Even
  if `"a"`'s build resolves first, its `.then` should be aborted by
  Effect A's cleanup before writing to `matchesRef`.)

**Cleanup:**

- Modal close clears both named `CSS.highlights` entries.
- Component unmount (without prior modal close) clears highlights too.
- `preRefs` is empty after modal close.

Manual / browser test (no automated coverage practical):

- Highlight visibility under both light and dark themes.
- Scroll-to-current centering: with a payload taller than 240px,
  pressing Enter through several matches centers each one in the
  modal viewport.
- Modal-wide `Cmd+G` / `Cmd+Shift+G` while focus is in the payload
  area, not the search input.

## Open questions

None. All decisions taken in brainstorming:

- Highlight-only (no filter).
- Walk nested scrollers (no rendering changes at rest).
- 200ms debounce after keyup, cancel on keydown.
- 1000-match cap with `i/1000+` display.
- Browser-default keymap (Enter / Cmd+G next, Shift+Enter / Cmd+Shift+G prev).
- Bindings live only while `committedQuery !== ''`.
