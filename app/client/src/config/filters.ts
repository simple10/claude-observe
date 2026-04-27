import type { EnrichedEvent } from '@/agents/types'

export interface StaticFilter {
  label: string
  /** Static category that `processEvent` writes to `filterTags.static`.
   *  An event matches this filter if its filterTag matches OR — for the
   *  special "Errors" filter — `event.status === 'failed'`. */
  category?: string
  /** Special-case for the Errors filter, which matches across categories. */
  matchesErrors?: boolean
}

export const STATIC_FILTERS: StaticFilter[] = [
  { label: 'Prompts', category: 'Prompts' },
  { label: 'Tools', category: 'Tools' },
  { label: 'Agents', category: 'Agents' },
  { label: 'Tasks', category: 'Tasks' },
  { label: 'Session', category: 'Session' },
  { label: 'MCP', category: 'MCP' },
  { label: 'Permissions', category: 'Permissions' },
  { label: 'Notifications', category: 'Notifications' },
  { label: 'Stop', category: 'Stop' },
  { label: 'Compaction', category: 'Compaction' },
  { label: 'Errors', matchesErrors: true },
  { label: 'Config', category: 'Config' },
]

/**
 * Test whether an event matches a static filter.
 *
 * `Errors` is the only cross-category filter — it matches any event with
 * `status === 'failed'`. Every other filter is a pure category lookup
 * against `filterTags.static`.
 */
export function matchesStaticFilter(event: EnrichedEvent, filter: StaticFilter): boolean {
  if (filter.matchesErrors) return event.status === 'failed'
  if (filter.category) return event.filterTags.static === filter.category
  return false
}

/**
 * Aggregate the unique dynamic filter names present in an event list.
 * Used by the filter bar to render the second-row pills (`Bash`, `Grep`,
 * `mcp__chrome-devtools`, etc.).
 */
export function getDynamicFilterNames(events: EnrichedEvent[]): string[] {
  const names = new Set<string>()
  for (const e of events) {
    for (const tag of e.filterTags.dynamic) names.add(tag)
  }
  return [...names].sort()
}

/** Test whether an event matches a dynamic filter (toolName-style pill). */
export function matchesDynamicFilter(event: EnrichedEvent, name: string): boolean {
  return event.filterTags.dynamic.includes(name)
}
