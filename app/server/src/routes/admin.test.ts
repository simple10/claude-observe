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

describe('admin routes — DELETE endpoints return counts', () => {
  let app: Hono<Env>
  const mockStore = {
    deleteSession: vi.fn(),
    clearSessionEvents: vi.fn(),
    deleteProject: vi.fn(),
    clearAllData: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())

    // Mock events module to avoid import issues
    vi.doMock('./events', () => ({
      removeSessionRootAgent: vi.fn(),
      clearSessionRootAgents: vi.fn(),
    }))

    const { default: adminRouter } = await import('./admin')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToAll', vi.fn())
      c.set('broadcastToSession', vi.fn())
      await next()
    })
    app.route('/api', adminRouter)
  })

  test('DELETE /sessions/:id returns deleted counts', async () => {
    mockStore.deleteSession.mockResolvedValue({ events: 42, agents: 3 })

    const res = await app.request('/api/sessions/sess-1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, deleted: { events: 42, agents: 3 } })
  })

  test('DELETE /sessions/:id/events returns deleted counts', async () => {
    mockStore.clearSessionEvents.mockResolvedValue({ events: 100, agents: 5 })

    const res = await app.request('/api/sessions/sess-1/events', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, deleted: { events: 100, agents: 5 } })
  })

  test('DELETE /projects/:id returns deleted counts (without sessionIds)', async () => {
    mockStore.deleteProject.mockResolvedValue({
      sessionIds: ['s1', 's2'],
      sessions: 2,
      agents: 4,
      events: 200,
    })

    const res = await app.request('/api/projects/1', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true, deleted: { sessions: 2, agents: 4, events: 200 } })
    // sessionIds should NOT be in the response (internal detail)
    expect(body.deleted.sessionIds).toBeUndefined()
  })

  test('DELETE /data returns deleted counts', async () => {
    mockStore.clearAllData.mockResolvedValue({
      projects: 3,
      sessions: 10,
      agents: 20,
      events: 500,
    })

    const res = await app.request('/api/data', { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({
      ok: true,
      deleted: { projects: 3, sessions: 10, agents: 20, events: 500 },
    })
  })

  test('DELETE /projects/:id returns 400 for non-numeric ID', async () => {
    const res = await app.request('/api/projects/abc', { method: 'DELETE' })
    expect(res.status).toBe(400)
  })
})
