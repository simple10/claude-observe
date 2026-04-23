import { memo, useRef, useMemo, useState, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { getRangeMs, getRangeTicks } from '@/config/time-ranges'
import { useUIStore } from '@/stores/ui-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AgentLabel } from '@/components/shared/agent-label'
import { AgentRegistry } from '@/agents/registry'
import type { Agent } from '@/types'
import type { EnrichedEvent, AgentClassRegistration } from '@/agents/types'

// Renders event dots inside a single animated container. Wrapped in
// React.memo with a content-aware equality below: on every WS flush
// the parent rebuilds the per-agent events array, but if no new dots
// actually appeared in THIS lane (same length, same trailing id) we
// skip the whole re-render. For large sessions with mostly-idle lanes,
// this short-circuits the dot reconciliation entirely.
function DotContainerInner({
  events,
  rangeMs,
  generation,
  setScrollToEventId,
  registration,
}: {
  events: EnrichedEvent[]
  rangeMs: number
  generation: number
  setScrollToEventId: (id: number | null) => void
  registration: AgentClassRegistration
}) {
  const [anchorTime, setAnchorTime] = useState(() => Date.now())
  const containerRef = useRef<HTMLDivElement>(null)
  // Hover state for the shared per-lane tooltip (one Radix Tooltip
  // instance driven by controlled open, rather than one Tooltip
  // wrapping each dot).
  const [hovered, setHovered] = useState<{ id: number; leftPct: number } | null>(null)

  useEffect(() => {
    setAnchorTime(Date.now())
  }, [generation])

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setAnchorTime(Date.now())
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const anim = el.animate(
      [{ transform: 'translate3d(0%, 0, 0)' }, { transform: 'translate3d(-100%, 0, 0)' }],
      {
        duration: rangeMs,
        easing: 'linear',
        fill: 'forwards',
      },
    )

    anim.onfinish = () => setAnchorTime(Date.now())
    return () => anim.cancel()
  }, [anchorTime, rangeMs])

  const hoveredEvent = hovered ? events.find((e) => e.id === hovered.id) ?? null : null

  return (
    <div ref={containerRef} className="absolute inset-0" style={{ willChange: 'transform' }}>
      {events.map((event) => {
        const position = ((event.timestamp - anchorTime) / rangeMs) * 100 + 100
        if (position < -5 || position > 205) return null

        // Resolve icon/color at render time for instant customization updates
        const Icon = registration.getEventIcon(event)
        const { dotColor, customHex } = registration.getEventColor(event)

        return (
          <button
            key={event.id}
            className={cn(
              'absolute h-5 w-5 cursor-pointer rounded-full flex items-center justify-center hover:ring-2 hover:ring-white/70',
              !customHex && dotColor,
            )}
            style={{
              left: `${position}%`,
              top: '50%',
              marginLeft: -10,
              marginTop: -10,
              backgroundColor: customHex,
            }}
            onClick={() => setScrollToEventId(event.id)}
            onPointerEnter={() => setHovered({ id: event.id, leftPct: position })}
            onPointerLeave={() =>
              setHovered((cur) => (cur && cur.id === event.id ? null : cur))
            }
          >
            <Icon className="h-3 w-3 text-white" />
          </button>
        )
      })}

      {/* One shared Tooltip for the whole lane. The trigger is an
          invisible pointer-events-none anchor span that we move to
          whichever dot is currently hovered. Radix handles side-flip
          and collision detection against that moving anchor. */}
      <Tooltip open={hovered !== null}>
        <TooltipTrigger asChild>
          <span
            aria-hidden
            className="absolute top-1/2 pointer-events-none block h-5 w-5"
            style={{
              left: hovered ? `${hovered.leftPct}%` : '0%',
              marginLeft: -10,
              marginTop: -10,
            }}
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs max-w-64">
          {hoveredEvent && <DotTooltipForEvent event={hoveredEvent} registration={registration} />}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

const DotContainer = memo(DotContainerInner, (prev, next) => {
  // Parent rebuilds `events` on every WS flush. If the new array has
  // the same length and the same trailing event id, it's effectively
  // the same set of dots — skip the re-render. Every other prop is a
  // stable reference (store action, registration object, numeric
  // rangeMs/generation), so strict equality is sufficient for them.
  if (prev.rangeMs !== next.rangeMs) return false
  if (prev.generation !== next.generation) return false
  if (prev.registration !== next.registration) return false
  if (prev.setScrollToEventId !== next.setScrollToEventId) return false
  const pe = prev.events
  const ne = next.events
  if (pe === ne) return true
  if (pe.length !== ne.length) return false
  if (pe.length === 0) return true
  return pe[pe.length - 1].id === ne[ne.length - 1].id
})

/** Renders the dot tooltip using the registered agent class's DotTooltip component. */
function DotTooltipForEvent({
  event,
  registration,
}: {
  event: EnrichedEvent
  registration: AgentClassRegistration
}) {
  const DotTooltip = registration.DotTooltip
  return <DotTooltip event={event} />
}

interface AgentLaneProps {
  agent: Agent
  parentAgent?: Agent | null
  events: EnrichedEvent[]
  allEvents: EnrichedEvent[]
  isSubagent: boolean
  color: string
}

export function AgentLane({
  agent,
  parentAgent,
  events,
  allEvents,
  isSubagent,
  color,
}: AgentLaneProps) {
  const agentId = agent.id
  const registration = AgentRegistry.get(agent.agentClass || 'claude-code')
  const { timeRange, setScrollToEventId, iconCustomizationVersion } = useUIStore()

  const rangeMs = useMemo(() => getRangeMs(timeRange), [timeRange])

  const generationRef = useRef(0)
  const prevRangeRef = useRef(rangeMs)
  if (prevRangeRef.current !== rangeMs) {
    prevRangeRef.current = rangeMs
    generationRef.current++
  }

  const prevCustomVersionRef = useRef(iconCustomizationVersion)
  if (prevCustomVersionRef.current !== iconCustomizationVersion) {
    prevCustomVersionRef.current = iconCustomizationVersion
    generationRef.current++
  }

  const generation = generationRef.current

  const visibleEvents = useMemo(() => {
    const cutoff = Date.now() - rangeMs
    let lo = 0
    let hi = events.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (events[mid].timestamp < cutoff) lo = mid + 1
      else hi = mid
    }
    return lo >= events.length ? [] : events.slice(lo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, rangeMs])

  const ticks = useMemo(() => {
    const rangeSec = rangeMs / 1000
    const count = getRangeTicks(timeRange)
    const stepSec = rangeSec / count
    const result: { pct: number; label: string }[] = []
    for (let i = 0; i <= count; i++) {
      const sec = i * stepSec
      const pct = 100 - (sec / rangeSec) * 100
      let label: string
      if (i === 0) label = 'now'
      else if (sec < 60) label = `${sec}s`
      else if (sec < 3600) label = `${Math.round(sec / 60)}m`
      else label = `${Math.round(sec / 3600)}h`
      result.push({ pct, label })
    }
    return result
  }, [timeRange, rangeMs])

  const handleAgentNameClick = useCallback(() => {
    const agentEvents = allEvents.filter((e) => e.agentId === agentId)
    if (agentEvents.length > 0) {
      const first = agentEvents.reduce((a, b) => (a.id < b.id ? a : b))
      setScrollToEventId(first.id)
    }
  }, [allEvents, agentId, setScrollToEventId])

  return (
    // Dots area is an absolutely-positioned sibling of the button
    // (not a flex cell) so its animating container doesn't share a
    // rendering context with the button's opacity. Leaving the two
    // in the same flex row was causing the browser to compose the
    // whole lane as a single CPU-painted layer, dropping the
    // animation off the GPU.
    <div className="relative h-8 border-b border-border/30">
      <button
        className={cn(
          'absolute left-0 top-0 bottom-0 w-40 text-[10px] truncate px-2 text-left cursor-pointer hover:underline flex items-center gap-1',
          color,
          isSubagent ? 'opacity-80 dark:opacity-50' : 'opacity-100 dark:opacity-70',
        )}
        onClick={handleAgentNameClick}
      >
        {isSubagent ? <span className="shrink-0">↳</span> : null}
        <registration.Icon className="h-3 w-3 shrink-0" />
        <AgentLabel agent={agent} parentAgent={parentAgent} tooltipSide="top" />
      </button>

      <div className="absolute left-40 top-0 right-0 bottom-0 overflow-hidden">
        {visibleEvents.length > 0 && (
          <DotContainer
            events={visibleEvents}
            rangeMs={rangeMs}
            generation={generation}
            setScrollToEventId={setScrollToEventId}
            registration={registration}
          />
        )}

        {ticks.map(({ pct, label }, i) => (
          <div
            key={i}
            className="absolute top-0 bottom-0 flex flex-col items-center"
            style={{ left: `${pct}%` }}
          >
            <div className="w-px h-full border-l border-border/20" />
            <div className="absolute bottom-0 text-[7px] text-muted-foreground/70 dark:text-muted-foreground/40 -translate-x-1/2 leading-none">
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
