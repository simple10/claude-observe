// hooks/scripts/lib/agents/index.mjs
// Central registry + dispatch helpers for agent-class-specific CLI code.
// Both the hook-send path and the callback dispatcher go through here.

import * as claudeCode from './claude-code.mjs'
import * as codex from './codex.mjs'
import * as unknown from './unknown.mjs'

export const AGENT_LIBS = {
  'claude-code': claudeCode,
  codex: codex,
  unknown: unknown,
}

/**
 * Pick the agent class for an outgoing hook event. Today this simply
 * trusts `config.agentClass` (set via env var or project override) and
 * falls back to 'unknown' for anything we don't recognize. The signature
 * accepts `log` and `hookPayload` so a future heuristic can sniff the
 * payload shape without breaking callers.
 *
 * @returns {'claude-code'|'codex'|'unknown'}
 */
export function getAgentClass(config, _log, _hookPayload) {
  const configured = config?.agentClass
  if (configured && AGENT_LIBS[configured]) return configured
  return 'unknown'
}

/** Resolve the agent lib module, falling back to the unknown-agent lib. */
export function getAgentLib(agentClass) {
  return AGENT_LIBS[agentClass] || AGENT_LIBS.unknown
}
