import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AgentClassIcon, agentClassDisplayName } from './agent-class-icon'

describe('agentClassDisplayName', () => {
  it('returns "claude" for claude-code', () => {
    expect(agentClassDisplayName('claude-code')).toBe('claude')
  })

  it('returns "codex" for codex', () => {
    expect(agentClassDisplayName('codex')).toBe('codex')
  })

  it('falls back to "claude" for null (legacy rows)', () => {
    expect(agentClassDisplayName(null)).toBe('claude')
    expect(agentClassDisplayName(undefined)).toBe('claude')
  })

  it('returns "unknown" for an unregistered class', () => {
    expect(agentClassDisplayName('not-a-real-class')).toBe('unknown')
  })
})

describe('AgentClassIcon', () => {
  it('renders an svg for a registered class', () => {
    const { container } = render(<AgentClassIcon agentClass="codex" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg?.getAttribute('class')).toContain('h-3 w-3')
  })

  it('renders an svg for an unknown class (default registration)', () => {
    const { container } = render(<AgentClassIcon agentClass="not-a-real-class" />)
    expect(container.querySelector('svg')).not.toBeNull()
  })

  it('merges caller className onto the icon', () => {
    const { container } = render(
      <AgentClassIcon agentClass="claude-code" className="text-red-500" />,
    )
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('class')).toContain('text-red-500')
  })
})
