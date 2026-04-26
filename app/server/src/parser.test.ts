import { describe, test, expect } from 'vitest'
import { validateEnvelope, EnvelopeValidationError, clampTimestamp } from './parser'

describe('validateEnvelope — new shape', () => {
  test('accepts a minimally valid envelope', () => {
    const result = validateEnvelope({
      agentClass: 'claude-code',
      sessionId: 's1',
      agentId: 'a1',
      hookName: 'PreToolUse',
      payload: {},
    })
    expect(result.envelope.sessionId).toBe('s1')
    expect(result.envelope.agentId).toBe('a1')
    expect(result.envelope.agentClass).toBe('claude-code')
    expect(result.envelope.hookName).toBe('PreToolUse')
    expect(result.timestamp).toBeGreaterThan(0)
  })

  test('preserves _meta and flags verbatim when provided', () => {
    const result = validateEnvelope({
      agentClass: 'claude-code',
      sessionId: 's1',
      agentId: 'a1',
      hookName: 'SessionStart',
      payload: { hello: 'world' },
      _meta: {
        session: { transcriptPath: '/x', startCwd: '/cwd' },
        project: { slug: 'override' },
      },
      flags: { startsNotification: true, resolveProject: true },
    })
    expect(result.envelope._meta?.session?.transcriptPath).toBe('/x')
    expect(result.envelope._meta?.project?.slug).toBe('override')
    expect(result.envelope.flags?.startsNotification).toBe(true)
    expect(result.envelope.flags?.resolveProject).toBe(true)
  })

  test('uses provided timestamp when present', () => {
    const result = validateEnvelope({
      agentClass: 'x',
      sessionId: 's',
      agentId: 'a',
      hookName: 'h',
      payload: {},
      timestamp: 1700000000000,
    })
    expect(result.timestamp).toBe(1700000000000)
  })

  test('clamps absurd future timestamps to now', () => {
    const result = validateEnvelope({
      agentClass: 'x',
      sessionId: 's',
      agentId: 'a',
      hookName: 'h',
      payload: {},
      timestamp: Number.MAX_SAFE_INTEGER,
    })
    expect(result.timestamp).toBeLessThan(Date.now() + 1000)
  })

  test('falls back to ingest time when timestamp is absent', () => {
    const before = Date.now()
    const result = validateEnvelope({
      agentClass: 'x',
      sessionId: 's',
      agentId: 'a',
      hookName: 'h',
      payload: {},
    })
    expect(result.timestamp).toBeGreaterThanOrEqual(before)
    expect(result.timestamp).toBeLessThanOrEqual(Date.now())
  })
})

describe('validateEnvelope — rejection', () => {
  test('rejects non-object input', () => {
    expect(() => validateEnvelope(null)).toThrow(EnvelopeValidationError)
    expect(() => validateEnvelope('string')).toThrow(EnvelopeValidationError)
    expect(() => validateEnvelope(42)).toThrow(EnvelopeValidationError)
  })

  test('rejects empty object with full missingFields list', () => {
    let caught: unknown
    try {
      validateEnvelope({})
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EnvelopeValidationError)
    const err = caught as EnvelopeValidationError
    expect(err.missingFields).toEqual(['agentClass', 'sessionId', 'agentId', 'hookName', 'payload'])
  })

  test('rejects with a partial missingFields list', () => {
    let caught: unknown
    try {
      validateEnvelope({
        agentClass: 'x',
        sessionId: 's',
        payload: {},
        // agentId + hookName missing
      })
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(EnvelopeValidationError)
    expect((caught as EnvelopeValidationError).missingFields).toEqual(['agentId', 'hookName'])
  })

  test('rejects when payload is null', () => {
    let caught: unknown
    try {
      validateEnvelope({
        agentClass: 'x',
        sessionId: 's',
        agentId: 'a',
        hookName: 'h',
        payload: null,
      })
    } catch (err) {
      caught = err
    }
    expect((caught as EnvelopeValidationError).missingFields).toEqual(['payload'])
  })
})

// ---------------------------------------------------------------------------
// Legacy compatibility — pre-Phase-4 hook libs still post `{ hook_payload, meta }`.
// These tests pin the translation behavior. The branch is retired in Phase 4.
// ---------------------------------------------------------------------------

describe('validateEnvelope — legacy compatibility', () => {
  test('translates legacy claude-code envelope into new shape', () => {
    const result = validateEnvelope({
      hook_payload: {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-1',
        cwd: '/Users/joe/repo',
        transcript_path: '/path/to/sess-1.jsonl',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      },
      meta: {
        agentClass: 'claude-code',
        hookName: 'PreToolUse',
        sessionId: 'sess-1',
      },
    })
    expect(result.envelope.agentClass).toBe('claude-code')
    expect(result.envelope.sessionId).toBe('sess-1')
    expect(result.envelope.agentId).toBe('sess-1') // defaulted from sessionId
    expect(result.envelope.hookName).toBe('PreToolUse')
    expect(result.envelope.cwd).toBe('/Users/joe/repo')
    expect(result.envelope._meta?.session?.transcriptPath).toBe('/path/to/sess-1.jsonl')
    expect(result.envelope._meta?.session?.startCwd).toBe('/Users/joe/repo')
    // Payload is preserved verbatim.
    expect(result.envelope.payload).toMatchObject({
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    })
  })

  test('legacy isNotification translates to flags.startsNotification', () => {
    const result = validateEnvelope({
      hook_payload: {
        hook_event_name: 'Notification',
        session_id: 'sess-1',
      },
      meta: {
        agentClass: 'claude-code',
        hookName: 'Notification',
        sessionId: 'sess-1',
        isNotification: true,
      },
    })
    expect(result.envelope.flags?.startsNotification).toBe(true)
  })

  test('legacy claude-code UserPromptSubmit gets clearsNotification', () => {
    const result = validateEnvelope({
      hook_payload: {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'sess-1',
      },
      meta: {
        agentClass: 'claude-code',
        hookName: 'UserPromptSubmit',
        sessionId: 'sess-1',
      },
    })
    expect(result.envelope.flags?.clearsNotification).toBe(true)
  })

  test('legacy claude-code SessionEnd gets stopsSession', () => {
    const result = validateEnvelope({
      hook_payload: {
        hook_event_name: 'SessionEnd',
        session_id: 'sess-1',
      },
      meta: {
        agentClass: 'claude-code',
        hookName: 'SessionEnd',
        sessionId: 'sess-1',
      },
    })
    expect(result.envelope.flags?.stopsSession).toBe(true)
  })

  test('legacy claude-code SessionStart gets resolveProject', () => {
    const result = validateEnvelope({
      hook_payload: {
        hook_event_name: 'SessionStart',
        session_id: 'sess-1',
      },
      meta: {
        agentClass: 'claude-code',
        hookName: 'SessionStart',
        sessionId: 'sess-1',
      },
    })
    expect(result.envelope.flags?.resolveProject).toBe(true)
  })

  test('legacy env.AGENTS_OBSERVE_PROJECT_SLUG becomes _meta.project.slug', () => {
    const result = validateEnvelope({
      hook_payload: { hook_event_name: 'PreToolUse', session_id: 'sess-1' },
      meta: {
        agentClass: 'claude-code',
        hookName: 'PreToolUse',
        sessionId: 'sess-1',
        env: { AGENTS_OBSERVE_PROJECT_SLUG: 'my-project' },
      },
    })
    expect(result.envelope._meta?.project?.slug).toBe('my-project')
  })

  test('legacy payload metadata keys land on _meta.session.metadata', () => {
    const result = validateEnvelope({
      hook_payload: {
        hook_event_name: 'SessionStart',
        session_id: 'sess-1',
        version: '2.2.0',
        gitBranch: 'main',
      },
      meta: {
        agentClass: 'claude-code',
        hookName: 'SessionStart',
        sessionId: 'sess-1',
      },
    })
    expect(result.envelope._meta?.session?.metadata).toEqual({
      version: '2.2.0',
      gitBranch: 'main',
    })
  })

  test('legacy subagent payload preserves agent_id as agentId', () => {
    const result = validateEnvelope({
      hook_payload: {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-1',
        agent_id: 'sub-agent-xyz',
      },
      meta: {
        agentClass: 'claude-code',
        hookName: 'PreToolUse',
        sessionId: 'sess-1',
        agentId: 'sub-agent-xyz',
      },
    })
    expect(result.envelope.agentId).toBe('sub-agent-xyz')
  })

  test('legacy ISO string timestamp parsed to epoch ms', () => {
    const result = validateEnvelope({
      hook_payload: {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-1',
        timestamp: '2026-03-25T22:24:17.686Z',
      },
      meta: {
        agentClass: 'claude-code',
        hookName: 'PreToolUse',
        sessionId: 'sess-1',
      },
    })
    expect(result.timestamp).toBe(new Date('2026-03-25T22:24:17.686Z').getTime())
  })
})

describe('clampTimestamp', () => {
  test('returns reasonable values unchanged', () => {
    const ts = Date.now() - 1000
    expect(clampTimestamp(ts)).toBe(ts)
  })

  test('clamps far-future to now', () => {
    const before = Date.now()
    const result = clampTimestamp(Number.MAX_SAFE_INTEGER)
    expect(result).toBeGreaterThanOrEqual(before)
    expect(result).toBeLessThanOrEqual(Date.now())
  })

  test('NaN/Infinity fall back to now', () => {
    const before = Date.now()
    expect(clampTimestamp(NaN)).toBeGreaterThanOrEqual(before)
    expect(clampTimestamp(Infinity)).toBeGreaterThanOrEqual(before)
  })
})
