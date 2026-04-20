// app/server/src/parser.ts
// Extracts structural fields from raw JSONL events.
//
// For hook-format events, descriptor fields (hookName / type / subtype /
// toolName / sessionId / agentId) are stamped by the CLI on `meta` —
// this parser reads them meta-first and falls back to raw payload keys
// that aren't agent-class-specific. Subagent-pairing extraction
// (subAgentId / Name / Description) stays server-side because the route
// layer uses it for Claude-Code-specific subagent record creation.
//
// NO formatting, NO truncation, NO summary generation — that's the client's job.

import type { EventEnvelopeMeta } from './types'

export interface ParsedRawEvent {
  projectName: string | null
  sessionId: string
  slug: string | null
  transcriptPath: string | null
  /** Raw hook event name (`hook_event_name` from payload). Null for non-hook-format events. */
  hookName: string | null
  type: string
  subtype: string | null
  toolName: string | null
  timestamp: number
  // The agent this event belongs to (from payload.agent_id — present on subagent hook events)
  ownerAgentId: string | null
  // The subagent being spawned/stopped (from Agent tool response or SubagentStop)
  subAgentId: string | null
  subAgentName: string | null
  subAgentDescription: string | null
  metadata: Record<string, unknown>
  raw: Record<string, unknown>
}

export function parseRawEvent(
  raw: Record<string, unknown>,
  envelopeMeta?: EventEnvelopeMeta,
): ParsedRawEvent {
  const projectName = (raw.project_name as string) || null
  // Prefer CLI-stamped sessionId; fall back to payload's standard key.
  const sessionId = envelopeMeta?.sessionId || (raw.session_id as string) || 'unknown'
  const slug = (raw.slug as string) || null
  const transcriptPath = (raw.transcript_path as string) || null
  // Legacy meta-timestamp support: some older transcript-format events
  // put the timestamp under a meta.timestamp key on the raw payload.
  const legacyRawMeta = raw.meta as Record<string, unknown> | undefined
  const timestamp = parseTimestamp(legacyRawMeta?.timestamp ?? raw.timestamp)
  // agent_id is present on hook events fired from subagents; CLI may stamp
  // it on envelope meta too.
  const ownerAgentId = envelopeMeta?.agentId ?? ((raw.agent_id as string) || null)

  let type: string
  let subtype: string | null = null
  let toolName: string | null = null
  let subAgentId: string | null = null
  let subAgentName: string | null = null
  let subAgentDescription: string | null = null

  const hookEventName = raw.hook_event_name as string | undefined
  // Prefer CLI-stamped hookName; fall back to raw payload key.
  const hookName = envelopeMeta?.hookName ?? hookEventName ?? null

  if (hookEventName) {
    // === HOOK FORMAT ===
    // Descriptor fields come from envelope meta; payload fallback for
    // compatibility with CLIs that haven't been updated yet.
    type = envelopeMeta?.type ?? 'system'
    subtype = envelopeMeta?.subtype ?? hookEventName ?? null
    toolName = envelopeMeta?.toolName ?? ((raw.tool_name as string | undefined) || null)

    // Subagent extraction stays server-side — used by the route layer's
    // Claude-Code-specific subagent-pairing map in events.ts. This is
    // the only remaining Claude-Code assumption in the parser and it's
    // intentionally out-of-scope for this refactor.
    const toolInput = raw.tool_input as Record<string, unknown> | undefined
    if (hookEventName === 'PreToolUse' && toolName === 'Agent') {
      subAgentName = (toolInput?.name as string) || null
      subAgentDescription = (toolInput?.description as string) || null
    } else if (hookEventName === 'PostToolUse' && toolName === 'Agent') {
      const toolResponse = raw.tool_response as Record<string, unknown> | undefined
      if (toolResponse) {
        subAgentId = (toolResponse.agentId as string) || null
        subAgentName = (toolInput?.name as string) || null
        subAgentDescription = (toolInput?.description as string) || null
      }
    } else if (hookEventName === 'SubagentStop') {
      subAgentId = (raw.agent_id as string) || null
    }
  } else {
    // === TRANSCRIPT JSONL FORMAT ===
    type = (raw.type as string) || 'unknown'

    if (raw.subtype) {
      subtype = raw.subtype as string
    }

    const data = raw.data as Record<string, unknown> | undefined
    const message = raw.message as Record<string, unknown> | undefined
    const toolUseResult = raw.toolUseResult as Record<string, unknown> | undefined

    if (type === 'progress' && data) {
      const dataType = data.type as string

      if (dataType === 'hook_progress') {
        subtype = (data.hookEvent as string) || null
        const hookName = data.hookName as string
        if (hookName && hookName.includes(':')) {
          toolName = hookName.split(':').slice(1).join(':')
        }
      }

      if (dataType === 'agent_progress') {
        subtype = 'agent_progress'
        subAgentId = (data.agentId as string) || null
        const nestedMsg = data.message as Record<string, unknown> | undefined
        if (nestedMsg?.message) {
          const innerMsg = nestedMsg.message as Record<string, unknown>
          const content = innerMsg.content
          if (Array.isArray(content)) {
            const toolUse = content.find((c: any) => c.type === 'tool_use') as
              | Record<string, unknown>
              | undefined
            if (toolUse) {
              toolName = (toolUse.name as string) || null
            }
          }
        }
      }
    }

    if (type === 'assistant' && message) {
      const content = message.content
      if (Array.isArray(content)) {
        const toolUse = content.find((c: any) => c.type === 'tool_use') as
          | Record<string, unknown>
          | undefined
        if (toolUse) {
          toolName = (toolUse.name as string) || null
          if (toolName === 'Agent') {
            const input = toolUse.input as Record<string, unknown> | undefined
            subAgentName = (input?.name as string) || null
            subAgentDescription = (input?.description as string) || null
          }
        }
      }
    }

    if (toolUseResult) {
      subAgentId = (toolUseResult.agentId as string) || subAgentId
    }
  }

  const metadata: Record<string, unknown> = {}
  for (const key of [
    'version',
    'gitBranch',
    'cwd',
    'entrypoint',
    'permissionMode',
    'userType',
    'permission_mode',
  ]) {
    if (raw[key] !== undefined) metadata[key] = raw[key]
  }

  return {
    projectName,
    sessionId,
    slug,
    transcriptPath,
    hookName,
    type,
    subtype,
    toolName,
    timestamp,
    ownerAgentId,
    subAgentId,
    subAgentName,
    subAgentDescription,
    metadata,
    raw,
  }
}

// Guard against bogus future timestamps. A sentinel like `9999999999999`
// (year 2286) injected by a test fixture — or a misconfigured CLI — will
// poison downstream views that compute session spans (rewind timeline
// blows the pixel budget; session sort orders get thrown off). We allow
// up to 24h in the future to tolerate clock skew / timezone drift, then
// clamp anything further to the ingest time.
const FUTURE_TS_CAP_MS = 24 * 60 * 60 * 1000

function parseTimestamp(ts: unknown): number {
  const parsed = coerceTimestamp(ts)
  const now = Date.now()
  if (parsed > now + FUTURE_TS_CAP_MS) {
    console.warn(
      `[parser] Clamping future timestamp ${parsed} (>${FUTURE_TS_CAP_MS / 3600000}h ahead) to now=${now}`,
    )
    return now
  }
  return parsed
}

function coerceTimestamp(ts: unknown): number {
  if (typeof ts === 'number') return ts
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime()
    return isNaN(parsed) ? Date.now() : parsed
  }
  return Date.now()
}
