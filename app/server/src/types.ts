// app/server/src/types.ts

// === Database Row Types ===

export interface ProjectRow {
  id: number
  slug: string
  name: string
  transcript_path: string | null
  created_at: number
  updated_at: number
}

export interface SessionRow {
  id: string
  project_id: number
  slug: string | null
  status: string
  started_at: number
  stopped_at: number | null
  metadata: string | null
  created_at: number
  updated_at: number
}

export interface AgentRow {
  id: string
  session_id: string
  parent_agent_id: string | null
  name: string | null
  description: string | null
  agent_type: string | null
  agent_class: string
  created_at: number
  updated_at: number
}

export interface EventRow {
  id: number
  agent_id: string
  session_id: string
  hook_name: string | null
  type: string
  subtype: string | null
  tool_name: string | null
  timestamp: number
  created_at: number
  payload: string
}

// === API Response Types ===

export interface Project {
  id: number
  slug: string
  name: string
  createdAt: number
  sessionCount?: number
}

export interface Session {
  id: string
  projectId: number
  slug: string | null
  status: string
  startedAt: number
  stoppedAt: number | null
  metadata: Record<string, unknown> | null
  agentCount?: number
  eventCount?: number
}

export interface Agent {
  id: string
  sessionId: string
  parentAgentId: string | null
  name: string | null
  description: string | null
  agentType?: string | null
}

export interface ParsedEvent {
  id: number
  agentId: string
  sessionId: string
  hookName: string | null
  type: string
  subtype: string | null
  toolName: string | null
  status: string // derived from subtype, not stored
  timestamp: number
  createdAt: number
  payload: Record<string, unknown>
}

// === Event Envelope (CLI → server) ===

export interface EventEnvelopeMeta {
  agentClass?: string
  env?: Record<string, string>
  /**
   * When true, this event marks the session as having a pending
   * notification. The server sets `pending_notification_ts` to the event
   * timestamp and broadcasts `notification` if the transition is new.
   */
  isNotification?: boolean
  /**
   * When explicitly `false`, this event does NOT clear a pending
   * notification. Any other value (including undefined) lets the server
   * apply the default clearing behavior.
   */
  clearsNotification?: boolean

  // ---- Event descriptors (stamped by the CLI, one per indexed column) ----
  /** Raw hook event name as emitted by the agent (agent-class-native). */
  hookName?: string
  /** Normalized top-level category (e.g. 'tool', 'user', 'session'). */
  type?: string
  /** Normalized sub-category (e.g. 'PreToolUse'). */
  subtype?: string | null
  /** Tool name (Pre/PostToolUse events), null otherwise. */
  toolName?: string | null
  /** Session id extracted from the payload by the agent lib. */
  sessionId?: string
  /** Subagent id if the event came from a subagent; null for main agent. */
  agentId?: string | null
}

export interface EventEnvelope {
  hook_payload: Record<string, unknown>
  meta?: EventEnvelopeMeta
}

// === WebSocket Message Types ===

export type WSMessage =
  | { type: 'event'; data: ParsedEvent }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }

// Messages FROM clients
export type WSClientMessage = { type: 'subscribe'; sessionId: string } | { type: 'unsubscribe' }
