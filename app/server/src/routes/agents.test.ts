import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
  }
}

describe('agent routes', () => {
  let app: Hono<Env>
  const mockStore = {
    getAgentById: vi.fn(),
    updateAgentName: vi.fn(),
    updateAgentType: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    Object.values(mockStore).forEach((fn) => fn.mockReset())

    vi.doMock('../config', () => ({
      config: { logLevel: 'error' },
    }))

    const { default: agentsRouter } = await import('./agents')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      await next()
    })
    app.route('/api', agentsRouter)
  })

  describe('PATCH /api/agents/:id', () => {
    test('updates agent name', async () => {
      mockStore.getAgentById.mockResolvedValue({ id: 'agent-1', name: 'old' })
      mockStore.updateAgentName.mockResolvedValue(undefined)

      const res = await app.request('/api/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'new-name' }),
      })
      expect(res.status).toBe(200)
      expect(mockStore.updateAgentName).toHaveBeenCalledWith('agent-1', 'new-name')
    })

    test('updates agent type', async () => {
      mockStore.getAgentById.mockResolvedValue({ id: 'agent-1' })
      mockStore.updateAgentType.mockResolvedValue(undefined)

      const res = await app.request('/api/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentType: 'researcher' }),
      })
      expect(res.status).toBe(200)
      expect(mockStore.updateAgentType).toHaveBeenCalledWith('agent-1', 'researcher')
    })

    test('returns 404 for unknown agent', async () => {
      mockStore.getAgentById.mockResolvedValue(null)

      const res = await app.request('/api/agents/unknown', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'test' }),
      })
      expect(res.status).toBe(404)
      expect(mockStore.updateAgentName).not.toHaveBeenCalled()
    })
  })
})
