import { useMemo } from 'react'
import type { ParsedEvent } from '@/types'

/**
 * Dedupe tool events by merging PostToolUse into the corresponding PreToolUse row.
 *
 * Consumed only by the rewind timeline (`timeline-rewind.tsx`); the main event
 * stream does its own dedup via the claude-code agent lib's `processEvent`
 * (see `agents/claude-code/process-event.ts`).
 */
/** Read `tool_use_id` from a raw event payload (Claude-Code-specific key). */
function payloadToolUseId(e: ParsedEvent): string | null {
  const v = (e.payload as Record<string, unknown>).tool_use_id
  return typeof v === 'string' && v ? v : null
}

export function useDedupedEvents(events: ParsedEvent[] | undefined): ParsedEvent[] {
  return useMemo(() => {
    if (!events) return []
    const result: ParsedEvent[] = []
    const toolUseMap = new Map<string, number>() // toolUseId -> index in result

    for (const e of events) {
      const toolUseId = payloadToolUseId(e)
      if (e.subtype === 'PreToolUse' && toolUseId) {
        toolUseMap.set(toolUseId, result.length)
        result.push({ ...e }) // copy so we can mutate status
      } else if (
        (e.subtype === 'PostToolUse' || e.subtype === 'PostToolUseFailure') &&
        toolUseId &&
        toolUseMap.has(toolUseId)
      ) {
        const idx = toolUseMap.get(toolUseId)!
        const preEvent = result[idx]
        result[idx] = {
          ...preEvent,
          status: e.subtype === 'PostToolUseFailure' ? 'failed' : 'completed',
          payload: e.payload,
        }
      } else {
        result.push(e)
      }
    }
    return result
  }, [events])
}
