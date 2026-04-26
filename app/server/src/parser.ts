// app/server/src/parser.ts
//
// Layer 2 envelope validation. The server only ever inspects identity
// fields, creation hints (_meta), and flags. Payload shape is opaque.
//
// Spec: docs/specs/2026-04-25-three-layer-contract-design.md
//   §"Layer 1 Contract — The Envelope"
//   §"Layer 2 Contract — Server Behavior"

import type { EventEnvelope, EventEnvelopeCreationHints, EventEnvelopeFlags } from './types'

export interface ValidatedEnvelope {
  envelope: EventEnvelope
  timestamp: number
}

export class EnvelopeValidationError extends Error {
  missingFields: string[]
  constructor(message: string, missingFields: string[]) {
    super(message)
    this.name = 'EnvelopeValidationError'
    this.missingFields = missingFields
  }
}

/**
 * Validate an incoming envelope. Accepts both the new shape (top-level
 * identity fields per spec) and the legacy `{ hook_payload, meta }`
 * wrapper that pre-Phase-4 hook libs still post. Legacy envelopes are
 * translated into the new shape here so the rest of the server only
 * handles one form.
 *
 * NOTE: The legacy compatibility branch is transitional. Phase 4 of the
 * three-layer-contract refactor rewrites the hook libs to emit the new
 * shape directly; once those land, this branch can be retired.
 */
export function validateEnvelope(raw: unknown): ValidatedEnvelope {
  if (!raw || typeof raw !== 'object') {
    throw new EnvelopeValidationError('envelope must be an object', [])
  }

  const candidate = isLegacyEnvelope(raw)
    ? translateLegacyEnvelope(raw as LegacyEnvelope)
    : (raw as Partial<EventEnvelope>)

  const missing: string[] = []
  if (!candidate.agentClass) missing.push('agentClass')
  if (!candidate.sessionId) missing.push('sessionId')
  if (!candidate.agentId) missing.push('agentId')
  if (!candidate.hookName) missing.push('hookName')
  if (candidate.payload === undefined || candidate.payload === null) missing.push('payload')

  if (missing.length > 0) {
    throw new EnvelopeValidationError(
      `envelope missing required fields: ${missing.join(', ')}`,
      missing,
    )
  }

  const timestamp =
    typeof candidate.timestamp === 'number' ? clampTimestamp(candidate.timestamp) : Date.now()

  return { envelope: candidate as EventEnvelope, timestamp }
}

// ---------------------------------------------------------------------------
// Legacy envelope translation (transitional; retired in Phase 4)
// ---------------------------------------------------------------------------

interface LegacyEnvelopeMeta {
  agentClass?: string
  env?: Record<string, string>
  hookName?: string
  sessionId?: string
  agentId?: string | null
  type?: string
  subtype?: string | null
  toolName?: string | null
  isNotification?: boolean
  clearsNotification?: boolean
}

interface LegacyEnvelope {
  hook_payload: Record<string, unknown>
  meta?: LegacyEnvelopeMeta
}

function isLegacyEnvelope(raw: object): raw is LegacyEnvelope {
  return (
    'hook_payload' in raw &&
    typeof (raw as LegacyEnvelope).hook_payload === 'object' &&
    (raw as LegacyEnvelope).hook_payload !== null
  )
}

/**
 * Translate the pre-Phase-4 envelope (`{ hook_payload, meta }`) into the
 * new shape. The legacy meta carried identity bits at the meta level;
 * everything else has to be lifted from the payload itself.
 */
function translateLegacyEnvelope(legacy: LegacyEnvelope): Partial<EventEnvelope> {
  const meta = legacy.meta ?? {}
  const payload = legacy.hook_payload ?? {}

  const agentClass = meta.agentClass ?? 'claude-code'
  const sessionId = meta.sessionId ?? (payload.session_id as string | undefined) ?? ''
  // Legacy convention: when the payload doesn't carry an explicit
  // agent_id, the event belongs to the root agent (== sessionId).
  const agentId = meta.agentId ?? (payload.agent_id as string | undefined) ?? sessionId
  const hookName =
    meta.hookName ??
    (payload.hook_event_name as string | undefined) ??
    (typeof meta.subtype === 'string' ? meta.subtype : '') ??
    ''

  const cwd = (payload.cwd as string | undefined) ?? null
  const transcriptPath = (payload.transcript_path as string | undefined) ?? null

  // Lift session-level hints. Legacy hooks did not distinguish per-event
  // cwd from session-start cwd; mirror cwd into both for now and let the
  // server's "preserve-on-update" upsert keep the first value sticky.
  const sessionHints: NonNullable<EventEnvelopeCreationHints['session']> = {}
  if (transcriptPath) sessionHints.transcriptPath = transcriptPath
  if (cwd) sessionHints.startCwd = cwd
  // Legacy raw payload metadata keys (gitBranch, version, etc.) used to
  // get stuffed into sessions.metadata via the parser's `metadata` bag.
  // Reproduce the same behavior so that callbacks/sessions UI keep
  // showing those fields after the refactor.
  const legacyMetadata: Record<string, unknown> = {}
  for (const key of [
    'version',
    'gitBranch',
    'entrypoint',
    'permissionMode',
    'userType',
    'permission_mode',
  ]) {
    const value = (payload as Record<string, unknown>)[key]
    if (value !== undefined) legacyMetadata[key] = value
  }
  if (Object.keys(legacyMetadata).length > 0) sessionHints.metadata = legacyMetadata

  const _meta: EventEnvelopeCreationHints = {}
  if (Object.keys(sessionHints).length > 0) _meta.session = sessionHints

  // Project slug override carried via env on legacy meta.
  const projectSlug = meta.env?.AGENTS_OBSERVE_PROJECT_SLUG
  if (projectSlug) _meta.project = { slug: projectSlug }

  // Translate notification flags. Legacy `isNotification: true` becomes
  // `startsNotification`; `clearsNotification: false` becomes the absence
  // of the (default-on) clears flag — but in the new model nothing is
  // default-on, so we just skip emitting it. Lifecycle stops/resolves
  // are derived from the hook name for legacy compatibility (Phase 4
  // moves this lifting into the libs).
  const flags: EventEnvelopeFlags = {}
  if (meta.isNotification === true) flags.startsNotification = true
  if (agentClass === 'claude-code') {
    if (hookName === 'UserPromptSubmit') flags.clearsNotification = true
    if (hookName === 'SessionEnd') flags.stopsSession = true
    if (hookName === 'SessionStart') flags.resolveProject = true
  }
  // Legacy claude-code lib set `clearsNotification: false` on
  // SubagentStop / Stop. The new contract treats absence-of-flag as
  // "do nothing", which is the same effect — no translation needed.

  const envelope: Partial<EventEnvelope> = {
    agentClass,
    sessionId,
    agentId,
    hookName,
    cwd: cwd ?? null,
    payload,
  }
  if (Object.keys(_meta).length > 0) envelope._meta = _meta
  if (Object.keys(flags).length > 0) envelope.flags = flags

  // Lift legacy meta.timestamp / payload.timestamp if present.
  const ts = (payload as Record<string, unknown>).timestamp
  if (typeof ts === 'number') envelope.timestamp = ts
  else if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime()
    if (!isNaN(parsed)) envelope.timestamp = parsed
  }

  return envelope
}

// ---------------------------------------------------------------------------
// Timestamp clamping
// ---------------------------------------------------------------------------

// Guard against bogus future timestamps. A sentinel like `9999999999999`
// (year 2286) injected by a test fixture — or a misconfigured CLI — will
// poison downstream views that compute session spans (rewind timeline
// blows the pixel budget; session sort orders get thrown off). We allow
// up to 24h in the future to tolerate clock skew / timezone drift, then
// clamp anything further to the ingest time.
const FUTURE_TS_CAP_MS = 24 * 60 * 60 * 1000

export function clampTimestamp(ts: number): number {
  const now = Date.now()
  if (!Number.isFinite(ts)) return now
  if (ts > now + FUTURE_TS_CAP_MS) {
    console.warn(
      `[parser] Clamping future timestamp ${ts} (>${FUTURE_TS_CAP_MS / 3600000}h ahead) to now=${now}`,
    )
    return now
  }
  return ts
}
