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

describe('LogsModal — debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('commits the query after the debounce window', async () => {
    setMockEvents([makeEvent(1, { foo: 'bar' })])
    renderWithProviders(<LogsModal />)
    // Use fireEvent for the trigger click — avoids pointer-delay timers in
    // userEvent that can hang under fake-timer mode with Radix animations.
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    // Use fireEvent.change — avoids per-keystroke pointer delays in
    // userEvent.type() which can also hang under fake-timer mode.
    await act(async () => {
      fireEvent.change(input, { target: { value: 'foo' } })
    })
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
    // Use fireEvent for the trigger click — avoids pointer-delay timers in
    // userEvent that can hang under fake-timer mode with Radix animations.
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    // Use fireEvent.change — avoids per-keystroke pointer delays in
    // userEvent.type() which can also hang under fake-timer mode.
    await act(async () => {
      fireEvent.change(input, { target: { value: 'foo' } })
      fireEvent.change(input, { target: { value: '' } })
    })
    expect(input.value).toBe('')
    // Empty input should NOT schedule a delayed commit.
    await flushTimers(500)
  })
})

describe('LogsModal — current-match paint', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('paints logs-search-current when a query has matches', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    const current = (CSS as any).highlights.get('logs-search-current')
    expect(current).toBeDefined()
    expect(current.size).toBe(1)
  })
})

describe('LogsModal — match building', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('populates logs-search-all when the query matches', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash', cmd: 'ls -la' }),
      makeEvent(2, { tool_name: 'Read', path: '/etc/hosts' }),
    ])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    // Drain any deferred event load
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    const all = (CSS as any).highlights.get('logs-search-all')
    expect(all).toBeDefined()
    expect(all.size).toBe(1)
  })

  it('clears logs-search-all when the query is empty', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)
    expect((CSS as any).highlights.get('logs-search-all')).toBeDefined()

    await act(async () => {
      fireEvent.change(input, { target: { value: '' } })
    })
    // Empty clears immediately, no debounce
    await flushTimers(0)
    expect((CSS as any).highlights.get('logs-search-all')).toBeUndefined()
  })
})

describe('LogsModal — nav cluster', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows match counter once the query is committed', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('shows "0 matches" when the query has no hits', async () => {
    setMockEvents([makeEvent(1, { foo: 'bar' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'zzz' } })
    })
    await flushTimers(300)

    expect(screen.getByText(/0 matches/i)).toBeInTheDocument()
  })

  it('advances current match when ▼ is clicked', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    expect(screen.getByText('1/2')).toBeInTheDocument()
    await act(async () => {
      fireEvent.click(screen.getByTitle(/next match/i))
    })
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('clears the query when ✕ is clicked', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    await act(async () => {
      fireEvent.click(screen.getByTitle(/clear search/i))
    })
    expect(input.value).toBe('')
    expect(screen.queryByText(/1\/1/)).not.toBeInTheDocument()
  })
})

describe('LogsModal — Cmd+G listener', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('advances current match on Cmd+G when committedQuery is non-empty', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)
    expect(screen.getByText('1/2')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    const ev = new KeyboardEvent('keydown', {
      key: 'g',
      code: 'KeyG',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      dialog.dispatchEvent(ev)
    })

    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('moves to previous match on Cmd+Shift+G (uppercase key)', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    const dialog = screen.getByRole('dialog')
    const ev = new KeyboardEvent('keydown', {
      key: 'G',
      code: 'KeyG',
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      dialog.dispatchEvent(ev)
    })

    // Wraps from 1 to 2
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('does NOT listen when committedQuery is empty', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    // No query typed — bindings inactive
    const dialog = screen.getByRole('dialog')
    const ev = new KeyboardEvent('keydown', {
      key: 'g',
      code: 'KeyG',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      dialog.dispatchEvent(ev)
    })
    expect(ev.defaultPrevented).toBe(false)
  })
})

describe('LogsModal — Esc handling', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Esc with non-empty query clears the query and keeps modal open', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

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
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const dialog = screen.getByRole('dialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })

    // Radix unmounts the dialog
    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('LogsModal — cleanup', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears highlights and query when modal closes via X', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)
    expect((CSS as any).highlights.get('logs-search-all')).toBeDefined()

    // Click the close X (exact title — distinct from "Clear search")
    await act(async () => {
      fireEvent.click(screen.getByTitle('Close'))
      await Promise.resolve()
    })

    expect((CSS as any).highlights.get('logs-search-all')).toBeUndefined()
    expect((CSS as any).highlights.get('logs-search-current')).toBeUndefined()

    // Reopen — query state is reset
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)
    const reopened = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    expect(reopened.value).toBe('')
  })

  it('clears highlights when LogsModal unmounts', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    const { unmount } = renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)
    expect((CSS as any).highlights.get('logs-search-all')).toBeDefined()

    unmount()
    expect((CSS as any).highlights.get('logs-search-all')).toBeUndefined()
    expect((CSS as any).highlights.get('logs-search-current')).toBeUndefined()
  })
})

describe('LogsModal — streaming while searching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('does NOT reset currentMatchIndex when new events stream in', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
      makeEvent(3, { tool_name: 'Bash' }),
    ])
    const { rerender } = renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)
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
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)
    await pressEnter(input) // advance to 2/2
    expect(screen.getByText('2/2')).toBeInTheDocument()

    // Replace the query
    await act(async () => {
      fireEvent.change(input, { target: { value: 'tool_name' } })
    })
    await flushTimers(300)

    expect(screen.getByText('1/2')).toBeInTheDocument()
  })
})

describe('LogsModal — indented-JSON parity', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('matches a query that exists only in the indented JSON form', async () => {
    setMockEvents([makeEvent(1, { foo: 1 })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    // `"foo": 1` (with space after colon) appears in indented JSON,
    // not in flat JSON `{"foo":1}`. The cheap-skip must use the same
    // form as what's rendered.
    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: '"foo": 1' } })
    })
    await flushTimers(300)

    expect(screen.getByText('1/1')).toBeInTheDocument()
  })
})

describe('LogsModal — match cap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('caps match count at 1000 and renders 1/1000+', async () => {
    const longString = 'x'.repeat(5000)
    setMockEvents([makeEvent(1, { data: longString })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'x' } })
    })
    await flushTimers(300)

    expect(screen.getByText('1/1000+')).toBeInTheDocument()
    const all = (CSS as any).highlights.get('logs-search-all')
    expect(all.size).toBe(1000)
  })
})

describe('LogsModal — scroll-on-intent', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  // Patch Element.prototype.scrollBy globally so we capture every
  // scroll attempt without iterating individual elements.
  function spyScrollBy() {
    const spy = vi.fn()
    const original = Element.prototype.scrollBy
    Element.prototype.scrollBy = function patched(this: Element, opts?: ScrollToOptions) {
      spy(opts)
    } as typeof Element.prototype.scrollBy
    return {
      spy,
      restore: () => {
        Element.prototype.scrollBy = original
      },
    }
  }

  it('does NOT scroll on a streaming rebuild that does not change index', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    const { rerender } = renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    const { spy, restore } = spyScrollBy()
    try {
      setMockEvents([
        makeEvent(1, { tool_name: 'Bash' }),
        makeEvent(2, { tool_name: 'Bash' }),
        makeEvent(3, { tool_name: 'Read' }),
      ])
      rerender(<LogsModal />)
      await flushTimers(0)

      expect(screen.getByText('1/2')).toBeInTheDocument()
      expect(spy).not.toHaveBeenCalled()
    } finally {
      restore()
    }
  })

  it('DOES scroll when next is pressed', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    const { spy, restore } = spyScrollBy()
    try {
      await pressEnter(input)
      expect(spy).toHaveBeenCalled()
    } finally {
      restore()
    }
  })
})

describe('LogsModal — abort race', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('discards results from a superseded query', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'BashRun' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'B' } })
    })
    await flushTimers(300)

    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    expect((input as HTMLInputElement).value).toBe('Bash')
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })
})

describe('LogsModal — rebuildEpoch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('re-paints logs-search-current when streaming rebuild keeps same match count and index', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    const { rerender } = renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    const before = (CSS as any).highlights.get('logs-search-current')
    expect(before).toBeDefined()

    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Bash' }),
      makeEvent(3, { tool_name: 'Read' }),
    ])
    rerender(<LogsModal />)
    await flushTimers(0)

    const after = (CSS as any).highlights.get('logs-search-current')
    expect(after).toBeDefined()
    expect(after).not.toBe(before)
  })
})

describe('LogsModal — browser degrade', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    if (!('highlights' in CSS)) {
      ;(CSS as any).highlights = new Map()
    }
  })

  it('does not crash when CSS.highlights is unavailable', async () => {
    const original = (CSS as any).highlights
    delete (CSS as any).highlights

    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)
    ;(CSS as any).highlights = original
  })
})

describe('LogsModal — paste & IME', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces commit when input value is set via paste (no keydown/keyup)', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Bash' } })
    expect(input.value).toBe('Bash')
    expect(screen.queryByText('1/1')).not.toBeInTheDocument()
    await flushTimers(300)
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('does NOT commit during IME composition; commits on compositionend', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement

    fireEvent.compositionStart(input)
    fireEvent.change(input, { target: { value: 'B' } })
    fireEvent.change(input, { target: { value: 'Ba' } })
    fireEvent.change(input, { target: { value: 'Bash' } })
    await flushTimers(300)
    expect(screen.queryByText('1/1')).not.toBeInTheDocument()

    fireEvent.compositionEnd(input, { data: 'Bash' })
    await flushTimers(300)
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })
})

describe('LogsModal — Enter / Shift+Enter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('Enter force-commits the query (skips the debounce)', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    // Don't advance the debounce timer — press Enter instead
    await pressEnter(input)
    // Counter should appear immediately (no debounce wait)
    expect(screen.getByText('1/1')).toBeInTheDocument()
  })

  it('Enter on committed query advances current match', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)
    expect(screen.getByText('1/2')).toBeInTheDocument()

    await pressEnter(input)
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })

  it('Shift+Enter retreats current match', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' }), makeEvent(2, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })
    expect(screen.getByText(/raw event logs/i)).toBeInTheDocument()
    await flushTimers(0)

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(300)

    await pressEnter(input, { shiftKey: true })
    // Wraps from 1 to 2
    expect(screen.getByText('2/2')).toBeInTheDocument()
  })
})

describe('LogsModal — matched-row indicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('marks rows that contain a match with data-has-match', async () => {
    setMockEvents([
      makeEvent(1, { tool_name: 'Bash' }),
      makeEvent(2, { tool_name: 'Read' }),
      makeEvent(3, { tool_name: 'Bash' }),
    ])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })

    const input = screen.getByPlaceholderText(/search payloads/i)
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(1100)

    // Two rows contain "Bash" in their payload, one doesn't.
    const matched = document.querySelectorAll('[data-has-match]')
    expect(matched.length).toBe(2)
  })

  it('clears the indicator when the query is cleared', async () => {
    setMockEvents([makeEvent(1, { tool_name: 'Bash' })])
    renderWithProviders(<LogsModal />)
    await act(async () => {
      fireEvent.click(screen.getByTitle(/view raw event logs/i))
      vi.runAllTimers()
    })

    const input = screen.getByPlaceholderText(/search payloads/i) as HTMLInputElement
    await act(async () => {
      fireEvent.change(input, { target: { value: 'Bash' } })
    })
    await flushTimers(1100)
    expect(document.querySelectorAll('[data-has-match]').length).toBe(1)

    await act(async () => {
      fireEvent.change(input, { target: { value: '' } })
    })
    await flushTimers(0)
    expect(document.querySelectorAll('[data-has-match]').length).toBe(0)
  })
})
