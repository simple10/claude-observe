// app/server/src/routes/admin.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { removeSessionRootAgent, clearSessionRootAgents } from './events'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

// DELETE /sessions/:id — delete session and all its data
router.delete('/sessions/:id', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  const deleted = await store.deleteSession(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true, deleted })
})

// DELETE /sessions/:id/events — clear events and agents for a specific session
router.delete('/sessions/:id/events', async (c) => {
  const store = c.get('store')
  const sessionId = c.req.param('id')
  const deleted = await store.clearSessionEvents(sessionId)
  removeSessionRootAgent(sessionId)
  return c.json({ ok: true, deleted })
})

// DELETE /projects/:id — delete a project and all its sessions, agents, events
router.delete('/projects/:id', async (c) => {
  const store = c.get('store')
  const projectId = Number(c.req.param('id'))
  if (isNaN(projectId)) return c.json({ error: 'Invalid project ID' }, 400)
  const { sessionIds, ...deleted } = await store.deleteProject(projectId)
  for (const sessionId of sessionIds) {
    removeSessionRootAgent(sessionId)
  }
  return c.json({ ok: true, deleted })
})

// DELETE /data — delete all data (projects, sessions, agents, events)
router.delete('/data', async (c) => {
  const store = c.get('store')
  const deleted = await store.clearAllData()
  clearSessionRootAgents()
  return c.json({ ok: true, deleted })
})

export default router
