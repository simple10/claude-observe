import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, render, cleanup } from '@testing-library/react'
import { useUIStore } from '@/stores/ui-store'
import { ACTIVITY_CONFIG } from '@/config/activity'
import { useSessionPulseActive, useAggregatePulseActive } from './use-pulse-active'

function SessionProbe({
  sessionId,
  onValue,
}: {
  sessionId: string
  onValue: (v: boolean) => void
}) {
  const active = useSessionPulseActive(sessionId)
  onValue(active)
  return null
}

function AggregateProbe({
  sessionIds,
  onValue,
}: {
  sessionIds: string[]
  onValue: (v: boolean) => void
}) {
  const active = useAggregatePulseActive(sessionIds)
  onValue(active)
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  useUIStore.setState({ sessionPulses: {} })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useSessionPulseActive', () => {
  it('starts inactive when the session has never pulsed', () => {
    const values: boolean[] = []
    render(<SessionProbe sessionId="sess-1" onValue={(v) => values.push(v)} />)
    expect(values.at(-1)).toBe(false)
  })

  it('stays inactive on mount even if the session already has a pulse count (no spurious pulse)', () => {
    // Simulate: session pulsed before this component mounted. The
    // hook should NOT activate on mount — it only reacts to changes.
    useUIStore.setState({ sessionPulses: { 'sess-1': 5 } })
    const values: boolean[] = []
    render(<SessionProbe sessionId="sess-1" onValue={(v) => values.push(v)} />)
    expect(values.at(-1)).toBe(false)
  })

  it('activates when a pulse arrives after mount', () => {
    const values: boolean[] = []
    render(<SessionProbe sessionId="sess-1" onValue={(v) => values.push(v)} />)
    expect(values.at(-1)).toBe(false)
    act(() => {
      useUIStore.getState().pulseSession('sess-1')
    })
    expect(values.at(-1)).toBe(true)
  })

  it('deactivates after pulseDurationMs', () => {
    const values: boolean[] = []
    render(<SessionProbe sessionId="sess-1" onValue={(v) => values.push(v)} />)
    act(() => {
      useUIStore.getState().pulseSession('sess-1')
    })
    expect(values.at(-1)).toBe(true)
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_CONFIG.pulseDurationMs - 1)
    })
    expect(values.at(-1)).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(values.at(-1)).toBe(false)
  })

  it('resets the timer when a second pulse arrives mid-animation', () => {
    const values: boolean[] = []
    render(<SessionProbe sessionId="sess-1" onValue={(v) => values.push(v)} />)
    act(() => {
      useUIStore.getState().pulseSession('sess-1')
    })
    // Advance 80% through the window, then ping again.
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_CONFIG.pulseDurationMs * 0.8)
    })
    expect(values.at(-1)).toBe(true)
    act(() => {
      useUIStore.getState().pulseSession('sess-1')
    })
    // Original window would have expired by now, but the new ping
    // reset the timer so we're still active.
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_CONFIG.pulseDurationMs * 0.5)
    })
    expect(values.at(-1)).toBe(true)
    // Fully past the new window → inactive.
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_CONFIG.pulseDurationMs)
    })
    expect(values.at(-1)).toBe(false)
  })

  it('does not activate on pulses for a different session', () => {
    const values: boolean[] = []
    render(<SessionProbe sessionId="sess-1" onValue={(v) => values.push(v)} />)
    act(() => {
      useUIStore.getState().pulseSession('sess-2')
    })
    expect(values.at(-1)).toBe(false)
  })
})

describe('useAggregatePulseActive', () => {
  it('activates when any of the listed sessions pulses', () => {
    const values: boolean[] = []
    render(<AggregateProbe sessionIds={['a', 'b', 'c']} onValue={(v) => values.push(v)} />)
    expect(values.at(-1)).toBe(false)
    act(() => {
      useUIStore.getState().pulseSession('b')
    })
    expect(values.at(-1)).toBe(true)
  })

  it('ignores pulses on sessions not in the list', () => {
    const values: boolean[] = []
    render(<AggregateProbe sessionIds={['a', 'b']} onValue={(v) => values.push(v)} />)
    act(() => {
      useUIStore.getState().pulseSession('c')
    })
    expect(values.at(-1)).toBe(false)
  })

  it('deactivates after pulseDurationMs from the last child pulse', () => {
    const values: boolean[] = []
    render(<AggregateProbe sessionIds={['a', 'b']} onValue={(v) => values.push(v)} />)
    act(() => {
      useUIStore.getState().pulseSession('a')
    })
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_CONFIG.pulseDurationMs * 0.6)
    })
    // Second child pulses — timer restarts.
    act(() => {
      useUIStore.getState().pulseSession('b')
    })
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_CONFIG.pulseDurationMs * 0.6)
    })
    expect(values.at(-1)).toBe(true)
    act(() => {
      vi.advanceTimersByTime(ACTIVITY_CONFIG.pulseDurationMs)
    })
    expect(values.at(-1)).toBe(false)
  })
})
