import { describe, it, expect, vi } from 'vitest'
import {
  buildHookEvent,
  buildEnv,
  isNotificationEvent,
  getSessionInfo,
  defaultLib,
} from '../../../../../hooks/scripts/lib/agents/default.mjs'

function makeLog() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }
}

describe('default.buildHookEvent', () => {
  it('extracts identity fields from a standard hook payload', () => {
    const { envelope } = buildHookEvent({}, makeLog(), {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      agent_id: 'sub-1',
      tool_name: 'Bash',
      cwd: '/tmp/work',
    })
    expect(envelope.agentClass).toBe('default')
    expect(envelope.sessionId).toBe('sess-1')
    expect(envelope.agentId).toBe('sub-1')
    expect(envelope.hookName).toBe('PreToolUse')
    expect(envelope.cwd).toBe('/tmp/work')
    // Payload preserved verbatim.
    expect(envelope.payload.tool_name).toBe('Bash')
  })

  it('defaults agentId to sessionId when payload has no agent_id', () => {
    const { envelope } = buildHookEvent({}, makeLog(), {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-only',
    })
    expect(envelope.sessionId).toBe('sess-only')
    expect(envelope.agentId).toBe('sess-only')
  })

  it('lifts transcript_path to _meta.session.transcriptPath', () => {
    const { envelope } = buildHookEvent({}, makeLog(), {
      hook_event_name: 'SessionStart',
      session_id: 'sess-1',
      transcript_path: '/path/to/sess-1.jsonl',
    })
    expect(envelope._meta?.session?.transcriptPath).toBe('/path/to/sess-1.jsonl')
  })

  it('lifts cwd to _meta.session.startCwd (server uses on first event only)', () => {
    const { envelope } = buildHookEvent({}, makeLog(), {
      hook_event_name: 'SessionStart',
      session_id: 'sess-1',
      cwd: '/Users/joe/repo',
    })
    expect(envelope._meta?.session?.startCwd).toBe('/Users/joe/repo')
    expect(envelope.cwd).toBe('/Users/joe/repo')
  })

  it('lifts config.projectSlug to _meta.project.slug', () => {
    const { envelope } = buildHookEvent({ projectSlug: 'my-proj' }, makeLog(), {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
    })
    expect(envelope._meta?.project?.slug).toBe('my-proj')
  })

  it('lifts numeric payload.timestamp to envelope.timestamp', () => {
    const { envelope } = buildHookEvent({}, makeLog(), {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      timestamp: 1700000000000,
    })
    expect(envelope.timestamp).toBe(1700000000000)
  })

  it('omits envelope.timestamp when payload.timestamp is non-numeric', () => {
    const { envelope } = buildHookEvent({}, makeLog(), {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      timestamp: '2026-01-01T00:00:00Z',
    })
    expect(envelope.timestamp).toBeUndefined()
  })

  it('sets flags.startsNotification on Notification hook by default', () => {
    const { envelope } = buildHookEvent({}, makeLog(), {
      hook_event_name: 'Notification',
      session_id: 'sess-1',
    })
    expect(envelope.flags?.startsNotification).toBe(true)
  })

  it('honors AGENTS_OBSERVE_NOTIFICATION_ON_EVENTS override', () => {
    // Custom list → only listed events flag startsNotification.
    const optIn = { notificationOnEvents: ['CustomEvent'] }
    const a = buildHookEvent(optIn, makeLog(), {
      hook_event_name: 'CustomEvent',
      session_id: 'sess-1',
    })
    expect(a.envelope.flags?.startsNotification).toBe(true)

    // Default-list event no longer triggers when overridden.
    const b = buildHookEvent(optIn, makeLog(), {
      hook_event_name: 'Notification',
      session_id: 'sess-1',
    })
    expect(b.envelope.flags?.startsNotification).toBeUndefined()

    // Empty list disables every event.
    const optOut = { notificationOnEvents: [] }
    const c = buildHookEvent(optOut, makeLog(), {
      hook_event_name: 'Notification',
      session_id: 'sess-1',
    })
    expect(c.envelope.flags?.startsNotification).toBeUndefined()
  })

  it('does not mutate the input payload', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'Bash',
      cwd: '/x',
      transcript_path: '/y.jsonl',
    }
    const snapshot = JSON.parse(JSON.stringify(payload))
    buildHookEvent({ projectSlug: 'p' }, makeLog(), payload)
    expect(payload).toEqual(snapshot)
  })

  it('omits _meta and flags from envelope when they would be empty', () => {
    const { envelope } = buildHookEvent({}, makeLog(), {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
    })
    // No cwd, no transcript_path, no projectSlug → no _meta.
    expect(envelope._meta).toBeUndefined()
    // Non-notification event → no flags.
    expect(envelope.flags).toBeUndefined()
  })

  it('returns hookEvent and toolName for caller logging', () => {
    const { hookEvent, toolName } = buildHookEvent({}, makeLog(), {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'Bash',
    })
    expect(hookEvent).toBe('PreToolUse')
    expect(toolName).toBe('Bash')
  })

  it('preserves the raw payload as envelope.payload', () => {
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_input: { command: 'ls' },
      custom_field: 'keep me',
    }
    const { envelope } = buildHookEvent({}, makeLog(), payload)
    expect(envelope.payload).toBe(payload) // exact same reference
    expect(envelope.payload.custom_field).toBe('keep me')
  })
})

describe('default.buildEnv', () => {
  it('returns an object with AGENTS_OBSERVE_PROJECT_SLUG when configured', () => {
    expect(buildEnv({ projectSlug: 'p' })).toEqual({ AGENTS_OBSERVE_PROJECT_SLUG: 'p' })
  })

  it('returns an empty object when no slug', () => {
    expect(buildEnv({})).toEqual({})
    expect(buildEnv(null)).toEqual({})
  })
})

describe('default.isNotificationEvent', () => {
  it('treats Notification as a notification event by default', () => {
    expect(isNotificationEvent({}, 'Notification')).toBe(true)
    expect(isNotificationEvent({}, 'PreToolUse')).toBe(false)
  })

  it('honors a custom list', () => {
    const config = { notificationOnEvents: ['Stop'] }
    expect(isNotificationEvent(config, 'Stop')).toBe(true)
    expect(isNotificationEvent(config, 'Notification')).toBe(false)
  })

  it('returns false for every event when the list is empty', () => {
    const config = { notificationOnEvents: [] }
    expect(isNotificationEvent(config, 'Notification')).toBe(false)
  })
})

describe('default.getSessionInfo', () => {
  it('always returns null', () => {
    expect(getSessionInfo()).toBeNull()
  })
})

describe('default.defaultLib namespace', () => {
  it('exports the canonical helpers for composing libs', () => {
    expect(defaultLib.buildHookEvent).toBe(buildHookEvent)
    expect(defaultLib.buildEnv).toBe(buildEnv)
    expect(defaultLib.isNotificationEvent).toBe(isNotificationEvent)
    expect(defaultLib.getSessionInfo).toBe(getSessionInfo)
  })
})
