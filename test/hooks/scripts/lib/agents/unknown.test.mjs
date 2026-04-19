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
})

describe('unknown.getSessionInfo', () => {
  it('always returns null', () => {
    expect(getSessionInfo()).toBeNull()
  })
})
