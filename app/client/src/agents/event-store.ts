import type { Agent } from '@/types'
import type { EnrichedEvent, RawEvent, ProcessingContext, FrameworkDataApi } from './types'
import type { CompiledFilter } from '@/lib/filters/types'
import { applyFilters } from '@/lib/filters/matcher'
import { AgentRegistry } from './registry'

/**
 * Stores enriched events and provides indexed lookups.
 * Processes raw events through the registered agent class's processEvent.
 */
export class EventStore {
  private events: EnrichedEvent[] = []
  private eventById = new Map<number, EnrichedEvent>()
  private groupIndex = new Map<string, EnrichedEvent[]>()
  private turnIndex = new Map<string, EnrichedEvent[]>()
  private agentIndex = new Map<string, EnrichedEvent[]>()
  private currentTurns = new Map<string, string>()
  private pendingGroups = new Map<string, string>()
  // Subagent-pairing scratchpad. Populated by PreToolUse:Agent and
  // consumed by PostToolUse:Agent — see
  // `agents/claude-code/process-event.ts`. Map key is the
  // `payload.tool_use_id` of the spawning Agent tool call.
  private pendingAgentMeta = new Map<string, { name: string | null; description: string | null }>()
  private pendingUpdates: Array<{ eventId: number; changes: Partial<EnrichedEvent> }> = []
  private dedupEnabled = true
  private compiledFilters: readonly import('@/lib/filters/types').CompiledFilter[] = []
  private lastCompiledFilters: readonly import('@/lib/filters/types').CompiledFilter[] = []

  // Agent class lookup — set by the framework from the agents query
  private agentClassMap = new Map<string, string>()
  private agentMap = new Map<string, Agent>()

  /**
   * Update the agent class mapping (called when agents data changes).
   */
  setAgents(agents: Agent[]) {
    this.agentMap.clear()
    this.agentClassMap.clear()
    for (const agent of agents) {
      this.agentMap.set(agent.id, agent)
      // Legacy rows lack agent_class; treat missing as claude-code so the
      // historical Claude Code data keeps rendering correctly.
      this.agentClassMap.set(agent.id, agent.agentClass || 'claude-code')
    }
  }

  // Track what we've already processed to enable incremental updates
  private lastProcessedCount = 0
  private lastDedupEnabled = true
  private lastRawEvents: RawEvent[] | null = null

  /**
   * Process raw events. Automatically detects whether to do a full
   * reprocess, a filter-only reapply, an incremental append, or a no-op.
   */
  process(
    rawEvents: RawEvent[],
    dedupEnabled: boolean,
    compiledFilters: readonly CompiledFilter[],
  ): EnrichedEvent[] {
    // Fast path: only `compiledFilters` changed. Re-run applyFilters on
    // each enriched event in place — skipping the entire agent-class
    // enrichment pipeline (toolName derivation, dedup pairing, slot
    // computation, summary, etc.) which is what makes full reprocesses
    // expensive on large sessions.
    const onlyFiltersChanged =
      rawEvents === this.lastRawEvents &&
      dedupEnabled === this.lastDedupEnabled &&
      compiledFilters !== this.lastCompiledFilters &&
      this.events.length > 0

    if (onlyFiltersChanged) {
      this.compiledFilters = compiledFilters
      this.lastCompiledFilters = compiledFilters
      this.reapplyFiltersInPlace()
      return this.events
    }

    const needsFullReprocess =
      dedupEnabled !== this.lastDedupEnabled ||
      compiledFilters !== this.lastCompiledFilters ||
      rawEvents.length < this.lastProcessedCount ||
      (this.lastProcessedCount > 0 &&
        rawEvents.length > 0 &&
        rawEvents[0]?.id !== this.events[0]?.id)

    if (needsFullReprocess) {
      this.clear()
      this.dedupEnabled = dedupEnabled
      this.compiledFilters = compiledFilters
      this.lastDedupEnabled = dedupEnabled
      this.lastCompiledFilters = compiledFilters
      for (const raw of rawEvents) {
        this.processOne(raw)
      }
      this.lastProcessedCount = rawEvents.length
      this.lastRawEvents = rawEvents
      return this.events
    }

    // Incremental: only process newly appended events
    this.dedupEnabled = dedupEnabled
    this.compiledFilters = compiledFilters
    const newEvents = rawEvents.slice(this.lastProcessedCount)
    if (newEvents.length === 0) return this.events
    for (const raw of newEvents) {
      this.processOne(raw)
    }
    this.lastProcessedCount = rawEvents.length
    this.lastRawEvents = rawEvents
    this.events = [...this.events]
    return this.events
  }

  /**
   * Patch event.filters on every existing enriched event using the
   * current compiledFilters set. Cheap relative to a full reprocess:
   * one applyFilters call per event, no agent-class re-derivation, no
   * dedup pairing. Merged events use their stored `mergedPayload` so
   * filter matches stay consistent with the merge-time computation.
   *
   * Events whose .filters arrays come out identical to before are left
   * with their existing object reference, and if NO event changed at
   * all we don't even reset the top-level array — so a New-Filter click
   * with an inert regex (`^$`) costs N regex tests and zero re-renders.
   */
  private reapplyFiltersInPlace(): void {
    let anyChanged = false
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i]
      const synthRaw: RawEvent = {
        id: e.id,
        agentId: e.agentId,
        hookName: e.hookName,
        timestamp: e.timestamp,
        payload: e.mergedPayload ?? e.payload,
      }
      const next = applyFilters(synthRaw, e.toolName, this.compiledFilters)
      if (sameNames(e.filters.primary, next.primary) && sameNames(e.filters.secondary, next.secondary)) {
        continue
      }
      anyChanged = true
      const updated = { ...e, filters: next }
      this.events[i] = updated
      this.eventById.set(e.id, updated)
      this.updateIndexReference(this.groupIndex, e.groupId, e, updated)
      this.updateIndexReference(this.turnIndex, e.turnId, e, updated)
      this.updateIndexReference(this.agentIndex, e.agentId, e, updated)
    }
    if (anyChanged) {
      this.events = [...this.events]
    }
  }

  /**
   * Get all enriched events.
   */
  getEvents(): EnrichedEvent[] {
    return this.events
  }

  /**
   * Create a FrameworkDataApi for render components.
   */
  createDataApi(): FrameworkDataApi {
    return {
      getAgent: (agentId) => this.agentMap.get(agentId),
      getGroupedEvents: (groupId) => this.groupIndex.get(groupId) ?? [],
      getTurnEvents: (turnId) => this.turnIndex.get(turnId) ?? [],
      getAgentEvents: (agentId) => this.agentIndex.get(agentId) ?? [],
    }
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private processOne(raw: RawEvent) {
    const agentClass = this.agentClassMap.get(raw.agentId) ?? 'claude-code'
    const registration = AgentRegistry.get(agentClass)

    const ctx = this.createProcessingContext()
    const result = registration.processEvent(raw, ctx)
    const enriched = result.event

    // Store the event
    this.events.push(enriched)
    this.eventById.set(enriched.id, enriched)

    // Index by group
    if (enriched.groupId) {
      const group = this.groupIndex.get(enriched.groupId)
      if (group) group.push(enriched)
      else this.groupIndex.set(enriched.groupId, [enriched])
    }

    // Index by turn
    if (enriched.turnId) {
      const turn = this.turnIndex.get(enriched.turnId)
      if (turn) turn.push(enriched)
      else this.turnIndex.set(enriched.turnId, [enriched])
    }

    // Index by agent
    const agentEvents = this.agentIndex.get(enriched.agentId)
    if (agentEvents) agentEvents.push(enriched)
    else this.agentIndex.set(enriched.agentId, [enriched])

    // Apply any pending updates from ctx.updateEvent calls
    this.applyPendingUpdates()
  }

  private createProcessingContext(): ProcessingContext {
    return {
      dedupEnabled: this.dedupEnabled,
      compiledFilters: this.compiledFilters,
      getAgent: (agentId) => this.agentMap.get(agentId),
      getGroupedEvents: (groupId) => this.groupIndex.get(groupId) ?? [],
      getAgentEvents: (agentId) => this.agentIndex.get(agentId) ?? [],
      getCurrentTurn: (agentId) => this.currentTurns.get(agentId) ?? null,
      setCurrentTurn: (agentId, turnId) => this.currentTurns.set(agentId, turnId),
      clearCurrentTurn: (agentId) => this.currentTurns.delete(agentId),
      getPendingGroup: (key) => this.pendingGroups.get(key) ?? null,
      setPendingGroup: (key, groupId) => this.pendingGroups.set(key, groupId),
      clearPendingGroup: (key) => this.pendingGroups.delete(key),
      stashPendingAgentMeta: (toolUseId, meta) => this.pendingAgentMeta.set(toolUseId, meta),
      consumePendingAgentMeta: (toolUseId) => {
        const meta = this.pendingAgentMeta.get(toolUseId) ?? null
        if (meta) this.pendingAgentMeta.delete(toolUseId)
        return meta
      },
      updateEvent: (eventId, changes) => {
        this.pendingUpdates.push({ eventId, changes })
      },
    }
  }

  private applyPendingUpdates() {
    for (const { eventId, changes } of this.pendingUpdates) {
      const existing = this.eventById.get(eventId)
      if (!existing) continue

      // Find the event in the array and replace with a new object
      // (new reference triggers React re-render for that row)
      const idx = this.events.indexOf(existing)
      if (idx >= 0) {
        const updated = { ...existing, ...changes } as EnrichedEvent
        this.events[idx] = updated
        this.eventById.set(eventId, updated)

        // Update index references
        this.updateIndexReference(this.groupIndex, existing.groupId, existing, updated)
        this.updateIndexReference(this.turnIndex, existing.turnId, existing, updated)
        this.updateIndexReference(this.agentIndex, existing.agentId, existing, updated)
      }
    }
    this.pendingUpdates = []
  }

  private updateIndexReference(
    index: Map<string, EnrichedEvent[]>,
    key: string | null,
    old: EnrichedEvent,
    updated: EnrichedEvent,
  ) {
    if (!key) return
    const arr = index.get(key)
    if (!arr) return
    const i = arr.indexOf(old)
    if (i >= 0) arr[i] = updated
  }

  private clear() {
    this.events = []
    this.eventById.clear()
    this.groupIndex.clear()
    this.turnIndex.clear()
    this.agentIndex.clear()
    this.currentTurns.clear()
    this.pendingGroups.clear()
    this.pendingAgentMeta.clear()
    this.pendingUpdates = []
    this.lastProcessedCount = 0
  }
}

function sameNames(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
