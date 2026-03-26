import { useRef, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { getEventIcon } from '@/config/event-icons'
import { getEventSummary } from '@/lib/event-summary'
import { useUIStore } from '@/stores/ui-store'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ParsedEvent } from '@/types'

interface AgentLaneProps {
  agentName: string
  events: ParsedEvent[]
  isSubagent: boolean
  color: string
}

// Friendly label for tooltips
function tooltipLabel(event: ParsedEvent): string {
  if (event.subtype === 'PreToolUse' || event.subtype === 'PostToolUse') {
    return event.toolName || 'Tool'
  }
  const map: Record<string, string> = {
    UserPromptSubmit: 'Prompt',
    Stop: 'Stop',
    SessionStart: 'Session Start',
  }
  return map[event.subtype || ''] || event.subtype || event.type
}

export function AgentLane({ agentName, events, isSubagent, color }: AgentLaneProps) {
  const { timeRange, setScrollToEventId } = useUIStore()
  const containerRef = useRef<HTMLDivElement>(null)

  const rangeMs = useMemo(() => {
    const ranges = { '1m': 60_000, '5m': 300_000, '10m': 600_000 }
    return ranges[timeRange]
  }, [timeRange])

  const now = Date.now()

  const visibleEvents = useMemo(
    () => events.filter((e) => now - e.timestamp < rangeMs),
    [events, now, rangeMs],
  )

  // Tick marks based on time range
  const ticks = useMemo(() => {
    const rangeSec = rangeMs / 1000
    const count = { '1m': 6, '5m': 5, '10m': 5 }[timeRange]
    const stepSec = rangeSec / count
    const result: { pct: number; label: string }[] = []
    for (let i = 0; i <= count; i++) {
      const sec = i * stepSec
      const pct = 100 - (sec / rangeSec) * 100
      let label: string
      if (i === 0) label = 'now'
      else if (sec < 60) label = `${sec}s`
      else label = `${Math.round(sec / 60)}m`
      result.push({ pct, label })
    }
    return result
  }, [timeRange, rangeMs])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let animFrame: number
    function tick() {
      container!.style.setProperty('--now', String(Date.now()))
      animFrame = requestAnimationFrame(tick)
    }
    animFrame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animFrame)
  }, [])

  return (
    <div className="flex items-center h-8 border-b border-border/30">
      <div
        className={cn('w-28 shrink-0 text-[10px] truncate px-2', color)}
        style={{ opacity: isSubagent ? 0.5 : 0.7 }}
        title={agentName}
      >
        {isSubagent ? '↳ ' : ''}
        {agentName}
      </div>

      <div ref={containerRef} className="flex-1 relative h-full overflow-hidden">
        {visibleEvents.map((event) => {
          const age = Date.now() - event.timestamp
          const position = 100 - (age / rangeMs) * 100
          if (position < 0 || position > 100) return null

          const icon = getEventIcon(event.subtype, event.toolName)
          const summary = getEventSummary(event)

          return (
            <Tooltip key={event.id}>
              <TooltipTrigger asChild>
                <button
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-sm cursor-pointer hover:scale-125 transition-transform"
                  style={{ left: `${position}%` }}
                  onClick={() => setScrollToEventId(event.id)}
                >
                  {icon}
                </button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs max-w-64">
                <div className="font-medium">{tooltipLabel(event)}</div>
                {summary && <div className="text-muted-foreground truncate">{summary}</div>}
              </TooltipContent>
            </Tooltip>
          )
        })}

        {/* Time tick marks */}
        {ticks.map(({ pct, label }) => (
          <div
            key={label}
            className="absolute top-0 bottom-0 flex flex-col items-center"
            style={{ left: `${pct}%` }}
          >
            <div className="w-px h-full border-l border-border/20" />
            <div className="absolute bottom-0 text-[7px] text-muted-foreground/40 -translate-x-1/2 leading-none">
              {label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
