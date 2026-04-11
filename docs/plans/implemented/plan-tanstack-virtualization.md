# Implementation Plan: TanStack Virtualization for Event Stream

## Goal

Virtualize the event stream so sessions with thousands of events render instantly and scroll smoothly. Only the events in (and near) the viewport are mounted in the DOM at any time.

## Library

`@tanstack/react-virtual` — same authors as react-query, well-maintained, supports dynamic row heights via `measureElement`, headless (we control all the markup).

## Scope

- **In:** The event stream component
- **Out:** Sidebar session list (already paginated via collapsible groups), timeline rewind dots (absolute-positioned, not a row list)

## Key challenges & solutions

### 1. Dynamic row heights
Event rows vary from ~36px (collapsed) to 200-800px (expanded with markdown / payload / diffs). `react-virtual` supports this via `measureElement`:

```tsx
const virtualizer = useVirtualizer({
  count: filteredEvents.length,
  getScrollElement: () => scrollRef.current,
  estimateSize: () => 36, // base row height
  overscan: 10,
})

// On each row:
<div ref={virtualizer.measureElement} data-index={idx} ...>
```

`measureElement` uses ResizeObserver internally — real height is captured after mount and fed back into the virtualizer.

**Optimization path (if needed later):** Rows can cache their own measurements and short-circuit `measureElement` for expanded rows.

### 2. Auto-scroll to bottom (autoFollow)
Current: `scrollRef.current.scrollTop = scrollHeight`
New: `virtualizer.scrollToIndex(filteredEvents.length - 1, { align: 'end' })`

### 3. Scroll-to-event (timeline dot click)
Current: DOM `scrollIntoView` + IntersectionObserver for flash
New:
- `virtualizer.scrollToIndex(idx, { align: 'center' })`
- Track `flashingEventId` in ui-store
- EventRow reads `isFlashing = useUIStore(s => s.flashingEventId === event.id)` and applies the flash class via React state instead of DOM classList
- Clear flash state on animationend via `setFlashingEventId(null)`

### 4. Scroll sync in rewind mode
Current: `container.querySelectorAll('[data-event-row]')` iterates DOM rows to find first visible. With virtualization, most rows aren't in the DOM.

New approach: iterate `virtualizer.getVirtualItems()` to find the first item where `virtualItem.start + virtualItem.size > container.scrollTop`, then read `filteredEvents[virtualItem.index].timestamp`. This is data-driven, not DOM-driven, and works regardless of what's mounted.

The reverse sync (timeline → event stream) already works via binary search on the events array + `virtualizer.scrollToIndex`.

### 5. `eventRowRefs` map
The current code maintains a map of event.id → DOM element for scrollToEventId resolution. With virtualization, rows can unmount and remount, invalidating the refs. Remove the ref map entirely — use `scrollToIndex` instead.

## Implementation phases

**Phase 1: Install + basic virtualization** (~45 min)
- `npm install @tanstack/react-virtual`
- Set up `useVirtualizer` in EventStream
- Replace the flat `.map()` with virtualized rendering
- Use `measureElement` for dynamic heights
- Keep auto-scroll to bottom (simple DOM approach — fix in Phase 2)
- Verify: large sessions render fast

**Phase 2: Auto-scroll + scroll-to-event** (~30 min)
- Replace scrollTop mutations with `virtualizer.scrollToIndex`
- Update autoFollow to use scrollToIndex
- Update scroll-to-event (selectedEventId on filter change) to use scrollToIndex

**Phase 3: Flash animation via state** (~30 min)
- Add `flashingEventId` to ui-store (or reuse scrollToEventId pattern)
- EventRow applies flash class conditionally via React, not classList
- Clear flash on animationend via setFlashingEventId(null)
- Remove the IntersectionObserver flash logic

**Phase 4: Rewind mode scroll sync** (~30 min)
- Replace DOM-based first-visible detection with virtualItem iteration
- Test: bidirectional sync still works in rewind mode

**Phase 5: Cleanup + testing** (~30 min)
- Remove `eventRowRefs` map and `onRowRef` prop from EventRow
- Update EventRow tests if needed
- Full test suite pass
- Manual test with large session

## Estimated effort: ~3 hours

## Risks

- **Measure thrashing** — if many rows expand at once, lots of ResizeObserver callbacks. Monitor in DevTools. Mitigate with `overscan` tuning or memoized row components.
- **Scroll jank during measure** — initial mount of a row with a very tall expanded state may cause one frame of scrollbar jump. Usually imperceptible.
- **Test environment** — JSDOM doesn't implement `ResizeObserver` or measure layout. Existing tests might need mocks or updated expectations.
