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

  const events = document.createElement('div')
  events.setAttribute('data-region-target', 'events')
  events.tabIndex = 0
  document.body.appendChild(events)

  return { search, agents, agentsClick, pill, sidebarItem, selectedSidebarItem, events }
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

  it('focuses the search input on "s" (alias of /)', () => {
    const { search } = setupDOM()
    render(<HookHost />)
    press('s')
    expect(document.activeElement).toBe(search)
  })

  it('clicks the agents trigger on "a"', () => {
    const { agentsClick } = setupDOM()
    render(<HookHost />)
    press('a')
    expect(agentsClick).toHaveBeenCalledTimes(1)
  })

  it('focuses the first filter pill on "f"', () => {
    const { pill } = setupDOM()
    render(<HookHost />)
    press('f')
    expect(document.activeElement).toBe(pill)
  })

  it('focuses the selected sidebar item on "b" when one is marked aria-current', () => {
    const { selectedSidebarItem } = setupDOM()
    render(<HookHost />)
    press('b')
    expect(document.activeElement).toBe(selectedSidebarItem)
  })

  it('focuses the first sidebar item on "b" when nothing is selected', () => {
    document.body.innerHTML = ''
    const item = document.createElement('button')
    item.setAttribute('data-sidebar-item', '')
    document.body.appendChild(item)
    render(<HookHost />)
    press('b')
    expect(document.activeElement).toBe(item)
  })

  it('focuses the event stream container on "e"', () => {
    const { events } = setupDOM()
    render(<HookHost />)
    press('e')
    expect(document.activeElement).toBe(events)
  })

  it('does NOT fire when an INPUT is focused', () => {
    const { search, pill } = setupDOM()
    render(<HookHost />)
    search.focus()
    press('f')
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
