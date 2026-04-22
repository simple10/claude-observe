# Session View Keyboard Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add region-jump shortcuts (`/`, `a`, `t`, `s`) and arrow-key navigation in the sidebar and filter pills, plus the SessionItem accessibility fix needed to make sessions keyboard-reachable. Tab is left alone — this only fixes places where Tab is currently broken.

**Architecture:** One small `useRegionShortcuts` hook mounted once in `SessionView` registers a window-level keydown listener for the four single-key shortcuts. Arrow-key navigation is scoped to its container via React `onKeyDown` handlers. Targets are located by data attributes (`data-region-target`, `data-sidebar-item`, `data-filter-pill`) — no ref-passing through props. The single structural change is `SessionItem`'s outer `<div>` becoming a `role="button"` with proper keyboard semantics, matching the existing pattern at `project-list.tsx:181`.

**Tech Stack:** React 19, TypeScript, Vitest, React Testing Library, `@testing-library/user-event`, `cn` from `@/lib/utils`. No new dependencies.

**Spec:** [`docs/superpowers/specs/2026-04-22-session-view-keyboard-shortcuts-design.md`](../specs/2026-04-22-session-view-keyboard-shortcuts-design.md)

---

## File Map

**Create:**
- `app/client/src/lib/keyboard-nav.ts` — `focusSiblingMatching` utility for sidebar + filter arrow nav
- `app/client/src/lib/keyboard-nav.test.ts` — unit tests for the utility
- `app/client/src/hooks/use-region-shortcuts.ts` — global keydown hook for `/`, `a`, `t`, `s`
- `app/client/src/hooks/use-region-shortcuts.test.tsx` — tests for the hook (suppression + dispatch)

**Modify:**
- `app/client/src/components/sidebar/session-item.tsx` — outer div becomes `role="button"` + Enter/Space handler + `data-sidebar-item`
- `app/client/src/components/sidebar/session-item.test.tsx` — add accessibility assertions
- `app/client/src/components/sidebar/project-list.tsx` — add `data-sidebar-item` to project rows + "Show more / less" buttons
- `app/client/src/components/sidebar/pinned-sessions.tsx` — add `data-sidebar-item` to the collapsed-mode `<button>` (expanded mode uses `SessionItem` and gets it for free)
- `app/client/src/components/sidebar/sidebar.tsx` — `onKeyDown` on the scroll content `<div>` for Up/Down arrow nav
- `app/client/src/components/main-panel/event-filter-bar.tsx` — `data-filter-pill` on every pill (All + statics + dynamics), `data-region-target="search"` on the search `<Input>`, `onKeyDown` on the outer container for Left/Right arrow nav
- `app/client/src/components/main-panel/agent-combobox.tsx` — `data-region-target="agents"` on the `PopoverTrigger`'s `<Button>`
- `app/client/src/components/main-panel/main-panel.tsx` — call `useRegionShortcuts()` in `SessionView`

**Out of scope:** `LabelList` (sidebar Labels tab) — same pattern can be applied later.

---

## Task 1: SessionItem accessibility (role, tabindex, aria-current, key handler, data attribute)

**Files:**
- Modify: `app/client/src/components/sidebar/session-item.tsx:102-230` (the outer `<div>` inside `<TooltipTrigger asChild>`)
- Test: `app/client/src/components/sidebar/session-item.test.tsx`

The outer container is currently `<div onClick={...}>` with no role and no keyboard support. Make it focusable, give it button semantics, mark the selected state with `aria-current`, and add Enter/Space handling. Skip when the inline rename input is open.

- [ ] **Step 1: Write the failing tests**

Append to `app/client/src/components/sidebar/session-item.test.tsx`:

```tsx
describe('SessionItem accessibility', () => {
  it('renders the outer container as a focusable button', () => {
    renderItem(makeSession())
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]')
    expect(container).not.toBeNull()
    expect(container).toHaveAttribute('tabindex', '0')
    expect(container).toHaveAttribute('data-sidebar-item')
  })

  it('sets aria-current="true" when isSelected', () => {
    renderWithProviders(
      <TooltipProvider>
        <SessionItem
          session={makeSession()}
          isSelected={true}
          isPinned={false}
          onSelect={() => {}}
          onTogglePin={() => {}}
          onRename={async () => {}}
        />
      </TooltipProvider>,
    )
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]')
    expect(container).toHaveAttribute('aria-current', 'true')
  })

  it('omits aria-current when not selected', () => {
    renderItem(makeSession())
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]')
    expect(container).not.toHaveAttribute('aria-current')
  })

  it('calls onSelect when Enter is pressed', async () => {
    const onSelect = vi.fn()
    renderWithProviders(
      <TooltipProvider>
        <SessionItem
          session={makeSession()}
          isSelected={false}
          isPinned={false}
          onSelect={onSelect}
          onTogglePin={() => {}}
          onRename={async () => {}}
        />
      </TooltipProvider>,
    )
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]') as HTMLElement
    container.focus()
    await userEvent.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('calls onSelect when Space is pressed', async () => {
    const onSelect = vi.fn()
    renderWithProviders(
      <TooltipProvider>
        <SessionItem
          session={makeSession()}
          isSelected={false}
          isPinned={false}
          onSelect={onSelect}
          onTogglePin={() => {}}
          onRename={async () => {}}
        />
      </TooltipProvider>,
    )
    const container = screen.getAllByText('my-session')[0].closest('[role="button"]') as HTMLElement
    container.focus()
    await userEvent.keyboard(' ')
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})
```

Also add `vi` to the imports at the top of the file:

```tsx
import { describe, it, expect, vi } from 'vitest'
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/client && npx vitest run src/components/sidebar/session-item.test.tsx`
Expected: 5 new tests fail (role, tabindex, data-sidebar-item, aria-current, key handlers all missing).

- [ ] **Step 3: Update SessionItem outer div**

In `app/client/src/components/sidebar/session-item.tsx`, replace the opening `<div ... onClick={() => !isEditing && onSelect()}>` (lines 105-112) and its surrounding behavior:

```tsx
<div
  role="button"
  tabIndex={isEditing ? -1 : 0}
  aria-current={isSelected ? 'true' : undefined}
  data-sidebar-item=""
  className={cn(
    'group rounded-md px-2 py-1 transition-colors cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ring',
    isSelected
      ? 'bg-accent text-accent-foreground'
      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
  )}
  onClick={() => !isEditing && onSelect()}
  onKeyDown={(e) => {
    if (isEditing) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect()
    }
  }}
>
```

(The only changes: added `role`, `tabIndex`, `aria-current`, `data-sidebar-item`, `focus:outline-none focus-visible:ring-1 focus-visible:ring-ring` classes for visible focus, and the `onKeyDown` handler. Everything else inside the div stays the same.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/client && npx vitest run src/components/sidebar/session-item.test.tsx`
Expected: all tests pass (originals + 5 new).

- [ ] **Step 5: Commit**

```bash
git add app/client/src/components/sidebar/session-item.tsx app/client/src/components/sidebar/session-item.test.tsx
git commit -m "feat: make SessionItem keyboard-focusable with role=button"
```

---

## Task 2: Data attributes on remaining sidebar items

**Files:**
- Modify: `app/client/src/components/sidebar/project-list.tsx` (project row at lines 180-191; "Show N more" at 412-419; "Show less" at 423-429)
- Modify: `app/client/src/components/sidebar/pinned-sessions.tsx` (collapsed `<button>` at lines 49-59)

Project rows already have `role="button"`, `tabIndex={0}`, and a keydown handler. They just need the `data-sidebar-item` marker so the arrow-nav code can find them. Same for the "Show more / less" buttons and the collapsed pinned-session buttons.

There is no test in this task — these are pure DOM annotations covered by integration tests in Task 4. We could add a render test, but it would duplicate Task 4's work.

- [ ] **Step 1: Add `data-sidebar-item` to project row**

In `app/client/src/components/sidebar/project-list.tsx`, find the `<div role="button" ...>` at line 180 and add the attribute:

```tsx
<div
  role="button"
  tabIndex={0}
  data-sidebar-item=""
  className="group flex items-center gap-2 w-full rounded-md px-2 py-0.5 text-sm transition-colors cursor-pointer text-foreground hover:bg-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
  onClick={toggleProject}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      toggleProject()
    }
  }}
>
```

- [ ] **Step 2: Add `data-sidebar-item` to "Show N more" button**

Find the button at line 412 and add the attribute:

```tsx
<button
  data-sidebar-item=""
  className="w-full text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 cursor-pointer"
  onClick={() => toggleGroup(group.label)}
>
  Show {hiddenCount} more...
</button>
```

- [ ] **Step 3: Add `data-sidebar-item` to "Show less" button**

Find the button at line 423 and add the attribute:

```tsx
<button
  data-sidebar-item=""
  className="w-full text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 cursor-pointer"
  onClick={() => toggleGroup(group.label)}
>
  Show less
</button>
```

- [ ] **Step 4: Add `data-sidebar-item` to collapsed pinned-session button**

In `app/client/src/components/sidebar/pinned-sessions.tsx`, find the `<button>` at line 49 (inside the collapsed branch) and add the attribute:

```tsx
<button
  data-sidebar-item=""
  className={cn(
    'flex h-8 w-8 mx-auto items-center justify-center rounded-md text-xs cursor-pointer',
    selectedSessionId === session.id
      ? 'bg-primary/10 text-primary border border-primary/30'
      : 'text-muted-foreground hover:bg-accent',
  )}
  onClick={() => selectSession(session)}
>
  <Pin className="h-3.5 w-3.5" />
</button>
```

- [ ] **Step 5: Run existing tests to verify nothing broke**

Run: `cd app/client && npx vitest run src/components/sidebar/`
Expected: all sidebar tests pass.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/sidebar/project-list.tsx app/client/src/components/sidebar/pinned-sessions.tsx
git commit -m "feat: tag remaining sidebar items with data-sidebar-item"
```

---

## Task 3: focusSiblingMatching utility

**Files:**
- Create: `app/client/src/lib/keyboard-nav.ts`
- Create: `app/client/src/lib/keyboard-nav.test.ts`

A tiny pure helper that finds the next/previous element matching a selector among a container's descendants and focuses it. Used by both sidebar (vertical) and filter (horizontal) arrow nav.

- [ ] **Step 1: Write the failing tests**

Create `app/client/src/lib/keyboard-nav.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { focusSiblingMatching } from './keyboard-nav'

function setup() {
  document.body.innerHTML = `
    <div id="container">
      <button data-item="">A</button>
      <button data-item="">B</button>
      <button data-item="">C</button>
    </div>
  `
  const container = document.getElementById('container') as HTMLElement
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('[data-item]'))
  return { container, buttons }
}

describe('focusSiblingMatching', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('focuses the next sibling and returns true', () => {
    const { container, buttons } = setup()
    buttons[0].focus()
    const result = focusSiblingMatching(buttons[0], '[data-item]', container, 1)
    expect(result).toBe(true)
    expect(document.activeElement).toBe(buttons[1])
  })

  it('focuses the previous sibling and returns true', () => {
    const { container, buttons } = setup()
    buttons[2].focus()
    const result = focusSiblingMatching(buttons[2], '[data-item]', container, -1)
    expect(result).toBe(true)
    expect(document.activeElement).toBe(buttons[1])
  })

  it('returns false at the end (no wraparound)', () => {
    const { container, buttons } = setup()
    buttons[2].focus()
    const result = focusSiblingMatching(buttons[2], '[data-item]', container, 1)
    expect(result).toBe(false)
    expect(document.activeElement).toBe(buttons[2])
  })

  it('returns false at the start (no wraparound)', () => {
    const { container, buttons } = setup()
    buttons[0].focus()
    const result = focusSiblingMatching(buttons[0], '[data-item]', container, -1)
    expect(result).toBe(false)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('returns false when current is not in the list', () => {
    const { container } = setup()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const result = focusSiblingMatching(outside, '[data-item]', container, 1)
    expect(result).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/client && npx vitest run src/lib/keyboard-nav.test.ts`
Expected: FAIL with "Cannot find module './keyboard-nav'".

- [ ] **Step 3: Implement the utility**

Create `app/client/src/lib/keyboard-nav.ts`:

```ts
export function focusSiblingMatching(
  current: HTMLElement,
  selector: string,
  container: HTMLElement,
  direction: -1 | 1,
): boolean {
  const items = Array.from(container.querySelectorAll<HTMLElement>(selector))
  const idx = items.indexOf(current)
  if (idx === -1) return false
  const next = items[idx + direction]
  if (!next) return false
  next.focus()
  return true
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/client && npx vitest run src/lib/keyboard-nav.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/lib/keyboard-nav.ts app/client/src/lib/keyboard-nav.test.ts
git commit -m "feat: add focusSiblingMatching keyboard-nav utility"
```

---

## Task 4: Sidebar arrow-key navigation

**Files:**
- Modify: `app/client/src/components/sidebar/sidebar.tsx:106-109` (the scroll content `<div>`)

Wire `onKeyDown` to the sidebar's scrollable content div so arrow keys navigate between visible `[data-sidebar-item]` elements.

**No new test in this task.** The traversal logic is already unit-tested in `keyboard-nav.test.ts` (Task 3). The wire-up here is two lines of glue. Building a full `Sidebar` render test would require mocking the websocket + project/session stores — poor cost-to-value ratio. The integration is verified manually in Task 8's browser smoke.

- [ ] **Step 1: Wire the keydown handler in `sidebar.tsx`**

In `app/client/src/components/sidebar/sidebar.tsx`:

(a) Add the import at the top (after the existing `cn` import on line 3):

```tsx
import { focusSiblingMatching } from '@/lib/keyboard-nav'
```

(b) Replace the scroll content div at lines 106-109:

```tsx
<div
  className="flex-1 overflow-y-auto p-2"
  onKeyDown={(e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const direction = e.key === 'ArrowDown' ? 1 : -1
    const target = e.target as HTMLElement
    if (!target.matches('[data-sidebar-item]')) return
    if (focusSiblingMatching(target, '[data-sidebar-item]', e.currentTarget, direction)) {
      e.preventDefault()
    }
  }}
>
  <PinnedSessions collapsed={sidebarCollapsed} />
  <ProjectLabelTabs collapsed={sidebarCollapsed} />
</div>
```

- [ ] **Step 2: Verify TypeScript clean**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/sidebar/sidebar.tsx
git commit -m "feat: wire arrow-key navigation in sidebar"
```

---

## Task 5: Filter pill data attributes

**Files:**
- Modify: `app/client/src/components/main-panel/event-filter-bar.tsx` (the "All" button at lines 101-111, the static-category buttons at 116-130, and the dynamic tool buttons at 172-184)

Pure DOM annotations on existing `<button>` elements so the filter arrow-nav handler (Task 6) can find them.

- [ ] **Step 1: Add `data-filter-pill` to the "All" button**

In `app/client/src/components/main-panel/event-filter-bar.tsx`, find the "All" button at line 101 and add the attribute:

```tsx
<button
  data-filter-pill=""
  className={cn(
    'rounded-full px-2.5 py-0.5 text-xs transition-colors',
    !hasAnyFilter
      ? 'bg-primary text-primary-foreground'
      : 'bg-secondary text-secondary-foreground hover:bg-accent',
  )}
  onClick={clearAllFilters}
>
  All
</button>
```

- [ ] **Step 2: Add `data-filter-pill` to each static category button**

Find the static category buttons at line 116 and add the attribute:

```tsx
<button
  key={category}
  data-filter-pill=""
  className={cn(
    'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
    isActive
      ? 'bg-primary text-primary-foreground border-primary'
      : hasMatches
        ? 'bg-secondary text-secondary-foreground border-primary/40 hover:bg-accent'
        : 'bg-secondary text-muted-foreground/70 dark:text-muted-foreground/50 border-transparent hover:bg-accent hover:text-secondary-foreground',
  )}
  onClick={() => toggleStaticFilter(category)}
>
  {category}
</button>
```

- [ ] **Step 3: Add `data-filter-pill` to each dynamic tool button**

Find the dynamic tool buttons at line 172 and add the attribute:

```tsx
<button
  key={name}
  data-filter-pill=""
  className={cn(
    'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
    activeToolFilters.includes(name)
      ? 'border-blue-500 bg-blue-500/15 text-blue-700 dark:text-blue-400'
      : 'border-border text-muted-foreground hover:border-blue-500/50 hover:text-foreground',
  )}
  onClick={() => toggleToolFilter(name)}
>
  {name}
</button>
```

- [ ] **Step 4: Verify nothing broke**

Run: `cd app/client && npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/components/main-panel/event-filter-bar.tsx
git commit -m "feat: tag filter pills with data-filter-pill"
```

---

## Task 6: Filter pill arrow-key navigation

**Files:**
- Modify: `app/client/src/components/main-panel/event-filter-bar.tsx:96` (the outer container `<div>`)

Wire `onKeyDown` to the filter bar's outer container so left/right arrows navigate between pills across both rows.

- [ ] **Step 1: Add the import**

In `app/client/src/components/main-panel/event-filter-bar.tsx`, add this import after the existing `import { Input }` line:

```tsx
import { focusSiblingMatching } from '@/lib/keyboard-nav'
```

- [ ] **Step 2: Wire the keydown handler on the outer container**

Replace the outer `<div>` at line 96:

```tsx
<div
  className="flex flex-col gap-1 px-3 py-1.5 border-b border-border"
  onKeyDown={(e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const direction = e.key === 'ArrowRight' ? 1 : -1
    const target = e.target as HTMLElement
    if (!target.matches('[data-filter-pill]')) return
    if (focusSiblingMatching(target, '[data-filter-pill]', e.currentTarget, direction)) {
      e.preventDefault()
    }
  }}
>
```

(Everything inside the div stays unchanged.)

- [ ] **Step 3: Verify TypeScript clean**

Run: `cd app/client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/main-panel/event-filter-bar.tsx
git commit -m "feat: wire arrow-key navigation in filter pills"
```

---

## Task 7: useRegionShortcuts hook + region-target attributes + mount

**Files:**
- Create: `app/client/src/hooks/use-region-shortcuts.ts`
- Create: `app/client/src/hooks/use-region-shortcuts.test.tsx`
- Modify: `app/client/src/components/main-panel/event-filter-bar.tsx` (add `data-region-target="search"` to the search `<Input>` at line 143)
- Modify: `app/client/src/components/main-panel/agent-combobox.tsx` (add `data-region-target="agents"` to the `<Button>` inside `<PopoverTrigger>` at line 80)
- Modify: `app/client/src/components/main-panel/main-panel.tsx` (call `useRegionShortcuts()` in `SessionView` at line 28)

The capstone task. After this, all four shortcuts work end-to-end.

- [ ] **Step 1: Write the failing tests**

Create `app/client/src/hooks/use-region-shortcuts.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { useRegionShortcuts } from './use-region-shortcuts'

function HookHost() {
  useRegionShortcuts()
  return null
}

function setupDOM() {
  const search = document.createElement('input')
  search.setAttribute('data-region-target', 'search')
  document.body.appendChild(search)

  const agents = document.createElement('button')
  agents.setAttribute('data-region-target', 'agents')
  const agentsClick = vi.fn()
  agents.addEventListener('click', agentsClick)
  document.body.appendChild(agents)

  const pill = document.createElement('button')
  pill.setAttribute('data-filter-pill', '')
  document.body.appendChild(pill)

  const sidebarItem = document.createElement('button')
  sidebarItem.setAttribute('data-sidebar-item', '')
  document.body.appendChild(sidebarItem)

  const selectedSidebarItem = document.createElement('button')
  selectedSidebarItem.setAttribute('data-sidebar-item', '')
  selectedSidebarItem.setAttribute('aria-current', 'true')
  document.body.appendChild(selectedSidebarItem)

  return { search, agents, agentsClick, pill, sidebarItem, selectedSidebarItem }
}

function press(key: string, opts: { meta?: boolean; ctrl?: boolean; alt?: boolean } = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    altKey: opts.alt ?? false,
    bubbles: true,
    cancelable: true,
  })
  window.dispatchEvent(event)
  return event
}

describe('useRegionShortcuts', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  afterEach(() => {
    cleanup()
  })

  it('focuses the search input on "/"', () => {
    const { search } = setupDOM()
    render(<HookHost />)
    press('/')
    expect(document.activeElement).toBe(search)
  })

  it('clicks the agents trigger on "a"', () => {
    const { agentsClick } = setupDOM()
    render(<HookHost />)
    press('a')
    expect(agentsClick).toHaveBeenCalledTimes(1)
  })

  it('focuses the first filter pill on "t"', () => {
    const { pill } = setupDOM()
    render(<HookHost />)
    press('t')
    expect(document.activeElement).toBe(pill)
  })

  it('focuses the selected sidebar item on "s" when one is marked aria-current', () => {
    const { selectedSidebarItem } = setupDOM()
    render(<HookHost />)
    press('s')
    expect(document.activeElement).toBe(selectedSidebarItem)
  })

  it('focuses the first sidebar item on "s" when nothing is selected', () => {
    document.body.innerHTML = ''
    const item = document.createElement('button')
    item.setAttribute('data-sidebar-item', '')
    document.body.appendChild(item)
    render(<HookHost />)
    press('s')
    expect(document.activeElement).toBe(item)
  })

  it('does NOT fire when an INPUT is focused', () => {
    const { search, pill } = setupDOM()
    render(<HookHost />)
    search.focus()
    press('t')
    // Search stays focused; pill is not focused
    expect(document.activeElement).toBe(search)
    expect(document.activeElement).not.toBe(pill)
  })

  it('does NOT fire when an element is contentEditable', () => {
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.tabIndex = 0
    document.body.appendChild(editable)
    setupDOM()
    render(<HookHost />)
    editable.focus()
    press('/')
    expect(document.activeElement).toBe(editable)
  })

  it('does NOT fire when a modifier key is held', () => {
    const { search } = setupDOM()
    render(<HookHost />)
    press('/', { meta: true })
    expect(document.activeElement).not.toBe(search)
    press('/', { ctrl: true })
    expect(document.activeElement).not.toBe(search)
    press('/', { alt: true })
    expect(document.activeElement).not.toBe(search)
  })

  it('calls preventDefault when handled', () => {
    setupDOM()
    render(<HookHost />)
    const event = press('/')
    expect(event.defaultPrevented).toBe(true)
  })

  it('does NOT call preventDefault for unrelated keys', () => {
    setupDOM()
    render(<HookHost />)
    const event = press('x')
    expect(event.defaultPrevented).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd app/client && npx vitest run src/hooks/use-region-shortcuts.test.tsx`
Expected: FAIL with "Cannot find module './use-region-shortcuts'".

- [ ] **Step 3: Implement the hook**

Create `app/client/src/hooks/use-region-shortcuts.ts`:

```ts
import { useEffect } from 'react'

function isTextInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

function focusSearch() {
  const target = document.querySelector<HTMLElement>('[data-region-target="search"]')
  target?.focus()
}

function clickAgentsTrigger() {
  const target = document.querySelector<HTMLElement>('[data-region-target="agents"]')
  target?.click()
}

function focusFirstFilterPill() {
  const target = document.querySelector<HTMLElement>('[data-filter-pill]')
  target?.focus()
}

function focusSidebar() {
  const selected = document.querySelector<HTMLElement>(
    '[data-sidebar-item][aria-current="true"]',
  )
  const target = selected ?? document.querySelector<HTMLElement>('[data-sidebar-item]')
  target?.focus()
}

export function useRegionShortcuts() {
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.defaultPrevented) return
      if (isTextInputFocused()) return

      switch (e.key) {
        case '/':
          e.preventDefault()
          focusSearch()
          return
        case 'a':
          e.preventDefault()
          clickAgentsTrigger()
          return
        case 't':
          e.preventDefault()
          focusFirstFilterPill()
          return
        case 's':
          e.preventDefault()
          focusSidebar()
          return
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd app/client && npx vitest run src/hooks/use-region-shortcuts.test.tsx`
Expected: all 10 tests pass.

- [ ] **Step 5: Add `data-region-target="search"` to the search input**

In `app/client/src/components/main-panel/event-filter-bar.tsx`, find the `<Input>` at line 143 and add the attribute:

```tsx
<Input
  data-region-target="search"
  placeholder="Search events..."
  value={localSearch}
  onChange={(e) => handleSearchChange(e.target.value)}
  className={cn(
    'h-7 pl-7 text-xs',
    localSearch &&
      'border-green-600 dark:border-green-400 ring-1 ring-green-600/30 dark:ring-green-400/30',
    localSearch &&
      localSearch !== localSearch.trim() &&
      'bg-green-600/5 dark:bg-green-400/5',
    localSearch && 'pr-7',
  )}
/>
```

(`Input` from `@/components/ui/input` forwards arbitrary props to the underlying `<input>`. Verify by reading the file briefly if uncertain.)

- [ ] **Step 6: Add `data-region-target="agents"` to the agents trigger button**

In `app/client/src/components/main-panel/agent-combobox.tsx`, find the `<Button>` at line 80 inside `<PopoverTrigger asChild>` and add the attribute:

```tsx
<Button
  data-region-target="agents"
  variant="outline"
  size="sm"
  className="h-7 gap-1.5 text-xs px-2.5"
>
  <Users className="h-3.5 w-3.5" />
  Agents
  {/* ... rest unchanged */}
```

- [ ] **Step 7: Mount the hook in SessionView**

In `app/client/src/components/main-panel/main-panel.tsx`:

(a) Add the import after the existing imports (after line 12):

```tsx
import { useRegionShortcuts } from '@/hooks/use-region-shortcuts'
```

(b) In `SessionView` (line 28), call the hook before the `return`:

```tsx
function SessionView({ sessionId, projectId }: { sessionId: string; projectId: number }) {
  useRegionShortcuts()
  const { data: sessions } = useSessions(projectId)
  const effectiveSessionId = sessionId || sessions?.[0]?.id || null
  const eventsQuery = useEffectiveEvents(effectiveSessionId)
  const rawEvents = eventsQuery.data
  const agents = useAgents(effectiveSessionId, rawEvents)

  return (
    <EventProcessingProvider rawEvents={rawEvents} agents={agents}>
      <div className="flex-1 flex flex-col overflow-hidden">
        <SessionBreadcrumb />
        <ScopeBar />
        <EventFilterBar />
        <ActivityTimeline />
        <EventStream key={sessionId} />
      </div>
    </EventProcessingProvider>
  )
}
```

- [ ] **Step 8: Run all tests**

Run: `cd app/client && npx vitest run`
Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add app/client/src/hooks/use-region-shortcuts.ts app/client/src/hooks/use-region-shortcuts.test.tsx app/client/src/components/main-panel/event-filter-bar.tsx app/client/src/components/main-panel/agent-combobox.tsx app/client/src/components/main-panel/main-panel.tsx
git commit -m "feat: add region-jump keyboard shortcuts for session view"
```

---

## Task 8: Final integration check

**Files:** none modified.

Verify everything works together: `just check` for the full test + format pass, plus a quick manual browser smoke test.

- [ ] **Step 1: Run `just check`**

Run: `just check`
Expected: all server + client tests pass; formatting clean.

If formatting changes anything, commit it:

```bash
git add -A
git commit -m "style: apply formatter"
```

- [ ] **Step 2: Manual smoke (browser)**

Start the dev server: `just dev` (in a separate terminal).

Open http://localhost:5174 and select a project + session so you're in the session view. Then verify:

| Action | Expected |
|--------|----------|
| Press `/` | Search input gains focus |
| Type a query, then press `Escape` and `/` again | Search refocuses, query preserved |
| Press `a` | Agents popover opens, search input inside it gains focus |
| Press `t` | First filter pill ("All") gains focus |
| With a filter pill focused, press `→` repeatedly | Focus moves through pills; stops at the last dynamic tool pill |
| With a filter pill focused, press `←` | Focus moves backward; stops at "All" |
| With a filter pill focused, press `Space` or `Enter` | Filter toggles |
| Press `s` (with a session selected) | The selected session in the sidebar gains focus |
| Press `s` (with no session selected) | The first sidebar item gains focus |
| With a sidebar item focused, press `↓` repeatedly | Focus moves through pinned sessions, project rows, and visible session items |
| With a session focused, press `Enter` | The session is selected (URL updates, content loads) |
| Click in the search input and press `t` | `t` is typed into the input — shortcut does NOT fire |
| Press `Cmd+A` (or `Ctrl+A`) inside the search input | Selects text — shortcut does NOT fire |
| Press `Tab` from anywhere | Tab still walks the document in normal browser order |

If anything is wrong, file a follow-up commit. Otherwise:

- [ ] **Step 3: Final commit (if formatter ran or any tweaks)**

If you made any fixes during the smoke test, commit them with appropriate `fix:` or `style:` prefixes.

---

## Self-Review

**Spec coverage:**
- ✅ `/` focus search → Task 7
- ✅ `a` open agent combo box → Task 7
- ✅ `t` focus first filter pill → Task 7
- ✅ `s` focus selected session (or first) → Task 7
- ✅ Suppression in inputs / contentEditable / with modifiers → Task 7 (tested)
- ✅ Sidebar accessibility (role/tabindex/aria-current/key handler) → Task 1
- ✅ `data-sidebar-item` on all visible sidebar items → Tasks 1 + 2
- ✅ Sidebar Up/Down arrow nav → Task 4
- ✅ `data-filter-pill` on all pills (both rows + All) → Task 5
- ✅ Filter Left/Right arrow nav → Task 6
- ✅ `focusSiblingMatching` utility → Task 3
- ✅ Hook mounted in `SessionView` → Task 7
- ✅ No new dependencies → confirmed across all tasks
- ✅ Tab unmodified → confirmed (no Tab handlers added anywhere)

**Placeholder scan:** none — every code block contains the actual code to write.

**Type/name consistency:**
- `focusSiblingMatching(current, selector, container, direction)` signature is identical in Tasks 3, 4, 6.
- `data-sidebar-item`, `data-filter-pill`, `data-region-target` strings match across tasks.
- Hook is `useRegionShortcuts` (no parens), called as `useRegionShortcuts()` — consistent.

**Note on Task 4 testing:** Task 4 omits a wired-up integration test in favor of the keyboard-nav unit test (Task 3) plus the manual smoke check (Task 8). If the implementer prefers full integration coverage, they can add a Sidebar render test, but it requires mocking the websocket + project/session stores; the cost-to-value ratio is poor for two lines of glue code.
