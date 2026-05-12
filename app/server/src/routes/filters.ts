import { Hono } from 'hono'
import { RE2JS } from 're2js'
import type { EventStore } from '../storage/types'
import type { Filter } from '../types'
import { apiError } from '../errors'

// Mirror of the client-side helper. Kept inline rather than imported
// because client/server don't share a module tree. The accepted letter
// set is constrained upstream (see flags regex below) so we only need
// to handle i/m/s.
function flagsStringToRE2(flags: string | undefined): number {
  if (!flags) return 0
  let f = 0
  if (flags.includes('i')) f |= RE2JS.CASE_INSENSITIVE
  if (flags.includes('m')) f |= RE2JS.MULTILINE
  if (flags.includes('s')) f |= RE2JS.DOTALL
  return f
}

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
  patterns: {
    target: 'hook' | 'tool' | 'payload'
    regex: string
    negate?: boolean
    flags?: string
  }[]
  config: Record<string, unknown>
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
    if (p.negate !== undefined && typeof p.negate !== 'boolean')
      return { ok: false, reason: 'pattern negate must be a boolean when present' }
    if (p.flags !== undefined) {
      if (typeof p.flags !== 'string')
        return { ok: false, reason: 'pattern flags must be a string when present' }
      // Restrict to the RE2-portable subset so we don't end up with a
      // filter that compiles today but breaks on the planned backend.
      if (!/^[ims]*$/.test(p.flags))
        return { ok: false, reason: 'pattern flags must contain only i, m, or s' }
    }
    try {
      // Validate against the same engine that runs in the client. Stops
      // a user from authoring a pattern that the JS RegExp parser accepts
      // (e.g. with a lookahead) but RE2 rejects at runtime.
      RE2JS.compile(p.regex, flagsStringToRE2(p.flags))
    } catch (e) {
      return { ok: false, reason: `invalid regex: ${(e as Error).message}` }
    }
  }
  // Normalize each pattern so storage receives only known fields. Also
  // strips `negate: false` / empty `flags` so existing rows without the
  // fields stay identical to new defaults.
  const normalizedPatterns = body.patterns.map((p: any) => {
    const out: { target: string; regex: string; negate?: boolean; flags?: string } = {
      target: p.target,
      regex: p.regex,
    }
    if (p.negate === true) out.negate = true
    if (typeof p.flags === 'string' && p.flags !== '') out.flags = p.flags
    return out
  })
  // config is a free-form JSON object. Only the shape (object, not
  // array, not null) is validated here — the contents are passed
  // through verbatim. Known keys today: `color` (any CSS color string).
  let config: Record<string, unknown> = {}
  if (body.config !== undefined) {
    if (body.config === null || typeof body.config !== 'object' || Array.isArray(body.config)) {
      return { ok: false, reason: 'config must be a JSON object when present' }
    }
    config = body.config
  }
  return {
    ok: true,
    value: {
      name,
      pillName,
      display: body.display,
      combinator: body.combinator,
      patterns: normalizedPatterns,
      config,
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
    if (body.config !== undefined) {
      if (body.config === null || typeof body.config !== 'object' || Array.isArray(body.config)) {
        return apiError(c, 400, 'config must be a JSON object')
      }
      patch.config = body.config
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
