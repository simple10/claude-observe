import { describe, it, expect, vi } from 'vitest'
import { buildHookEvent, getSessionInfo } from '../../../../../hooks/scripts/lib/agents/unknown.mjs'

function makeLog() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }
}

describe('unknown.buildHookEvent', () => {
  it('builds a pass-through envelope with no notification flags', () => {
    const { envelope, hookEvent, toolName } = buildHookEvent(
      { agentClass: 'made-up-class', projectSlug: 'p1' },
      makeLog(),
      { hook_event_name: 'Anything', tool_name: 'Foo' },
    )
    expect(envelope.meta.agentClass).toBe('made-up-class')
    expect(envelope.meta.env.AGENTS_OBSERVE_PROJECT_SLUG).toBe('p1')
    expect(envelope.meta.isNotification).toBeUndefined()
    expect(envelope.meta.clearsNotification).toBeUndefined()
    expect(hookEvent).toBe('Anything')
    expect(toolName).toBe('Foo')
  })

  it('defaults meta.agentClass to "unknown" when config is missing', () => {
    const { envelope } = buildHookEvent(null, makeLog(), {})
    expect(envelope.meta.agentClass).toBe('unknown')
  })

  it('stamps hookName / toolName / sessionId / agentId from standard payload keys', () => {
    const { envelope } = buildHookEvent({ agentClass: 'unknown' }, makeLog(), {
      hook_event_name: 'SomeHook',
      tool_name: 'Bash',
      session_id: 'sess-1',
      agent_id: 'sub-1',
    })
    expect(envelope.meta.hookName).toBe('SomeHook')
    expect(envelope.meta.toolName).toBe('Bash')
    expect(envelope.meta.sessionId).toBe('sess-1')
    expect(envelope.meta.agentId).toBe('sub-1')
    expect(envelope.meta.type).toBeUndefined()
    expect(envelope.meta.subtype).toBeUndefined()
  })
})

describe('unknown.getSessionInfo', () => {
  it('always returns null', () => {
    expect(getSessionInfo()).toBeNull()
  })
})
