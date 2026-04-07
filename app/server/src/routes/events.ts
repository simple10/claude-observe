// app/server/src/routes/events.ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { ParsedEvent } from '../types'
import { parseRawEvent } from '../parser'
import { resolveProject } from '../services/project-resolver'
import { config } from '../config'

type Env = {
  Variables: {
    store: EventStore
    broadcastToSession: (sessionId: string, msg: object) => void
    broadcastToAll: (msg: object) => void
  }
}

const router = new Hono<Env>()

const LOG_LEVEL = config.logLevel

// Track root agent IDs per session (sessionId -> agentId)
const sessionRootAgents = new Map<string, string>()

// Track pending Agent tool metadata so we can name subagents early.
// When PreToolUse:Agent fires, we store name+description keyed by tool_use_id
// and also push onto a per-session FIFO queue. The queue is necessary because
// subagent events carry only agent_id (not the parent tool_use_id), so we can't
// directly look up by tool_use_id when a new subagent first appears.
//
// When multiple Agent tools are invoked concurrently (e.g. two subagents spawned
// in the same turn), each gets its own queue entry so names are assigned 1:1.
interface PendingAgentMeta { name: string | null; description: string | null }
const pendingAgentMeta = new Map<string, PendingAgentMeta>() // toolUseId -> { name, description }
const pendingAgentTypes = new Map<string, string>() // toolUseId -> subagent_type
const pendingAgentMetaQueue = new Map<string, PendingAgentMeta[]>() // sessionId -> FIFO queue
const namedAgents = new Map<string, Set<string>>() // sessionId -> set of agent IDs already named via queue

async function ensureRootAgent(
  store: EventStore,
  sessionId: string,
): Promise<string> {
  let rootId = sessionRootAgents.get(sessionId)
  if (!rootId) {
    rootId = sessionId
    await store.upsertAgent(rootId, sessionId, null, null, null)
    sessionRootAgents.set(sessionId, rootId)
  }
  return rootId
}

// POST /events
router.post('/events', async (c) => {
  const store = c.get('store')
  const broadcastToSession = c.get('broadcastToSession')
  const broadcastToAll = c.get('broadcastToAll')

  try {
    const body = await c.req.json()

    // Support both envelope format and legacy flat format
    let hookPayload: Record<string, unknown>
    let meta: { env?: Record<string, string> } = {}

    if (body.hook_payload) {
      hookPayload = body.hook_payload as Record<string, unknown>
      meta = (body.meta as typeof meta) || {}
    } else {
      hookPayload = body
    }

    if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
      const logKeys = Object.keys(hookPayload).join(', ')
      const payload = JSON.stringify(hookPayload)
      const logPayload =
        LOG_LEVEL === 'trace'
          ? `Payload: ${payload}`
          : `Keys: ${logKeys} \nPayload: ${payload.slice(0, 500)}`

      if (hookPayload.hook_event_name) {
        const toolInfo = hookPayload.tool_name ? `tool:${hookPayload.tool_name} tool_use_id:${hookPayload.tool_use_id}` : ''
        console.log(`[HOOK:${hookPayload.hook_event_name}] ${toolInfo} \n${logPayload}\n---`)
      } else {
        console.log('[EVENT]', logPayload)
      }
    }

    const parsed = parseRawEvent(hookPayload)

    // Resolve project - only on first event for this session
    const existingSession = await store.getSessionById(parsed.sessionId)
    let effectiveProjectId: number

    if (existingSession) {
      effectiveProjectId = existingSession.project_id
    } else {
      const projectSlugOverride = meta.env?.AGENTS_OBSERVE_PROJECT_SLUG || null
      const resolved = await resolveProject(store, {
        sessionId: parsed.sessionId,
        slug: projectSlugOverride,
        transcriptPath: parsed.transcriptPath,
      })
      effectiveProjectId = resolved.projectId
    }

    await store.upsertSession(
      parsed.sessionId,
      effectiveProjectId,
      parsed.slug,
      Object.keys(parsed.metadata).length > 0 ? parsed.metadata : null,
      parsed.timestamp,
      parsed.transcriptPath,
    )

    const rootAgentId = await ensureRootAgent(store, parsed.sessionId)

    // When PreToolUse:Agent fires, stash name + description for early naming.
    // We store it both by toolUseId (for definitive lookup at PostToolUse) and
    // in a per-session FIFO queue (for early naming when subagent events arrive
    // before PostToolUse, since those events don't carry the parent tool_use_id).
    if (parsed.subtype === 'PreToolUse' && parsed.toolName === 'Agent') {
      const meta: PendingAgentMeta = { name: parsed.subAgentName, description: parsed.subAgentDescription }
      if (meta.name || meta.description) {
        if (parsed.toolUseId) {
          pendingAgentMeta.set(parsed.toolUseId, meta)
        }
        const queue = pendingAgentMetaQueue.get(parsed.sessionId) || []
        queue.push(meta)
        pendingAgentMetaQueue.set(parsed.sessionId, queue)
      }
      // Stash agent type from tool_input.subagent_type
      const agentType = (hookPayload as any)?.tool_input?.subagent_type
      if (agentType && parsed.toolUseId) {
        pendingAgentTypes.set(parsed.toolUseId, agentType)
      }
    }

    // If the event has an ownerAgentId (from payload.agent_id), this event
    // belongs to that agent. Ensure the agent record exists.
    if (parsed.ownerAgentId && parsed.ownerAgentId !== rootAgentId) {
      // Only consume a queue entry for agents we haven't named yet.
      const sessionNamed = namedAgents.get(parsed.sessionId)
      const alreadyNamed = sessionNamed?.has(parsed.ownerAgentId) ?? false
      let pending: PendingAgentMeta | null = null

      if (!alreadyNamed) {
        const queue = pendingAgentMetaQueue.get(parsed.sessionId)
        if (queue && queue.length > 0) {
          pending = queue.shift()!
          if (queue.length === 0) {
            pendingAgentMetaQueue.delete(parsed.sessionId)
          }
        }
        if (pending) {
          if (!sessionNamed) {
            namedAgents.set(parsed.sessionId, new Set([parsed.ownerAgentId]))
          } else {
            sessionNamed.add(parsed.ownerAgentId)
          }
        }
      }

      // Extract agent_type from the hook payload — every subagent event carries it
      const ownerAgentType: string | null = (hookPayload as any)?.agent_type ?? null

      await store.upsertAgent(
        parsed.ownerAgentId,
        parsed.sessionId,
        rootAgentId,
        pending?.name ?? null,
        pending?.description ?? null,
        ownerAgentType,
      )
    }
    let agentId = parsed.ownerAgentId || rootAgentId

    // Create/update subagent records (from Agent tool PostToolUse or SubagentStop)
    if (parsed.subAgentId) {
      let subAgentName = parsed.subAgentName
      let subAgentDescription = parsed.subAgentDescription
      let subAgentType: string | null = (hookPayload as any)?.agent_type ?? null
      if (parsed.subtype === 'PostToolUse' && parsed.toolName === 'Agent' && parsed.toolUseId) {
        const metaFromPre = pendingAgentMeta.get(parsed.toolUseId)
        if (metaFromPre) {
          subAgentName = subAgentName || metaFromPre.name
          subAgentDescription = subAgentDescription || metaFromPre.description
          pendingAgentMeta.delete(parsed.toolUseId)
        }
        // Agent type: prefer stashed value from PreToolUse, then tool_input/tool_response
        const toolResponse = (hookPayload as any)?.tool_response
        subAgentType = pendingAgentTypes.get(parsed.toolUseId)
          ?? (hookPayload as any)?.tool_input?.subagent_type
          ?? toolResponse?.agentType
          ?? toolResponse?.subagent_type
          ?? subAgentType
        pendingAgentTypes.delete(parsed.toolUseId)
      }

      await store.upsertAgent(
        parsed.subAgentId,
        parsed.sessionId,
        rootAgentId,
        subAgentName,
        subAgentDescription,
        subAgentType,
      )

      // agent_progress events belong to the subagent
      if (parsed.subtype === 'agent_progress') {
        agentId = parsed.subAgentId
      }
    }

    // Session lifecycle: SessionEnd stops the session, any other event reactivates a stopped session.
    if (parsed.subtype === 'SessionEnd') {
      await store.updateSessionStatus(parsed.sessionId, 'stopped')
      broadcastToAll({
        type: 'session_update',
        data: { id: parsed.sessionId, status: 'stopped' },
      })
    } else {
      const session = await store.getSessionById(parsed.sessionId)
      if (session && session.status === 'stopped') {
        await store.updateSessionStatus(parsed.sessionId, 'active')
        broadcastToAll({
          type: 'session_update',
          data: { id: parsed.sessionId, status: 'active' },
        })
      }
    }

    // Set status for tool events
    let status = 'pending'
    if (parsed.subtype === 'PreToolUse') status = 'running'
    else if (parsed.subtype === 'PostToolUse') status = 'completed'

    const eventId = await store.insertEvent({
      agentId,
      sessionId: parsed.sessionId,
      type: parsed.type,
      subtype: parsed.subtype,
      toolName: parsed.toolName,
      summary: null, // computed client-side
      timestamp: parsed.timestamp,
      payload: parsed.raw,
      toolUseId: parsed.toolUseId,
      status,
    })

    const event: ParsedEvent = {
      id: eventId,
      agentId,
      sessionId: parsed.sessionId,
      type: parsed.type,
      subtype: parsed.subtype,
      toolName: parsed.toolName,
      toolUseId: parsed.toolUseId,
      status,
      timestamp: parsed.timestamp,
      payload: parsed.raw,
    }

    broadcastToSession(parsed.sessionId, { type: 'event', data: event })

    // Build response -- request local data if the server is missing info
    const requests: Array<{ cmd: string; args: Record<string, unknown>; callback: string }> = []

    // Request session slug if missing
    if (parsed.raw.transcript_path) {
      const session = await store.getSessionById(parsed.sessionId)
      if (session && !session.slug) {
        requests.push({
          cmd: 'getSessionSlug',
          args: { transcript_path: parsed.raw.transcript_path },
          callback: `/api/sessions/${encodeURIComponent(parsed.sessionId)}/metadata`,
        })
      }
    }

    const responseBody: Record<string, unknown> = {
      status: 'OK',
      meta: {
        event_id: eventId,
        session_id: parsed.sessionId,
        project_id: effectiveProjectId,
      },
    }

    if (requests.length > 0) {
      responseBody.requests = requests
    }

    return c.json(responseBody, 201)
  } catch (error) {
    console.error('Error processing event:', error)
    return c.json({ error: 'Invalid request' }, 400)
  }
})

// GET /events/:id/thread
router.get('/events/:id/thread', async (c) => {
  const store = c.get('store')
  const eventId = parseInt(c.req.param('id'))
  const rows = await store.getThreadForEvent(eventId)
  const events: ParsedEvent[] = rows.map((r) => ({
    id: r.id,
    agentId: r.agent_id,
    sessionId: r.session_id,
    type: r.type,
    subtype: r.subtype,
    toolName: r.tool_name,
    toolUseId: r.tool_use_id || null,
    status: r.status || 'pending',
    timestamp: r.timestamp,
    payload: JSON.parse(r.payload),
  }))
  return c.json(events)
})

/** Remove a single session from the in-memory root agent cache */
export function removeSessionRootAgent(sessionId: string): void {
  sessionRootAgents.delete(sessionId)
  pendingAgentMetaQueue.delete(sessionId)
  namedAgents.delete(sessionId)
}

/** Clear all in-memory session state */
export function clearSessionRootAgents(): void {
  sessionRootAgents.clear()
  pendingAgentMeta.clear()
  pendingAgentMetaQueue.clear()
  namedAgents.clear()
}

export default router
