// Shared event processing context.
// Ensures a single EventStore processes events once, shared by
// event-stream, activity-timeline, and any other consumers.

import { createContext, useContext, useMemo, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useFilterStore } from '@/stores/filter-store'
import { EventStore } from './event-store'
import type { EnrichedEvent, FrameworkDataApi } from './types'
import type { CompiledFilter } from '@/lib/filters/types'
import type { ParsedEvent, Agent } from '@/types'

interface EventProcessingValue {
  events: EnrichedEvent[]
  dataApi: FrameworkDataApi
}

const EventProcessingContext = createContext<EventProcessingValue>({
  events: [],
  dataApi: {
    getAgent: () => undefined,
    getGroupedEvents: () => [],
    getTurnEvents: () => [],
    getAgentEvents: () => [],
  },
})

export function EventProcessingProvider({
  rawEvents,
  agents,
  children,
}: {
  rawEvents: ParsedEvent[] | undefined
  agents: Agent[]
  children: React.ReactNode
}) {
  const storeRef = useRef<EventStore>(new EventStore())
  const dedupEnabled = useUIStore((s) => s.dedupEnabled)

  // Snapshot the compiled filter set the first time the filter store
  // reports `loaded`. After that we deliberately do NOT subscribe to
  // further changes — filter edits in the modal only affect the running
  // event pipeline after a page refresh. This keeps the runtime cost of
  // Save/Delete/Toggle near-zero regardless of session size. The
  // Settings modal surfaces a "refresh to apply" prompt on close.
  const filtersLoaded = useFilterStore((s) => s.loaded)
  const pinnedFiltersRef = useRef<readonly CompiledFilter[] | null>(null)
  if (filtersLoaded && pinnedFiltersRef.current === null) {
    pinnedFiltersRef.current = useFilterStore.getState().compiled
  }

  const value = useMemo(() => {
    const store = storeRef.current
    store.setAgents(agents)

    if (!rawEvents || rawEvents.length === 0 || !filtersLoaded) {
      return {
        events: [] as EnrichedEvent[],
        dataApi: store.createDataApi(),
      }
    }

    const enriched = store.process(rawEvents, dedupEnabled, pinnedFiltersRef.current ?? [])

    return {
      events: enriched,
      dataApi: store.createDataApi(),
    }
  }, [rawEvents, agents, dedupEnabled, filtersLoaded])

  return <EventProcessingContext.Provider value={value}>{children}</EventProcessingContext.Provider>
}

export function useProcessedEvents(): EventProcessingValue {
  return useContext(EventProcessingContext)
}
