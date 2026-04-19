// hooks/scripts/lib/agents/unknown.mjs
// Fallback agent lib used when the CLI is invoked with an agent class
// that doesn't have a dedicated module. Builds a pass-through envelope
// with no notification flags — so unrecognized agents silently work but
// never produce bells until they implement their own lib.

function buildEnv(config) {
  const env = {}
  if (config?.projectSlug) {
    env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
  }
  return env
}

/**
 * @returns {{ envelope: object, hookEvent: string, toolName: string }}
 */
export function buildHookEvent(config, _log, hookPayload) {
  const hookEvent = hookPayload?.hook_event_name || 'unknown'
  const toolName = hookPayload?.tool_name || hookPayload?.tool?.name || ''
  const envelope = {
    hook_payload: hookPayload,
    meta: {
      agentClass: config?.agentClass || 'unknown',
      env: buildEnv(config),
    },
  }
  return { envelope, hookEvent, toolName }
}

/** No-op session-info handler. The callbacks dispatcher skips gracefully. */
export function getSessionInfo() {
  return null
}
