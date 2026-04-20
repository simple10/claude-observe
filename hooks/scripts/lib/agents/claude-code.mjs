import { readFileSync } from 'node:fs'
import { isNotificationEvent } from './index.mjs'

/**
 * Hook events that must not clear a pending notification. Terminal
 * lifecycle events from the agent itself — e.g. a subagent's
 * `SubagentStop` firing after the main agent's `Notification` — should
 * leave bell state alone rather than wiping the pending flag.
 *
 * `isNotificationEvent` wins over this set: if a user opts `Stop` into
 * `AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS`, Stop stamps `isNotification`
 * instead of being treated as non-clearing. SubagentStop stays fixed.
 */
const NON_CLEARING_EVENTS = new Set(['SubagentStop', 'Stop'])

function buildEnv(config) {
  const env = {}
  if (config?.projectSlug) {
    env.AGENTS_OBSERVE_PROJECT_SLUG = config.projectSlug
  }
  return env
}

/**
 * Build the event envelope for a Claude Code hook payload. Stamps the
 * appropriate notification flags based on the hook event name so the
 * server can apply them mechanically without knowing Claude-Code-specific
 * semantics.
 *
 * @param {object} config
 * @param {object} _log
 * @param {object} hookPayload Raw hook payload from Claude Code.
 * @returns {{ envelope: object, hookEvent: string, toolName: string }}
 */
export function buildHookEvent(config, _log, hookPayload) {
  const hookEvent = hookPayload?.hook_event_name || 'unknown'
  const toolName = hookPayload?.tool_name || hookPayload?.tool?.name || ''
  const flags = {}
  if (isNotificationEvent(config, hookEvent, hookPayload)) {
    flags.isNotification = true
  } else if (NON_CLEARING_EVENTS.has(hookEvent)) {
    flags.clearsNotification = false
  }
  const envelope = {
    hook_payload: hookPayload,
    meta: {
      agentClass: 'claude-code',
      env: buildEnv(config),
      ...flags,
    },
  }
  return { envelope, hookEvent, toolName }
}

/**
 * Scan a Claude Code transcript jsonl for the session slug and the
 * git branch. Both fields are top-level on hook entries (e.g.
 * `{ "slug": "...", "gitBranch": "...", ... }`), so we read line-by-line
 * and extract either one as soon as we see it. Returns as soon as both
 * are found; the slug takes priority for the response but both are
 * surfaced to the server so it can fall back to git.branch.
 *
 * Shape returned matches the shared getSessionInfo contract:
 *   { slug: string|null, git: { branch: string|null, repository_url: null } }
 *
 * `repository_url` is always null for Claude Code since the transcripts
 * don't carry the remote origin.
 *
 * @param {object} args
 * @param {string} [args.transcript_path] Absolute path to the jsonl transcript.
 * @param {string} [args.agentClass] The session's agent class — always
 *   "claude-code" by the time this handler is dispatched, but kept in
 *   the arg signature for symmetry with other agents.
 * @param {string|null} [args.cwd] Working dir of the session when the
 *   callback was requested. Currently unused; reserved for future
 *   heuristics (e.g. git-repo discovery via `git -C <cwd>`).
 * @param {object} ctx
 * @param {object} ctx.log Logger with debug/warn/etc.
 */
export function getSessionInfo({ transcript_path, agentClass: _agentClass, cwd: _cwd }, { log }) {
  if (!transcript_path) {
    log.debug('claude-code.getSessionInfo: no transcript_path provided')
    return null
  }

  let content
  try {
    content = readFileSync(transcript_path, 'utf8')
  } catch (err) {
    log.warn(
      `claude-code.getSessionInfo: cannot read transcript ${transcript_path}: ${err.message}`,
    )
    return null
  }

  let slug = null
  let branch = null

  let pos = 0
  while (pos < content.length) {
    const nextNewline = content.indexOf('\n', pos)
    const end = nextNewline === -1 ? content.length : nextNewline
    const line = content.slice(pos, end).trim()
    pos = end + 1
    if (!line) continue
    // Cheap pre-check: only parse lines that could contain what we want.
    const hasSlug = slug === null && line.includes('"slug"')
    const hasBranch = branch === null && line.includes('"gitBranch"')
    if (!hasSlug && !hasBranch) continue

    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    if (slug === null && typeof entry.slug === 'string' && entry.slug) {
      slug = entry.slug
    }
    if (branch === null && typeof entry.gitBranch === 'string' && entry.gitBranch) {
      branch = entry.gitBranch
    }
    if (slug !== null && branch !== null) break
  }

  if (slug === null && branch === null) {
    log.debug(`claude-code.getSessionInfo: no slug or gitBranch in ${transcript_path}`)
  } else {
    log.debug(`claude-code.getSessionInfo: slug=${slug} branch=${branch}`)
  }

  return {
    slug,
    git: { branch, repository_url: null },
  }
}
