import { format } from 'timeago.js'
import type { EnrichedEvent } from '@/agents/types'

function formatTimeOfDay(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * Tooltip content for a timeline dot. The computations inside this component
 * only run when the tooltip is actually open — Radix's TooltipContent uses
 * Presence to mount children lazily, so rendering thousands of tooltip
 * elements in the parent's JSX has near-zero cost until one is shown.
 */
export function DotTooltipContent({ event }: { event: EnrichedEvent }) {
  const time = formatTimeOfDay(event.timestamp)
  const relative = format(event.timestamp)
  const hookLine = event.hookName !== event.label ? event.hookName : null

  return (
    <>
      <div className="flex items-baseline gap-2">
        <span className="font-medium">{event.label}</span>
        {hookLine && <span className="ml-auto text-[10px] font-normal opacity-70">{hookLine}</span>}
      </div>
      {event.summary && <div className="opacity-80 truncate">{event.summary}</div>}
      <div className="text-[10px] font-medium tabular-nums mt-0.5">
        {time} <span className="opacity-80">({relative})</span>
      </div>
    </>
  )
}
