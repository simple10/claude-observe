import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToAll: (msg: object) => void
  }
}

describe('filter routes', () => {
  let app: Hono<Env>
  const broadcasts: object[] = []
  const mockStore = {
    listFilters: vi.fn(),
    getFilterById: vi.fn(),
    createFilter: vi.fn(),
    updateFilter: vi.fn(),
    deleteFilter: vi.fn(),
    duplicateFilter: vi.fn(),
    resetDefaultFilters: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    broadcasts.length = 0
    Object.values(mockStore).forEach((fn) => fn.mockReset())

    vi.doMock('../config', () => ({ config: { logLevel: 'error' } }))
    const { default: filtersRouter } = await import('./filters')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToAll', (msg) => broadcasts.push(msg))
      await next()
    })
    app.route('/api', filtersRouter)
  })

  test('GET /api/filters returns the list', async () => {
    mockStore.listFilters.mockResolvedValue([])
    const res = await app.request('/api/filters')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test('POST /api/filters with valid body creates a user filter', async () => {
    mockStore.createFilter.mockResolvedValue({ id: 'f1', kind: 'user' })
    const res = await app.request('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x',
        pillName: 'x',
        display: 'primary',
        combinator: 'and',
        patterns: [{ target: 'hook', regex: '.' }],
      }),
    })
    expect(res.status).toBe(201)
    expect(mockStore.createFilter).toHaveBeenCalled()
    expect(broadcasts).toContainEqual({
      type: 'filter:created',
      filter: { id: 'f1', kind: 'user' },
    })
  })

  test('POST /api/filters rejects empty name', async () => {
    const res = await app.request('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '',
        pillName: 'x',
        display: 'primary',
        combinator: 'and',
        patterns: [{ target: 'hook', regex: '.' }],
      }),
    })
    expect(res.status).toBe(400)
  })

  test('POST /api/filters rejects invalid regex', async () => {
    const res = await app.request('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x',
        pillName: 'x',
        display: 'primary',
        combinator: 'and',
        patterns: [{ target: 'hook', regex: '(' }],
      }),
    })
    expect(res.status).toBe(400)
  })

  test('PATCH /api/filters/:id on default rejects non-enabled fields', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'd1', kind: 'default', enabled: true })
    const res = await app.request('/api/filters/d1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'changed' }),
    })
    expect(res.status).toBe(403)
  })

  test('PATCH /api/filters/:id on default accepts enabled toggle', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'd1', kind: 'default', enabled: true })
    mockStore.updateFilter.mockResolvedValue({ id: 'd1', enabled: false, kind: 'default' })
    const res = await app.request('/api/filters/d1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
  })

  test('DELETE /api/filters/:id on default returns 403', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'd1', kind: 'default' })
    const res = await app.request('/api/filters/d1', { method: 'DELETE' })
    expect(res.status).toBe(403)
  })

  test('DELETE /api/filters/:id on user returns 204', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'u1', kind: 'user' })
    mockStore.deleteFilter.mockResolvedValue(undefined)
    const res = await app.request('/api/filters/u1', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(broadcasts).toContainEqual({ type: 'filter:deleted', id: 'u1' })
  })

  test('POST /api/filters/:id/duplicate creates user copy', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'd1', kind: 'default' })
    mockStore.duplicateFilter.mockResolvedValue({ id: 'u2', kind: 'user' })
    const res = await app.request('/api/filters/d1/duplicate', { method: 'POST' })
    expect(res.status).toBe(201)
    expect(broadcasts).toContainEqual({
      type: 'filter:created',
      filter: { id: 'u2', kind: 'user' },
    })
  })

  test('POST /api/filters/defaults/reset broadcasts bulk change', async () => {
    mockStore.resetDefaultFilters.mockResolvedValue([])
    const res = await app.request('/api/filters/defaults/reset', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(broadcasts).toContainEqual({ type: 'filter:bulk-changed' })
  })
})
