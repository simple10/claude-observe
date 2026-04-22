# Session View Keyboard Shortcuts — Design

**Date:** 2026-04-22
**Status:** Approved (pending spec review)

## Problem

The session view is mouse-driven. Power users want to:

1. Jump focus to the four main interactive regions (search, agent combo box, filters, sidebar) with a single key.
2. Navigate within the sidebar and filter pill rows using arrow keys.
3. Reach every session in the sidebar via the keyboard at all (currently `SessionItem` is a non-focusable `<div onClick>`).

Tab is **not** modified — it must continue to behave as the browser default. This work only fixes places where Tab is currently broken (e.g. session items not in the tab order).

## Non-Goals

- No global Tab hijack or region-cycling.
- No `?` discoverability overlay (defer; can add later).
- No shortcut customization UI.
- No new dependencies — no `react-hotkeys-hook`, `tinykeys`, etc.
- No changes to the existing `Cmd+Up/Down/Home/End/PageUp/PageDown` event-stream scroll shortcuts.

## Hard Constraints

- **Must not break screen readers.** All changes either preserve existing semantics or improve them. Specifically: `role="button"` is added to make session items focusable, and `aria-current="true"` is set on the selected one — both improvements over the current `<div onClick>`. (`aria-current` is the WAI-ARIA spec for "the current item in a set", which is exactly what a selected session is. `aria-selected` is for `listbox`/`tab` contexts and would be wrong here.)
- **Must not break default browser behavior.** Single-letter shortcuts are suppressed whenever focus is in a text input, textarea, or `contentEditable` element, AND when any modifier key (`Meta`, `Ctrl`, `Alt`) is held — so they never collide with Cmd+A, browser shortcuts, or typing.

## Shortcuts

### Region jumps (Phase 1)

| Key | Action |
|-----|--------|
| `/` | Focus the search input in `event-filter-bar.tsx`. |
| `a` | Open the agent combo box (clicks the `PopoverTrigger`; cmdk auto-focuses its `CommandInput`). |
| `t` | Focus the first filter pill (Prompts) in the static filter row. |
| `s` | Focus the currently-selected session in the sidebar; if none is visible, focus the first sidebar item. |

All four are suppressed when:
- `document.activeElement` is `INPUT`, `TEXTAREA`, or has `contentEditable="true"`.
- Any of `event.metaKey`, `event.ctrlKey`, `event.altKey` is true.
- The event has already been `defaultPrevented` (e.g. by a Radix popover that's open and listening).

### Sidebar arrow navigation (Phase 2)

| Key | Action |
|-----|--------|
| `↑` | Focus the previous visible sidebar item. No-op at the top. |
| `↓` | Focus the next visible sidebar item. No-op at the bottom. |
| `Enter` | On a session: select it. On a project row: toggle expansion (already works). |
| `Space` | Same as Enter for session items (matches button semantics). |

"Visible sidebar items" includes, in DOM order:
1. Pinned session items (when not collapsed).
2. Project rows.
3. Session items inside expanded projects.
4. "Show N more" / "Show less" buttons inside expanded date groups.

### Filter pill arrow navigation (Phase 3)

| Key | Action |
|-----|--------|
| `←` | Focus the previous filter pill. No-op at the start. |
| `→` | Focus the next filter pill. No-op at the end. |
| `Space` / `Enter` | Toggle the focused pill (already works — pills are real `<button>`s). |

Both rows (static category filters + dynamic tool filters) participate in a single navigation order. Left at the start of the tool row goes back to the last static filter; Right at the end of the static row goes into the tool row.

## Architecture

### One small custom hook

Create `app/client/src/hooks/use-region-shortcuts.ts`. It registers a single window-level `keydown` listener and dispatches based on the key. No library, no registry — this is the only consumer.

Mounted exactly once in `SessionView` (`app/client/src/components/main-panel/main-panel.tsx`).

The hook owns the suppression policy described above.

### Targets located via data attributes, not refs

Each region exposes a target via a data attribute on the relevant DOM element:

| Attribute | On |
|-----------|-----|
| `data-region-target="search"` | The search `<input>` in `event-filter-bar.tsx`. |
| `data-region-target="agents"` | The `PopoverTrigger`'s underlying `<button>` in `agent-combobox.tsx`. |
| `data-region-target="filters"` | The first filter pill (or a wrapper that the hook then queries inside). |
| `data-sidebar-item` | Every navigable sidebar item (pinned sessions, project rows, session items, "show more" buttons). |
| `data-filter-pill` | Every filter pill in both rows. |

The hook resolves targets via `document.querySelector` / `querySelectorAll`. This avoids ref-passing through props and survives re-renders cleanly.

### Sidebar accessibility fix (the one structural change)

`SessionItem` currently uses `<div onClick={onSelect}>` with no role, no `tabIndex`, and no key handler — it's invisible to keyboard users and screen readers as an interactive element.

Change the outer `<div>` to:

```tsx
<div
  role="button"
  tabIndex={isEditing ? -1 : 0}
  aria-current={isSelected ? 'true' : undefined}
  data-sidebar-item
  onClick={...}
  onKeyDown={(e) => {
    if (isEditing) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }}
>
```

This matches the existing pattern in `project-list.tsx:181-191` for project rows.

The nested clickable spans inside (pin toggle, edit pencil, notification bell) keep working — they already call `e.stopPropagation()`. Nested interactive elements aren't valid HTML, but that's a pre-existing pattern in the project rows and out of scope to refactor here.

### Sidebar arrow navigation

A keydown listener on the sidebar `<aside>` element handles `ArrowUp` / `ArrowDown`:

```ts
function handleArrow(e: KeyboardEvent, direction: -1 | 1) {
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('[data-sidebar-item]'),
  )
  const idx = items.indexOf(document.activeElement as HTMLElement)
  if (idx === -1) return
  const next = items[idx + direction]
  if (next) {
    e.preventDefault()
    next.focus()
  }
}
```

Stops at ends. No wraparound — wrap is surprising in a vertical list with hundreds of items.

Skipped when an inline rename input has focus (it's an `<input>`, so `document.activeElement` won't be a `data-sidebar-item`, and the listener no-ops naturally).

### Filter pill arrow navigation

Identical pattern with `[data-filter-pill]` and `ArrowLeft` / `ArrowRight`, scoped to a keydown listener on the filter bar container.

### Opening the agent combobox from `a`

Calling `.click()` on the `PopoverTrigger`'s rendered button opens the popover; Radix + cmdk handle focus transfer to the `CommandInput` automatically. No state lifting required.

## Files Touched

| File | Change |
|------|--------|
| `app/client/src/hooks/use-region-shortcuts.ts` | New — the keydown hook. |
| `app/client/src/components/main-panel/main-panel.tsx` | Mount the hook inside `SessionView`. |
| `app/client/src/components/main-panel/event-filter-bar.tsx` | Add `data-region-target="search"` to the search input; add `data-filter-pill` to every pill in both rows; add the left/right arrow keydown handler on the bar's outer container. |
| `app/client/src/components/main-panel/agent-combobox.tsx` | Add `data-region-target="agents"` to the `PopoverTrigger` button. |
| `app/client/src/components/sidebar/sidebar.tsx` | Add the up/down arrow keydown handler on the sidebar root. |
| `app/client/src/components/sidebar/session-item.tsx` | Add `role="button"`, `tabIndex`, `aria-current`, `data-sidebar-item`, and Enter/Space keydown to the outer div. |
| `app/client/src/components/sidebar/project-list.tsx` | Add `data-sidebar-item` to project rows and "Show more / less" buttons. |
| `app/client/src/components/sidebar/pinned-sessions.tsx` | Pinned sessions use `SessionItem`, so they get the attribute for free. Confirm and verify in tests. |

No state-store changes. No new dependencies.

## Test Plan

The project uses Vitest + React Testing Library (existing tests at `session-item.test.tsx`, `project-list.test.tsx`).

Add tests for:

1. `use-region-shortcuts` — `/`, `a`, `t`, `s` each focus the right element; all four are suppressed when an input is focused; all four are suppressed when modifier keys are held.
2. `session-item.test.tsx` — outer div has `role="button"`, `tabIndex={0}`, `aria-current` reflects `isSelected`; Enter and Space call `onSelect`; key events are ignored while `isEditing`.
3. Sidebar arrow nav — Down moves focus from one `data-sidebar-item` to the next in DOM order; Up reverses; both no-op at the ends.
4. Filter arrow nav — Right / Left move between pills across both rows; no-op at the ends.

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Single-letter shortcuts fire when user is typing. | Suppression check on `INPUT` / `TEXTAREA` / `contentEditable` + modifier keys. Tested explicitly. |
| Adding `tabIndex={0}` to many session items lengthens the tab order. | This is correct behavior — currently sessions are unreachable by keyboard. Users who want to skip past them can use `s` to jump in and out. |
| Arrow keys steal scrolling when focus is in the sidebar. | We `preventDefault()` only when there's a next/prev item to focus. At the ends, we no-op so the page can still scroll. |
| Nested interactive elements inside `SessionItem` (pin, edit, bell). | Pre-existing; out of scope. They already `stopPropagation()` on click; no new keyboard interactions added. |
| `data-region-target="filters"` could match multiple elements if duplicated. | Apply to one wrapper element only; filter pills use the separate `data-filter-pill` attribute. |

## Open Questions

None. Defaults from the brainstorming session apply:
- `t` focuses the first pill (Prompts), not the first active filter.
- `s` focuses the selected session if visible, else the first sidebar item.
- No wraparound on arrow nav.
- No `?` discoverability overlay in this scope.
