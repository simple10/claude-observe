import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import { config } from '../config'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const LOG_LEVEL = config.logLevel

const router = new Hono<Env>()

// POST /callbacks/session-slug/:sessionId
// Called by the hook script after reading the slug from the transcript file.
router.post('/callbacks/session-slug/:sessionId', async (c) => {
  const store = c.get('store')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const sessionId = decodeURIComponent(c.req.param('sessionId'))
    const data = (await c.req.json()) as Record<string, unknown>

    if (!data.slug || typeof data.slug !== 'string') {
      return c.json({ error: 'Missing slug' }, 400)
    }

    await store.updateSessionSlug(sessionId, data.slug)

    if (LOG_LEVEL === 'debug') {
      console.log(`[CALLBACK] Session ${sessionId.slice(0, 8)} slug: ${data.slug}`)
    }

    broadcastToAll({ type: 'session_update', data: { id: sessionId, slug: data.slug } as any })

    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Invalid request' }, 400)
  }
})

export default router
