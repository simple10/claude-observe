// app/server/src/parser.ts
// Extracts structural fields from raw JSONL events.
// NO formatting, NO truncation, NO summary generation — that's the client's job.

export interface ParsedRawEvent {
  projectName: string | null
  sessionId: string
  slug: string | null
  transcriptPath: string | null
  type: string
  subtype: string | null
  toolName: string | null
  toolUseId: string | null
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

export function parseRawEvent(raw: Record<string, unknown>): ParsedRawEvent {
  const projectName = (raw.project_name as string) || null
  const sessionId = (raw.session_id as string) || 'unknown'
  const slug = (raw.slug as string) || null
  const transcriptPath = (raw.transcript_path as string) || null
  const meta = raw.meta as Record<string, unknown> | undefined
  const timestamp = parseTimestamp(meta?.timestamp ?? raw.timestamp)
  const toolUseId = (raw.tool_use_id as string) || null
  // agent_id is present on hook events fired from subagents
  const ownerAgentId = (raw.agent_id as string) || null

  let type: string
  let subtype: string | null = null
  let toolName: string | null = null
  let subAgentId: string | null = null
  let subAgentName: string | null = null
  let subAgentDescription: string | null = null

  const hookEventName = raw.hook_event_name as string | undefined

  if (hookEventName) {
    // === HOOK FORMAT ===
    const hookToolName = raw.tool_name as string | undefined
    const toolInput = raw.tool_input as Record<string, unknown> | undefined

    switch (hookEventName) {
      case 'SessionStart':
        type = 'session'
        subtype = 'SessionStart'
        break
      case 'UserPromptSubmit':
        type = 'user'
        subtype = 'UserPromptSubmit'
        break
      case 'PreToolUse':
        type = 'tool'
        subtype = 'PreToolUse'
        toolName = hookToolName || null
        if (toolName === 'Agent') {
          subAgentName = (toolInput?.name as string) || null
          subAgentDescription = (toolInput?.description as string) || null
        }
        break
      case 'PostToolUse':
        type = 'tool'
        subtype = 'PostToolUse'
        toolName = hookToolName || null
        // Extract subagent info from Agent tool response
        if (toolName === 'Agent') {
          const toolResponse = raw.tool_response as Record<string, unknown> | undefined
          if (toolResponse) {
            subAgentId = (toolResponse.agentId as string) || null
            subAgentName = (toolInput?.name as string) || null
            subAgentDescription = (toolInput?.description as string) || null
          }
        }
        break
      case 'Stop':
        type = 'system'
        subtype = 'Stop'
        break
      case 'SubagentStop':
        type = 'system'
        subtype = 'SubagentStop'
        subAgentId = (raw.agent_id as string) || null
        break
      case 'PostToolUseFailure':
        type = 'tool'
        subtype = 'PostToolUseFailure'
        toolName = hookToolName || null
        break
      case 'Notification':
        type = 'system'
        subtype = 'Notification'
        break
      default:
        type = 'system'
        subtype = hookEventName
        break
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
    type,
    subtype,
    toolName,
    toolUseId,
    timestamp,
    ownerAgentId,
    subAgentId,
    subAgentName,
    subAgentDescription,
    metadata,
    raw,
  }
}

function parseTimestamp(ts: unknown): number {
  if (typeof ts === 'number') return ts
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime()
    return isNaN(parsed) ? Date.now() : parsed
  }
  return Date.now()
}
