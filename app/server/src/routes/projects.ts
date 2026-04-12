import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { Project } from '../types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const router = new Hono<Env>()

router.get('/projects', async (c) => {
  const store = c.get('store')
  const rows = await store.getProjects()
  const projects: Project[] = rows.map((r: any) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    createdAt: r.created_at,
    sessionCount: r.session_count,
  }))
  return c.json(projects)
})

router.get('/projects/:id/sessions', async (c) => {
  const store = c.get('store')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return c.json({ error: 'Invalid project ID' }, 400)

  const rows = await store.getSessionsForProject(projectId)
  const sessions = rows.map((r: any) => ({
    id: r.id,
    projectId: r.project_id,
    slug: r.slug,
    status: r.status,
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    transcriptPath: r.transcript_path || null,
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    agentCount: r.agent_count,
    eventCount: r.event_count,
    lastActivity: r.last_activity,
  }))
  return c.json(sessions)
})

// PATCH /projects/:id — update project fields (name)
router.patch('/projects/:id', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return c.json({ error: 'Invalid project ID' }, 400)

  try {
    const data = (await c.req.json()) as Record<string, unknown>

    if (data.name && typeof data.name === 'string') {
      const trimmed = data.name.trim()
      if (!trimmed) return c.json({ error: 'name must not be empty' }, 400)
      await store.updateProjectName(projectId, trimmed)
      broadcastToAll({ type: 'project_update', data: { id: projectId, name: trimmed } })
    }

    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Invalid request' }, 400)
  }
})

export default router
