// app/server/src/routes/agents.ts
import { Hono } from 'hono'
import type { EventStore, AgentPatch } from '../storage/types'
import { apiError } from '../errors'

type Env = { Variables: { store: EventStore } }

const router = new Hono<Env>()

function rowToAgent(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    agentType: row.agent_type ?? null,
    agentClass: row.agent_class ?? null,
  }
}

// GET /agents/:id
router.get('/agents/:id', async (c) => {
  const store = c.get('store')
  const agentId = decodeURIComponent(c.req.param('id'))
  const row = await store.getAgentById(agentId)
  if (!row) return apiError(c, 404, 'Agent not found')
  return c.json(rowToAgent(row))
})

// PATCH /agents/:id — Layer 3 patch path. Accepts a partial body of
// { name?, description?, agent_type? }. Silently ignores `id`,
// `agent_class`, and any unrecognized fields. See spec
// §"REST /api/agents/:id (PATCH)".
router.patch('/agents/:id', async (c) => {
  const store = c.get('store')
  const agentId = decodeURIComponent(c.req.param('id'))

  let body: Record<string, unknown>
  try {
    body = (await c.req.json()) as Record<string, unknown>
  } catch {
    return apiError(c, 400, 'Invalid JSON body')
  }
  if (!body || typeof body !== 'object') {
    return apiError(c, 400, 'Request body must be an object')
  }

  const patch: AgentPatch = {}
  if ('name' in body) patch.name = coerceNullableString(body.name)
  if ('description' in body) patch.description = coerceNullableString(body.description)
  if ('agent_type' in body) patch.agent_type = coerceNullableString(body.agent_type)
  // `id` and `agent_class` and any other keys are silently ignored.

  const updated = await store.patchAgent(agentId, patch)
  if (!updated) return apiError(c, 404, 'Agent not found')
  return c.json(rowToAgent(updated))
})

function coerceNullableString(v: unknown): string | null {
  if (v == null) return null
  return String(v)
}

export default router
