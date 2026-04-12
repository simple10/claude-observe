import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

describe('callback routes', () => {
  let app: Hono<Env>
  const updateSessionSlug = vi.fn()
  const broadcastToAll = vi.fn()

  beforeEach(async () => {
    vi.resetModules()
    updateSessionSlug.mockReset()
    broadcastToAll.mockReset()

    const { default: callbacksRouter } = await import('./callbacks')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', { updateSessionSlug } as unknown as EventStore)
      c.set('broadcastToAll', broadcastToAll)
      c.set('broadcastToSession', () => {})
      await next()
    })
    app.route('/api', callbacksRouter)
  })

  describe('POST /api/callbacks/session-slug/:sessionId', () => {
    test('updates slug and broadcasts', async () => {
      const res = await app.request('/api/callbacks/session-slug/sess-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'my-session' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true })
      expect(updateSessionSlug).toHaveBeenCalledWith('sess-123', 'my-session')
      expect(broadcastToAll).toHaveBeenCalledWith({
        type: 'session_update',
        data: { id: 'sess-123', slug: 'my-session' },
      })
    })

    test('returns 400 when slug is missing', async () => {
      const res = await app.request('/api/callbacks/session-slug/sess-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('Missing slug')
      expect(updateSessionSlug).not.toHaveBeenCalled()
    })

    test('returns 400 when slug is not a string', async () => {
      const res = await app.request('/api/callbacks/session-slug/sess-123', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 42 }),
      })
      expect(res.status).toBe(400)
      expect(updateSessionSlug).not.toHaveBeenCalled()
    })

    test('decodes URL-encoded session IDs', async () => {
      const encoded = encodeURIComponent('sess-with-special/chars')
      const res = await app.request(`/api/callbacks/session-slug/${encoded}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: 'decoded-test' }),
      })
      expect(res.status).toBe(200)
      expect(updateSessionSlug).toHaveBeenCalledWith('sess-with-special/chars', 'decoded-test')
    })
  })
})
