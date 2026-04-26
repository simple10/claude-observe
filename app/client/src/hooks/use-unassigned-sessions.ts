import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { Session, RecentSession } from '@/types'

/** Coerce a `RecentSession` (the wire shape from `/sessions/unassigned`)
 *  into a `Session` (the shape the sidebar renderer expects). The two
 *  are nearly identical post-refactor; this helper just reshapes the
 *  nullable project fields. */
function toSession(r: RecentSession): Session {
  return {
    id: r.id,
    projectId: r.projectId,
    projectSlug: r.projectSlug ?? undefined,
    projectName: r.projectName ?? undefined,
    transcriptPath: r.transcriptPath ?? null,
    slug: r.slug,
    status: r.status,
    startedAt: r.startedAt,
    stoppedAt: r.stoppedAt,
    metadata: r.metadata,
    lastActivity: r.lastActivity,
    agentClasses: r.agentClasses,
  }
}

/**
 * Returns sessions whose `project_id` is still NULL on the server —
 * these render in the sidebar's "Unassigned" bucket. The server now
 * permits sessions without a project (auto-resolution happens only
 * when `flags.resolveProject` is set or `_meta.project.slug` is
 * supplied — see the three-layer contract spec). Until a user moves
 * one of these sessions into a project (via SessionEditModal), it
 * surfaces here.
 *
 * Backed by a dedicated `/api/sessions/unassigned` endpoint so the
 * sidebar doesn't need to pull `/sessions/recent` (with all its
 * already-assigned rows) just to filter client-side. Stays fresh via
 * WS-driven invalidation in `use-websocket.ts` on session_update.
 */
export function useUnassignedSessions(limit = 100): Session[] {
  const { data } = useQuery({
    queryKey: ['unassigned-sessions', limit],
    queryFn: () => api.getUnassignedSessions(limit),
  })
  return useMemo(() => {
    if (!data) return []
    return data.map(toSession)
  }, [data])
}
