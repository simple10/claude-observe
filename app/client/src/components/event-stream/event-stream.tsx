import { useMemo, useRef, useEffect, useDeferredValue, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useQuery } from '@tanstack/react-query'
import { useEffectiveEvents } from '@/hooks/use-effective-events'
import { useAgents } from '@/hooks/use-agents'
import { useDedupedEvents } from '@/hooks/use-deduped-events'
import { usePermissionModeBackfill } from '@/hooks/use-permission-mode-backfill'
import { getTimelineScrollTo, registerEventStreamScroll, withSyncLock } from '@/lib/scroll-sync'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { EventRow } from './event-row'
import { eventMatchesFilters } from '@/config/filters'
import { format } from 'timeago.js'
import { buildAgentColorMap } from '@/lib/agent-utils'
import { QueryBoundary } from '@/components/shared/query-boundary'
import { EmptyState, Spinner } from '@/components/shared/loading-states'
import type { Agent } from '@/types'

export function EventStream() {
  const {
    selectedSessionId,
    selectedAgentIds,
    activeStaticFilters,
    activeToolFilters,
    searchQuery,
    autoFollow,
    expandAllCounter,
    expandAllEvents,
    selectedEventId,
    rewindMode,
  } = useUIStore()

  // Defer filter values so the UI stays responsive during filter changes
  const deferredStaticFilters = useDeferredValue(activeStaticFilters)
  const deferredToolFilters = useDeferredValue(activeToolFilters)
  const deferredSearchQuery = useDeferredValue(searchQuery)

  const eventsQuery = useEffectiveEvents(selectedSessionId)
  // Defer the event list so React can yield to the browser during the heavy
  // dedupe/filter/render pipeline. On the initial transition from undefined
  // to a large array, React's urgent render uses the old value (undefined),
  // keeping the spinner visible while a background render processes the
  // new events. This also makes filter toggles feel snappier on large
  // sessions.
  const events = useDeferredValue(eventsQuery.data)
  const displayQuery = useMemo(
    () => ({
      data: events,
      // Stay in "loading" while the deferred render is catching up — this
      // keeps the spinner mounted and animating during the heavy render.
      isLoading: eventsQuery.isLoading || (eventsQuery.data !== undefined && events === undefined),
      isError: eventsQuery.isError,
      error: eventsQuery.error,
    }),
    [events, eventsQuery.data, eventsQuery.isLoading, eventsQuery.isError, eventsQuery.error],
  )

  const agents = useAgents(selectedSessionId, events)

  // Backfill permission_mode into session metadata if missing.
  // Long staleTime — this only needs to run once per session, not on every WS update.
  const { data: sessionForBackfill } = useQuery({
    queryKey: ['session-backfill', selectedSessionId],
    queryFn: () => api.getSession(selectedSessionId!),
    enabled: !!selectedSessionId,
    staleTime: Infinity,
  })
  usePermissionModeBackfill(sessionForBackfill, events, agents)

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>()
    agents.forEach((a) => map.set(a.id, a))
    return map
  }, [agents])

  const agentColorMap = useMemo(() => buildAgentColorMap(agents), [agents])

  // Dedupe tool events + build spawn map (shared with timeline-rewind)
  const { deduped, spawnToolUseIds, spawnInfo, mergedIdMap, pairedPayloads } =
    useDedupedEvents(events)

  // Apply all client-side filters: agent selection + static/tool filters
  const filteredEvents = useMemo(() => {
    let filtered = deduped

    // Agent chip filtering (client-side, includes spawning Tool:Agent calls)
    if (selectedAgentIds.length > 0) {
      const spawnIds = new Set<string>()
      for (const agentId of selectedAgentIds) {
        const toolUseId = spawnToolUseIds.get(agentId)
        if (toolUseId) spawnIds.add(toolUseId)
      }
      filtered = filtered.filter(
        (e) =>
          selectedAgentIds.includes(e.agentId) ||
          (e.toolUseId != null && spawnIds.has(e.toolUseId)),
      )
    }

    // Static + dynamic tool filters
    if (deferredStaticFilters.length > 0 || deferredToolFilters.length > 0) {
      filtered = filtered.filter((e) =>
        eventMatchesFilters(e, deferredStaticFilters, deferredToolFilters),
      )
    }

    // Text search — case-insensitive substring match across key fields and payload
    // Skip search if query is only whitespace (don't trim — users may want leading/trailing spaces)
    if (deferredSearchQuery && deferredSearchQuery.trim().length > 0) {
      const q = deferredSearchQuery.toLowerCase()
      filtered = filtered.filter((e) => {
        if (e.toolName?.toLowerCase().includes(q)) return true
        if (e.subtype?.toLowerCase().includes(q)) return true
        if (e.type?.toLowerCase().includes(q)) return true
        // Search stringified payload
        if (JSON.stringify(e.payload).toLowerCase().includes(q)) return true
        return false
      })
    }

    return filtered
  }, [
    deduped,
    selectedAgentIds,
    spawnToolUseIds,
    deferredStaticFilters,
    deferredToolFilters,
    deferredSearchQuery,
  ])

  const scrollToEventId = useUIStore((s) => s.scrollToEventId)
  const setScrollToEventId = useUIStore((s) => s.setScrollToEventId)

  const showAgentLabel = agents.length > 1
  const scrollRef = useRef<HTMLDivElement>(null)
  const hasInitiallyScrolled = useRef(false)

  // Virtualizer: only renders rows in (and near) the viewport, so sessions
  // with thousands of events don't destroy performance.
  const virtualizer = useVirtualizer({
    count: filteredEvents.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36, // base row height; measureElement fixes up actuals
    overscan: 10,
    // Keep a stable key per event so height measurements survive list changes
    getItemKey: (index) => filteredEvents[index]?.id ?? index,
  })

  const virtualItems = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  // Auto-scroll to bottom on first load of a session
  useEffect(() => {
    hasInitiallyScrolled.current = false
  }, [selectedSessionId])

  useEffect(() => {
    if (!hasInitiallyScrolled.current && filteredEvents.length > 0) {
      virtualizer.scrollToIndex(filteredEvents.length - 1, { align: 'end' })
      hasInitiallyScrolled.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents.length])

  // Auto-scroll to bottom when new events arrive (if autoFollow is enabled)
  useEffect(() => {
    if (autoFollow && filteredEvents.length > 0) {
      virtualizer.scrollToIndex(filteredEvents.length - 1, { align: 'end' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFollow, filteredEvents.length])

  // Expand all events when requested from the scope bar
  useEffect(() => {
    if (expandAllCounter > 0 && filteredEvents.length > 0) {
      expandAllEvents(filteredEvents.map((e) => e.id))
    }
  }, [expandAllCounter])

  // ── Rewind mode scroll sync ──────────────────────────────────────────
  // Scrolling the event stream drives the timeline's horizontal scroll.
  // Uses the virtualizer's own knowledge of item positions instead of the
  // DOM, since most rows aren't mounted with virtualization enabled.
  const syncTimelineFromScroll = useCallback(() => {
    const container = scrollRef.current
    if (!container) return
    const top = container.scrollTop
    // Find the first virtual item whose bottom edge is below the viewport top
    const items = virtualizer.getVirtualItems()
    for (const item of items) {
      if (item.start + item.size > top) {
        const event = filteredEvents[item.index]
        if (event) {
          getTimelineScrollTo()?.(event.timestamp)
        }
        return
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents])

  // Attach scroll listener only while in rewind mode
  useEffect(() => {
    if (!rewindMode) return
    const container = scrollRef.current
    if (!container) return
    const onScroll = () => {
      withSyncLock('event-stream', syncTimelineFromScroll)
    }
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [rewindMode, syncTimelineFromScroll])

  // Register the event-stream scroll-to callback for reverse sync.
  // Uses virtualizer.scrollToIndex so the target row gets mounted and measured.
  // Must re-register when filteredEvents changes so the callback sees the
  // current filtered array (otherwise findIndex works on a stale list after
  // a filter change in rewind mode).
  useEffect(() => {
    if (!rewindMode) {
      registerEventStreamScroll(null)
      return
    }
    registerEventStreamScroll((eventId) => {
      const idx = filteredEvents.findIndex((e) => e.id === eventId)
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: 'start' })
      }
    })
    return () => registerEventStreamScroll(null)
    // virtualizer is stable across renders; intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rewindMode, filteredEvents])

  // Initial sync when entering rewind mode: wait for timeline to mount, then
  // sync timeline to match current event stream scroll position.
  useEffect(() => {
    if (!rewindMode) return
    // Two rAF waits: one for timeline to mount, one for its scroll registration
    let id2: number | null = null
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(() => {
        withSyncLock('event-stream', syncTimelineFromScroll)
      })
    })
    return () => {
      cancelAnimationFrame(id1)
      if (id2 != null) cancelAnimationFrame(id2)
    }
  }, [rewindMode, syncTimelineFromScroll])

  // Auto-scroll to the selected event when filteredEvents change (i.e. filters change)
  const prevFilteredRef = useRef(filteredEvents)
  useEffect(() => {
    if (selectedEventId != null && filteredEvents !== prevFilteredRef.current) {
      const idx = filteredEvents.findIndex((e) => e.id === selectedEventId)
      if (idx >= 0) {
        virtualizer.scrollToIndex(idx, { align: 'center' })
      }
    }
    prevFilteredRef.current = filteredEvents
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredEvents, selectedEventId])

  // Scroll to a requested event (set via setScrollToEventId — e.g. timeline dot click).
  // Resolves merged events (PostToolUse → displayed PreToolUse row), scrolls the
  // virtualizer to the target row, then sets flashingEventId so the row pulses.
  // Flash state lives in the store so it survives row unmount/remount during
  // virtualized scrolling — important in rewind mode where target rows can be far.
  const setFlashingEventId = useUIStore((s) => s.setFlashingEventId)
  useEffect(() => {
    if (scrollToEventId == null) return
    // Always clear so the next click of the same dot retriggers
    setScrollToEventId(null)
    // Resolve merged event IDs (PostToolUse id → PreToolUse row id) inline,
    // so a single render handles both the remap and the scroll.
    const resolvedId = mergedIdMap.get(scrollToEventId) ?? scrollToEventId
    const idx = filteredEvents.findIndex((e) => e.id === resolvedId)
    if (idx < 0) return
    virtualizer.scrollToIndex(idx, { align: 'center' })
    setFlashingEventId(resolvedId)
    const timeout = setTimeout(() => {
      // Only clear if we're still flashing this same event (avoid clobbering
      // a newer flash triggered during the timeout window).
      if (useUIStore.getState().flashingEventId === resolvedId) {
        setFlashingEventId(null)
      }
    }, 1200) // matches 3 × 0.4s flash-ring keyframe
    return () => clearTimeout(timeout)
    // virtualizer is stable; intentionally omitted from deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollToEventId, filteredEvents, mergedIdMap, setScrollToEventId, setFlashingEventId])

  if (!selectedSessionId) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
        Select a project to view events
      </div>
    )
  }

  const firstTs = filteredEvents[0]?.timestamp
  const lastTs = filteredEvents[filteredEvents.length - 1]?.timestamp
  const rawCount = events?.length ?? 0
  const showRawCount = rawCount !== filteredEvents.length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <QueryBoundary
        query={displayQuery}
        loading={
          <div className="flex-1 flex items-center justify-center">
            <Spinner label="Loading events..." />
          </div>
        }
        empty={
          <div className="flex-1 flex items-center justify-center">
            <EmptyState text="No events in this session" />
          </div>
        }
        isEmpty={(events) => events.length === 0}
      >
        {() => (
          <>
            <div className="flex items-center gap-2 px-3 py-1 border-b border-border/50 shrink-0">
              <span className="text-xs text-muted-foreground">
                Events: <span className="text-foreground">{filteredEvents.length}</span>
                {showRawCount && (
                  <span className="text-muted-foreground/70 dark:text-muted-foreground/50">
                    {' '}
                    / {rawCount} raw
                  </span>
                )}
              </span>
              {firstTs && lastTs && (
                <span className="text-[10px] text-muted-foreground/70 dark:text-muted-foreground/50">
                  {format(firstTs)} — {format(lastTs)}
                </span>
              )}
            </div>
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              {filteredEvents.length === 0 ? (
                <EmptyState text="No events match the current filters" />
              ) : (
                <div className="relative" style={{ height: `${totalSize}px`, width: '100%' }}>
                  {virtualItems.map((virtualItem) => {
                    const event = filteredEvents[virtualItem.index]
                    if (!event) return null
                    return (
                      <div
                        key={virtualItem.key}
                        ref={virtualizer.measureElement}
                        data-index={virtualItem.index}
                        className="absolute top-0 left-0 w-full border-b border-border/50"
                        style={{ transform: `translateY(${virtualItem.start}px)` }}
                      >
                        <EventRow
                          event={event}
                          agentMap={agentMap}
                          agentColorMap={agentColorMap}
                          showAgentLabel={showAgentLabel}
                          spawnInfo={spawnInfo.get(event.agentId)}
                          pairedPayloads={pairedPayloads.get(event.id)}
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </QueryBoundary>
    </div>
  )
}
