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
    metadata: r.metadata ? JSON.parse(r.metadata) : null,
    agentCount: r.agent_count,
    activeAgentCount: r.active_agent_count,
    eventCount: r.event_count,
  }))
  return c.json(sessions)
})

router.post('/projects/:id/rename', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return c.json({ error: 'Invalid project ID' }, 400)

  try {
    const { name } = (await c.req.json()) as { name: string }
    if (!name || typeof name !== 'string') {
      return c.json({ error: 'name is required' }, 400)
    }
    await store.updateProjectName(projectId, name.trim())
    broadcastToAll({ type: 'project_update', data: { id: projectId, name: name.trim() } })
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Invalid request' }, 400)
  }
})

export default router
