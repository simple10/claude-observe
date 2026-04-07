import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { Agent, ServerAgent, ParsedEvent } from '@/types'

// Module-level dedup — shared across all useAgents instances so multiple
// components (event-stream, combobox, timeline) don't each fire a fetch
// for the same unknown agent.
const pendingFetches = new Set<string>()

/**
 * Derives full Agent objects from server metadata + events.
 * Status, eventCount, and timing are computed from events.
 * Detects unknown agents and fetches their metadata on demand.
 */
export function useAgents(sessionId: string | null, events: ParsedEvent[] | undefined): Agent[] {
  const queryClient = useQueryClient()

  const { data: serverAgents } = useQuery({
    queryKey: ['agents', sessionId],
    queryFn: () => api.getAgents(sessionId!),
    enabled: !!sessionId,
  })

  return useMemo(() => {
    if (!events) return []

    // Build per-agent stats from events
    const agentStats = new Map<string, {
      eventCount: number
      firstEventAt: number
      lastEventAt: number
      lastStoppedAt: number // timestamp of last stop signal, 0 if never
      cwd: string | null
    }>()

    const stopSubtypes = new Set(['Stop', 'SessionEnd', 'stop_hook_summary'])

    for (const e of events) {
      let stats = agentStats.get(e.agentId)
      if (!stats) {
        stats = { eventCount: 0, firstEventAt: e.timestamp, lastEventAt: e.timestamp, lastStoppedAt: 0, cwd: null }
        agentStats.set(e.agentId, stats)
      }
      if (!stats.cwd && typeof (e.payload as any)?.cwd === 'string') {
        stats.cwd = (e.payload as any).cwd
      }
      stats.eventCount++
      if (e.timestamp < stats.firstEventAt) stats.firstEventAt = e.timestamp
      if (e.timestamp > stats.lastEventAt) stats.lastEventAt = e.timestamp

      // Stop signals for this agent's own events
      if (stopSubtypes.has(e.subtype ?? '')) {
        stats.lastStoppedAt = Math.max(stats.lastStoppedAt, e.timestamp)
      }

      // SubagentStop targets the agent ID in the payload, not the event's agentId
      if (e.subtype === 'SubagentStop') {
        const targetId = (e.payload as any)?.agent_id
        if (targetId) {
          const targetStats = agentStats.get(targetId)
          if (targetStats) {
            targetStats.lastStoppedAt = Math.max(targetStats.lastStoppedAt, e.timestamp)
          }
        }
      }
    }

    // Server metadata lookup
    const serverMap = new Map<string, ServerAgent>()
    serverAgents?.forEach((a) => serverMap.set(a.id, a))

    // Merge: for every agent seen in events, create a full Agent
    const result: Agent[] = []
    for (const [agentId, stats] of agentStats) {
      const server = serverMap.get(agentId)

      // Fetch metadata for agents we haven't seen from the server yet
      if (!server && !pendingFetches.has(agentId)) {
        pendingFetches.add(agentId)
        api.getAgent(agentId).then((agent) => {
          queryClient.setQueryData<ServerAgent[]>(
            ['agents', sessionId],
            (old) => {
              if (!old) return [agent]
              if (old.some((a) => a.id === agent.id)) {
                return old.map((a) => a.id === agent.id ? agent : a)
              }
              return [...old, agent]
            },
          )
        }).catch(() => {})
      }

      result.push({
        id: agentId,
        sessionId: sessionId || '',
        parentAgentId: server?.parentAgentId ?? null,
        description: server?.description ?? null,
        name: server?.name ?? null,
        agentType: server?.agentType ?? null,
        // Agent is stopped if the last stop signal came after or at the last activity
        status: stats.lastStoppedAt >= stats.lastEventAt ? 'stopped' : 'active',
        eventCount: stats.eventCount,
        firstEventAt: stats.firstEventAt,
        lastEventAt: stats.lastEventAt,
        cwd: stats.cwd,
      })
    }

    return result
  }, [events, serverAgents, sessionId, queryClient])
}
