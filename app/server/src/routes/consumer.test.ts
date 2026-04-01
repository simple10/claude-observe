import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'

describe('consumer routes', () => {
  let app: Hono
  let trackerMock: {
    heartbeat: ReturnType<typeof vi.fn>
    deregister: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    trackerMock = {
      heartbeat: vi.fn(() => 1),
      deregister: vi.fn(() => ({ activeConsumers: 0, activeClients: 0 })),
    }
    vi.doMock('../consumer-tracker', () => trackerMock)

    const { default: consumerRouter } = await import('./consumer')
    app = new Hono()
    app.route('/api', consumerRouter)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST /api/consumer/heartbeat', () => {
    test('registers a consumer and returns count', async () => {
      const res = await app.request('/api/consumer/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'mcp-123' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true, activeConsumers: 1 })
      expect(trackerMock.heartbeat).toHaveBeenCalledWith('mcp-123')
    })

    test('returns 400 when id is missing', async () => {
      const res = await app.request('/api/consumer/heartbeat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toBe('id is required')
    })
  })

  describe('POST /api/consumer/deregister', () => {
    test('deregisters a consumer and returns counts', async () => {
      trackerMock.deregister.mockReturnValue({ activeConsumers: 2, activeClients: 1 })

      const res = await app.request('/api/consumer/deregister', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: 'mcp-123' }),
      })
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toEqual({ ok: true, activeConsumers: 2, activeClients: 1 })
      expect(trackerMock.deregister).toHaveBeenCalledWith('mcp-123')
    })

    test('returns 400 when id is missing', async () => {
      const res = await app.request('/api/consumer/deregister', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      expect(res.status).toBe(400)
    })
  })
})
