import { describe, it, expect } from 'vitest'
import {
  AGENT_LIBS,
  getAgentClass,
  getAgentLib,
} from '../../../../../hooks/scripts/lib/agents/index.mjs'

describe('agents registry', () => {
  it('registers claude-code, codex, and unknown', () => {
    expect(AGENT_LIBS['claude-code']).toBeDefined()
    expect(AGENT_LIBS.codex).toBeDefined()
    expect(AGENT_LIBS.unknown).toBeDefined()
  })
})

describe('getAgentClass', () => {
  it('returns the configured class when recognized', () => {
    expect(getAgentClass({ agentClass: 'claude-code' })).toBe('claude-code')
    expect(getAgentClass({ agentClass: 'codex' })).toBe('codex')
  })

  it('returns "unknown" for unrecognized classes', () => {
    expect(getAgentClass({ agentClass: 'made-up' })).toBe('unknown')
    expect(getAgentClass({ agentClass: '' })).toBe('unknown')
    expect(getAgentClass({})).toBe('unknown')
    expect(getAgentClass(null)).toBe('unknown')
  })
})

describe('getAgentLib', () => {
  it('resolves registered libs', () => {
    expect(getAgentLib('claude-code')).toBe(AGENT_LIBS['claude-code'])
    expect(getAgentLib('codex')).toBe(AGENT_LIBS.codex)
    expect(getAgentLib('unknown')).toBe(AGENT_LIBS.unknown)
  })

  it('falls back to the unknown lib for anything else', () => {
    expect(getAgentLib('what')).toBe(AGENT_LIBS.unknown)
    expect(getAgentLib(undefined)).toBe(AGENT_LIBS.unknown)
  })
})
