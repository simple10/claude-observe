import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { Filter } from '../types'
import { apiError } from '../errors'

type Env = {
  Variables: {
    store: EventStore
    broadcastToAll: (msg: object) => void
  }
}

const router = new Hono<Env>()

const MAX_NAME = 100
const ALLOWED_TARGETS = new Set(['hook', 'tool', 'payload'])
const ALLOWED_DISPLAY = new Set(['primary', 'secondary'])
const ALLOWED_COMBINATOR = new Set(['and', 'or'])

interface ValidatedInput {
  name: string
  pillName: string
  display: 'primary' | 'secondary'
  combinator: 'and' | 'or'
  patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
}

function validateInput(
  body: any,
): { ok: true; value: ValidatedInput } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'Invalid body' }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return { ok: false, reason: 'name must not be empty' }
  if (name.length > MAX_NAME)
    return { ok: false, reason: `name must be ${MAX_NAME} chars or fewer` }
  const pillName = typeof body.pillName === 'string' ? body.pillName.trim() : ''
  if (!pillName) return { ok: false, reason: 'pillName must not be empty' }
  if (pillName.length > MAX_NAME)
    return { ok: false, reason: `pillName must be ${MAX_NAME} chars or fewer` }
  if (!ALLOWED_DISPLAY.has(body.display))
    return { ok: false, reason: 'display must be primary or secondary' }
  if (!ALLOWED_COMBINATOR.has(body.combinator))
    return { ok: false, reason: 'combinator must be and or or' }
  if (!Array.isArray(body.patterns) || body.patterns.length === 0)
    return { ok: false, reason: 'patterns must be a non-empty array' }
  for (const p of body.patterns) {
    if (!p || !ALLOWED_TARGETS.has(p.target))
      return { ok: false, reason: 'each pattern target must be hook, tool, or payload' }
    if (typeof p.regex !== 'string' || p.regex === '')
      return { ok: false, reason: 'each pattern regex must be a non-empty string' }
    try {
      new RegExp(p.regex)
    } catch (e) {
      return { ok: false, reason: `invalid regex: ${(e as Error).message}` }
    }
  }
  return {
    ok: true,
    value: {
      name,
      pillName,
      display: body.display,
      combinator: body.combinator,
      patterns: body.patterns,
    },
  }
}

router.get('/filters', async (c) => {
  const store = c.get('store')
  return c.json(await store.listFilters())
})

router.post('/filters', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return apiError(c, 400, 'Invalid JSON body')
  }
  const v = validateInput(body)
  if (!v.ok) return apiError(c, 400, v.reason)
  const filter = await store.createFilter(v.value)
  broadcast({ type: 'filter:created', filter })
  return c.json(filter, 201)
})

router.patch('/filters/:id', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  const id = c.req.param('id')
  const existing = await store.getFilterById(id)
  if (!existing) return apiError(c, 404, 'filter not found')

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return apiError(c, 400, 'Invalid JSON body')
  }
  if (!body || typeof body !== 'object') return apiError(c, 400, 'Invalid body')

  const patch: Record<string, unknown> = {}
  if (existing.kind === 'default') {
    // Default filters only allow toggling enabled.
    const otherKeys = Object.keys(body).filter((k) => k !== 'enabled')
    if (otherKeys.length > 0) {
      return apiError(c, 403, `default filters allow only 'enabled' to be patched`)
    }
    if (typeof body.enabled !== 'boolean') return apiError(c, 400, 'enabled must be boolean')
    patch.enabled = body.enabled
  } else {
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '')
        return apiError(c, 400, 'name must not be empty')
      patch.name = body.name.trim()
    }
    if (body.pillName !== undefined) {
      if (typeof body.pillName !== 'string' || body.pillName.trim() === '')
        return apiError(c, 400, 'pillName must not be empty')
      patch.pillName = body.pillName.trim()
    }
    if (body.display !== undefined) {
      if (!ALLOWED_DISPLAY.has(body.display)) return apiError(c, 400, 'invalid display')
      patch.display = body.display
    }
    if (body.combinator !== undefined) {
      if (!ALLOWED_COMBINATOR.has(body.combinator)) return apiError(c, 400, 'invalid combinator')
      patch.combinator = body.combinator
    }
    if (body.patterns !== undefined) {
      const stub = { ...existing, ...body }
      const v = validateInput(stub)
      if (!v.ok) return apiError(c, 400, v.reason)
      patch.patterns = v.value.patterns
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return apiError(c, 400, 'enabled must be boolean')
      patch.enabled = body.enabled
    }
    if (body.kind !== undefined) return apiError(c, 400, 'kind is immutable')
  }

  const filter = await store.updateFilter(id, patch as any)
  broadcast({ type: 'filter:updated', filter })
  return c.json(filter)
})

router.delete('/filters/:id', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  const id = c.req.param('id')
  const existing = await store.getFilterById(id)
  if (!existing) return apiError(c, 404, 'filter not found')
  if (existing.kind === 'default') return apiError(c, 403, 'default filters cannot be deleted')
  await store.deleteFilter(id)
  broadcast({ type: 'filter:deleted', id })
  return c.body(null, 204)
})

router.post('/filters/:id/duplicate', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  const id = c.req.param('id')
  const existing = await store.getFilterById(id)
  if (!existing) return apiError(c, 404, 'filter not found')
  const filter = await store.duplicateFilter(id)
  broadcast({ type: 'filter:created', filter })
  return c.json(filter, 201)
})

router.post('/filters/defaults/reset', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  const filters = await store.resetDefaultFilters()
  broadcast({ type: 'filter:bulk-changed' })
  return c.json(filters)
})

export default router
