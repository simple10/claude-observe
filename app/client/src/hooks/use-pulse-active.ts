import { useEffect, useRef, useState } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { ACTIVITY_CONFIG } from '@/config/activity'

/**
 * Returns true for `pulseDurationMs` after the given session last received
 * an activity ping from the server, then flips back to false.
 *
 * The pulse counter lives in ui-store and is incremented by the WS handler
 * on every `{ type: 'activity' }` message. We read it here, track changes
 * with a ref, and schedule a timeout to reset `active` back to false.
 */
export function useSessionPulseActive(sessionId: string): boolean {
  const pulseCount = useUIStore((s) => s.sessionPulses[sessionId] ?? 0)
  return usePulseTimer(pulseCount)
}

/**
 * Variant that aggregates a set of session pulse counters into a single
 * value, so any child pulse re-triggers the timer. Used for the project
 * rollup — pulses any time any of its child sessions pulses.
 */
export function useAggregatePulseActive(sessionIds: string[]): boolean {
  const sum = useUIStore((s) => {
    let total = 0
    for (const id of sessionIds) total += s.sessionPulses[id] ?? 0
    return total
  })
  return usePulseTimer(sum)
}

function usePulseTimer(counter: number): boolean {
  const prevRef = useRef(counter)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    // Skip the first render when counter is already > 0 — that means
    // the session already pulsed before this component mounted, and we
    // don't want a spurious pulse on mount. The counter is monotonic,
    // so on subsequent renders any change means a real new ping.
    if (counter === prevRef.current) return
    prevRef.current = counter
    setActive(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setActive(false)
      timerRef.current = null
    }, ACTIVITY_CONFIG.pulseDurationMs)
  }, [counter])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return active
}
