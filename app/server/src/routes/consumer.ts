// app/server/src/routes/consumer.ts

import { Hono } from 'hono'
import { heartbeat, deregister } from '../consumer-tracker'

const router = new Hono()

/** Register or refresh a consumer. Body: { id: string } */
router.post('/consumer/heartbeat', async (c) => {
  const body = await c.req.json<{ id?: string }>()
  if (!body.id) {
    return c.json({ error: 'id is required' }, 400)
  }
  const activeConsumers = heartbeat(body.id)
  return c.json({ ok: true, activeConsumers })
})

/** Deregister a consumer. Body: { id: string } */
router.post('/consumer/deregister', async (c) => {
  const body = await c.req.json<{ id?: string }>()
  if (!body.id) {
    return c.json({ error: 'id is required' }, 400)
  }
  const counts = deregister(body.id)
  return c.json({ ok: true, ...counts })
})

export default router
