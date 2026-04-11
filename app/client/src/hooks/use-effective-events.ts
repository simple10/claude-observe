import { useEvents } from '@/hooks/use-events'
import { useUIStore } from '@/stores/ui-store'
import type { QueryState } from '@/components/shared/query-boundary'
import type { ParsedEvent } from '@/types'

/**
 * Returns the frozen event snapshot when in rewind mode, otherwise live events
 * from react-query. Both timeline and event-stream read events through this
 * hook so they stay in sync with the frozen state.
 *
 * Returns a QueryState shape compatible with <QueryBoundary> so consumers
 * can render loading/error/empty states without branching.
 */
export function useEffectiveEvents(sessionId: string | null): QueryState<ParsedEvent[]> {
  const live = useEvents(sessionId)
  const rewindMode = useUIStore((s) => s.rewindMode)
  const frozenEvents = useUIStore((s) => s.frozenEvents)

  if (rewindMode && frozenEvents) {
    return {
      data: frozenEvents,
      isLoading: false,
      isError: false,
      error: null,
    }
  }

  return {
    data: live.data,
    isLoading: live.isLoading,
    isError: live.isError,
    error: (live.error as Error) || null,
  }
}
