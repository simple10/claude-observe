import { describe, test, expect, vi } from 'vitest'
import { RE2JS } from 're2js'
import { applyFilters } from './matcher'
import type { CompiledFilter } from './types'

function compile(opts: {
  name: string
  pillName?: string
  display?: 'primary' | 'secondary'
  combinator?: 'and' | 'or'
  patterns: { target: 'hook' | 'tool' | 'payload'; regex: string; negate?: boolean }[]
}): CompiledFilter {
  return {
    id: opts.name,
    name: opts.name,
    pillName: opts.pillName ?? opts.name,
    display: opts.display ?? 'primary',
    combinator: opts.combinator ?? 'and',
    patterns: opts.patterns.map((p) => ({
      target: p.target,
      regex: RE2JS.compile(p.regex),
      ...(p.negate ? { negate: true } : {}),
    })),
  }
}

const baseRaw = {
  id: 1,
  agentId: 'a',
  hookName: 'PostToolUse',
  timestamp: 0,
  payload: { tool_input: { command: 'ls' } },
}

describe('applyFilters', () => {
  test('returns empty when no compiled filters', () => {
    expect(applyFilters(baseRaw, 'Bash', [])).toEqual({ primary: [], secondary: [] })
  })

  test('hook-target match emits a primary pill', () => {
    const f = compile({ name: 'Hook', patterns: [{ target: 'hook', regex: '^PostToolUse$' }] })
    expect(applyFilters(baseRaw, 'Bash', [f])).toEqual({ primary: ['Hook'], secondary: [] })
  })

  test('AND combinator requires all patterns', () => {
    const f = compile({
      name: 'AndCase',
      combinator: 'and',
      patterns: [
        { target: 'hook', regex: '^PostToolUse$' },
        { target: 'tool', regex: '^Read$' },
      ],
    })
    // toolName=Bash; second pattern fails
    expect(applyFilters(baseRaw, 'Bash', [f]).primary).toEqual([])
    expect(applyFilters(baseRaw, 'Read', [f]).primary).toEqual(['AndCase'])
  })

  test('OR combinator passes on first match', () => {
    const f = compile({
      name: 'OrCase',
      combinator: 'or',
      patterns: [
        { target: 'hook', regex: '^Nope$' },
        { target: 'tool', regex: '^Bash$' },
      ],
    })
    expect(applyFilters(baseRaw, 'Bash', [f]).primary).toEqual(['OrCase'])
  })

  test('payload-target triggers JSON.stringify once and is reused', () => {
    const f1 = compile({ name: 'Cmd', patterns: [{ target: 'payload', regex: 'ls' }] })
    const f2 = compile({ name: 'Cmd2', patterns: [{ target: 'payload', regex: 'tool_input' }] })
    const out = applyFilters(baseRaw, 'Bash', [f1, f2])
    expect(out.primary.sort()).toEqual(['Cmd', 'Cmd2'])
  })

  test('payload-target is skipped when no rule needs it', () => {
    const spy = vi.spyOn(JSON, 'stringify')
    const f = compile({ name: 'Hook', patterns: [{ target: 'hook', regex: '.' }] })
    const before = spy.mock.calls.length
    applyFilters(baseRaw, 'Bash', [f])
    const after = spy.mock.calls.length
    expect(after).toBe(before)
    spy.mockRestore()
  })

  test('pillName template {toolName} resolves per event', () => {
    const f = compile({
      name: 'AnyTool',
      pillName: '{toolName}',
      display: 'secondary',
      patterns: [{ target: 'hook', regex: '^PostToolUse$' }],
    })
    expect(applyFilters(baseRaw, 'Bash', [f])).toEqual({ primary: [], secondary: ['Bash'] })
    expect(applyFilters(baseRaw, 'Read', [f])).toEqual({ primary: [], secondary: ['Read'] })
  })

  test('filter is skipped when pillName variable is null', () => {
    const f = compile({
      name: 'BashOnly',
      pillName: '{bashCommand}',
      patterns: [{ target: 'hook', regex: '^PostToolUse$' }],
    })
    expect(applyFilters({ ...baseRaw, payload: {} }, 'Read', [f]).primary).toEqual([])
  })

  test('bashCommand variable resolves only when toolName is Bash', () => {
    const f = compile({
      name: 'Cmd',
      pillName: '{bashCommand}',
      display: 'secondary',
      patterns: [{ target: 'tool', regex: '^Bash$' }],
    })
    expect(applyFilters(baseRaw, 'Bash', [f])).toEqual({ primary: [], secondary: ['ls'] })
  })

  test('bashCommand strips arguments and resolves to the leading binary', () => {
    const f = compile({
      name: 'Cmd',
      pillName: '{bashCommand}',
      display: 'secondary',
      patterns: [{ target: 'tool', regex: '^Bash$' }],
    })
    const cases: { command: string; expected: string }[] = [
      { command: 'ls -la foo', expected: 'ls' },
      { command: 'npm run lint -- --fix', expected: 'npm' },
      { command: '  cat /tmp/x  ', expected: 'cat' },
      // Leading newline / tab — same trim + split rule.
      { command: '\n\tbash scripts/run.sh', expected: 'bash' },
      // Single-word command unchanged.
      { command: 'pwd', expected: 'pwd' },
      // Multi-line heredoc — binary is still the first token.
      { command: 'cat <<EOF\nhello\nEOF', expected: 'cat' },
    ]
    for (const { command, expected } of cases) {
      const raw = { ...baseRaw, payload: { tool_input: { command } } }
      expect(applyFilters(raw, 'Bash', [f]).secondary).toEqual([expected])
    }
  })

  test('bashCommand returns null for empty/whitespace-only commands', () => {
    const f = compile({
      name: 'Cmd',
      pillName: '{bashCommand}',
      display: 'secondary',
      patterns: [{ target: 'tool', regex: '^Bash$' }],
    })
    // Empty / whitespace-only command produces no binary → pill skipped.
    for (const command of ['', '   ', '\n\n']) {
      const raw = { ...baseRaw, payload: { tool_input: { command } } }
      expect(applyFilters(raw, 'Bash', [f]).secondary).toEqual([])
    }
  })

  test('literal pillName (no template) always resolves', () => {
    const f = compile({ name: 'Always', patterns: [{ target: 'hook', regex: '.' }] })
    expect(applyFilters(baseRaw, null, [f]).primary).toEqual(['Always'])
  })

  test('negate inverts a single-pattern match result', () => {
    const f = compile({
      name: 'NotBash',
      patterns: [{ target: 'tool', regex: '^Bash$', negate: true }],
    })
    expect(applyFilters(baseRaw, 'Bash', [f]).primary).toEqual([])
    expect(applyFilters(baseRaw, 'Read', [f]).primary).toEqual(['NotBash'])
  })

  test('negate participates in AND combinator (Tools-style exclusion)', () => {
    // Mirrors the rewritten Tools default seed: hook in [...] AND tool
    // non-empty AND tool NOT in {Agent, TaskCreate, TaskUpdate, mcp__*}.
    const tools = compile({
      name: 'Tools',
      patterns: [
        { target: 'hook', regex: '^PostToolUse$' },
        { target: 'tool', regex: '^.+' },
        { target: 'tool', regex: '^(Agent$|TaskCreate$|TaskUpdate$|mcp__)', negate: true },
      ],
    })
    expect(applyFilters(baseRaw, 'Bash', [tools]).primary).toEqual(['Tools'])
    expect(applyFilters(baseRaw, 'Agent', [tools]).primary).toEqual([])
    expect(applyFilters(baseRaw, 'TaskCreate', [tools]).primary).toEqual([])
    expect(applyFilters(baseRaw, 'mcp__chrome-devtools', [tools]).primary).toEqual([])
    expect(applyFilters(baseRaw, 'AgentMaker', [tools]).primary).toEqual(['Tools'])
    // Empty toolName fails the non-empty pattern, so no match even
    // though the negated check would otherwise pass.
    expect(applyFilters(baseRaw, '', [tools]).primary).toEqual([])
  })
})
