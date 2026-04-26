// hooks/scripts/lib/agents/default.mjs
// Default hook lib. Other agent classes compose this and override as
// needed. Assumes the standard hook-event payload shape:
//   - payload.session_id      (required for the envelope's sessionId)
//   - payload.agent_id        (optional; defaults to sessionId)
//   - payload.hook_event_name (required for the envelope's hookName)
//   - payload.cwd             (optional, per-event)
//   - payload.transcript_path (optional, lifted to _meta.session)
//   - payload.timestamp       (optional, falls back to ingest time)
//
// Builds the new flat envelope shape per
// docs/specs/2026-04-25-three-layer-contract-design.md
// §"Layer 1 Contract — The Envelope".
//
// Default behavior is conservative: the only flag the default lib sets
// is `startsNotification` (when the hookName matches the configured
// notification list). Per-class libs (claude-code, codex) compose this
// and add their own flags (clearsNotification, stopsSession,
// resolveProject).

const NOTIFICATION_HOOKS_DEFAULT = ['Notification']

function notificationHooks(config) {
  if (config?.notificationOnEvents !== undefined) return config.notificationOnEvents
  return NOTIFICATION_HOOKS_DEFAULT
}

export function buildEnv(config) {
  const env = {}
  if (config?.projectSlug) env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
  return env
}

export function isNotificationEvent(config, hookName) {
  return notificationHooks(config).includes(hookName)
}

/**
 * Build the envelope for a hook payload. Normalizes identity fields
 * out of the payload into the envelope; never mutates the payload.
 *
 * @returns {{ envelope: object, hookEvent: string, toolName: string }}
 */
export function buildHookEvent(config, _log, payload) {
  const sessionId = payload?.session_id || payload?.sessionId
  const agentId = payload?.agent_id || payload?.agentId || sessionId
  const hookName = payload?.hook_event_name || payload?.hookName
  const cwd = payload?.cwd ?? null
  const transcriptPath = payload?.transcript_path ?? null
  const timestamp = typeof payload?.timestamp === 'number' ? payload.timestamp : undefined

  const flags = {}
  if (hookName && isNotificationEvent(config, hookName)) {
    flags.startsNotification = true
  }
  // Default lib is conservative: it never sets clearsNotification,
  // stopsSession, or resolveProject. Per-class libs decide.

  const _meta = {}
  if (transcriptPath) {
    _meta.session = { transcriptPath }
  }
  if (cwd) {
    _meta.session = _meta.session || {}
    _meta.session.startCwd = cwd // server uses only on first event
  }
  // Project slug override carried via env var lands on _meta.project.
  if (config?.projectSlug) {
    _meta.project = { slug: config.projectSlug }
  }

  const envelope = {
    agentClass: 'default',
    sessionId,
    agentId,
    hookName,
    cwd,
    payload,
  }
  if (timestamp !== undefined) envelope.timestamp = timestamp
  if (Object.keys(_meta).length > 0) envelope._meta = _meta
  if (Object.keys(flags).length > 0) envelope.flags = flags

  const toolName = payload?.tool_name || payload?.tool?.name || ''
  return { envelope, hookEvent: hookName ?? '', toolName }
}

/**
 * No-op session-info handler. The default lib has no transcript-shape
 * knowledge — agent-class-specific libs (claude-code, codex) implement
 * this. The callbacks dispatcher tolerates a null return gracefully.
 */
export function getSessionInfo() {
  return null
}

// Re-export for composing libs (claude-code, codex). Lets a per-class
// lib `import { defaultLib } from './default.mjs'` and call into the
// canonical builder without depending on individual named exports.
export const defaultLib = { buildHookEvent, buildEnv, isNotificationEvent, getSessionInfo }
