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
    patchAgent: vi.fn(),
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

  describe('GET /api/agents/:id', () => {
    test('returns agentClass in response', async () => {
      mockStore.getAgentById.mockResolvedValue({
        id: 'agent-1',
        name: 'Main',
        description: null,
        agent_type: 'general-purpose',
        agent_class: 'claude-code',
      })

      const res = await app.request('/api/agents/agent-1', { method: 'GET' })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.agentClass).toBe('claude-code')
      expect(body.agentType).toBe('general-purpose')
    })

    test('returns null agentClass when not set', async () => {
      mockStore.getAgentById.mockResolvedValue({
        id: 'agent-1',
        name: null,
        description: null,
        agent_type: null,
        agent_class: null,
      })

      const res = await app.request('/api/agents/agent-1', { method: 'GET' })
      const body = await res.json()
      expect(body.agentClass).toBeNull()
    })

    test('returns 404 when agent does not exist', async () => {
      mockStore.getAgentById.mockResolvedValue(null)
      const res = await app.request('/api/agents/missing', { method: 'GET' })
      expect(res.status).toBe(404)
    })
  })

  describe('PATCH /api/agents/:id', () => {
    function patchedRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'agent-1',
        name: null,
        description: null,
        agent_type: null,
        agent_class: 'claude-code',
        ...overrides,
      }
    }

    test('patches name only', async () => {
      mockStore.patchAgent.mockResolvedValue(patchedRow({ name: 'Refactor Bot' }))
      const res = await app.request('/api/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Refactor Bot' }),
      })
      expect(res.status).toBe(200)
      expect(mockStore.patchAgent).toHaveBeenCalledWith('agent-1', { name: 'Refactor Bot' })
      const body = await res.json()
      expect(body.name).toBe('Refactor Bot')
    })

    test('patches multiple fields atomically', async () => {
      mockStore.patchAgent.mockResolvedValue(
        patchedRow({ name: 'X', description: 'desc', agent_type: 'general' }),
      )
      await app.request('/api/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X', description: 'desc', agent_type: 'general' }),
      })
      expect(mockStore.patchAgent).toHaveBeenCalledWith('agent-1', {
        name: 'X',
        description: 'desc',
        agent_type: 'general',
      })
    })

    test('silently ignores id and agent_class in body', async () => {
      mockStore.patchAgent.mockResolvedValue(patchedRow({ name: 'Z' }))
      await app.request('/api/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: 'attempted-rebrand',
          agent_class: 'codex',
          name: 'Z',
        }),
      })
      expect(mockStore.patchAgent).toHaveBeenCalledWith('agent-1', { name: 'Z' })
    })

    test('silently ignores unrecognized fields', async () => {
      mockStore.patchAgent.mockResolvedValue(patchedRow())
      await app.request('/api/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ randomKey: 'whatever', another: 42 }),
      })
      expect(mockStore.patchAgent).toHaveBeenCalledWith('agent-1', {})
    })

    test('coerces null values to null (clearing a field)', async () => {
      mockStore.patchAgent.mockResolvedValue(patchedRow())
      await app.request('/api/agents/agent-1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: null, description: null }),
      })
      expect(mockStore.patchAgent).toHaveBeenCalledWith('agent-1', {
        name: null,
        description: null,
      })
    })

    test('returns 404 when agent does not exist', async () => {
      mockStore.patchAgent.mockResolvedValue(null)
      const res = await app.request('/api/agents/missing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      })
      expect(res.status).toBe(404)
    })
  })
})
