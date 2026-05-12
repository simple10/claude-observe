import { describe, test, expect } from 'vitest'
import { RE2JS } from 're2js'
import { compileFilters, flagsStringToRE2, wrapWithAnchor } from './compile'
import type { Filter } from '@/types'

function f(opts: Partial<Filter>): Filter {
  return {
    id: 'id',
    name: 'name',
    pillName: 'pill',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '.' }],
    kind: 'user',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...opts,
  }
}

describe('compileFilters', () => {
  test('skips disabled filters', () => {
    const out = compileFilters([f({ enabled: false })])
    expect(out).toEqual([])
  })

  test('compiles regexes from string patterns', () => {
    const out = compileFilters([f({ patterns: [{ target: 'hook', regex: '^x$' }] })])
    expect(out.length).toBe(1)
    expect(out[0].patterns[0].regex).toBeInstanceOf(RE2JS)
    expect(out[0].patterns[0].regex.test('x')).toBe(true)
  })

  test('skips filters with an invalid regex', () => {
    const out = compileFilters([f({ patterns: [{ target: 'hook', regex: '(' }] })])
    expect(out).toEqual([])
  })

  test('preserves order of input filters', () => {
    const a = f({ id: 'a', name: 'a' })
    const b = f({ id: 'b', name: 'b' })
    const out = compileFilters([a, b])
    expect(out.map((c) => c.id)).toEqual(['a', 'b'])
  })

  test('auto-anchors unanchored user regexes for safety', () => {
    expect(wrapWithAnchor('is_error')).toBe('^.*?(?:is_error)')
    expect(wrapWithAnchor('foo|bar')).toBe('^.*?(?:foo|bar)')
  })

  test('preserves explicit ^-anchored patterns verbatim', () => {
    expect(wrapWithAnchor('^Stop$')).toBe('^Stop$')
    expect(wrapWithAnchor('^(PreToolUse|PostToolUse)$')).toBe('^(PreToolUse|PostToolUse)$')
  })

  test('avoids doubly-greedy prefix when user starts with .*/.+', () => {
    // RE2 doesn't backtrack, but keeping the wrap consistent for these
    // leading-greedy patterns avoids producing the awkward `^.*?(?:.*X)`
    // form. With the guard, the wrap is the simpler `^.*X`.
    expect(wrapWithAnchor('.*Test')).toBe('^.*Test')
    expect(wrapWithAnchor('.+word')).toBe('^.+word')
    expect(wrapWithAnchor('.*?lazy')).toBe('^.*?lazy')
    expect(wrapWithAnchor('.+?lazy')).toBe('^.+?lazy')
  })

  test('compiled regex preserves "matches anywhere" semantics after wrap', () => {
    const out = compileFilters([f({ patterns: [{ target: 'payload', regex: 'is_error' }] })])
    expect(out[0].patterns[0].regex.test('{"foo":1,"is_error":true}')).toBe(true)
    expect(out[0].patterns[0].regex.test('{"foo":1}')).toBe(false)
  })

  test('compiled regex from alternation correctly groups', () => {
    const out = compileFilters([f({ patterns: [{ target: 'tool', regex: 'Bash|Read' }] })])
    expect(out[0].patterns[0].regex.test('Bash')).toBe(true)
    expect(out[0].patterns[0].regex.test('Read')).toBe(true)
    expect(out[0].patterns[0].regex.test('Edit')).toBe(false)
  })

  test('carries the negate flag through compilation', () => {
    const out = compileFilters([
      f({ patterns: [{ target: 'tool', regex: '^Bash$', negate: true }] }),
    ])
    expect(out[0].patterns[0].negate).toBe(true)
  })

  test('omits negate when source pattern has it false / absent', () => {
    const a = compileFilters([f({ patterns: [{ target: 'tool', regex: '^Bash$' }] })])
    const b = compileFilters([
      f({ patterns: [{ target: 'tool', regex: '^Bash$', negate: false }] }),
    ])
    expect(a[0].patterns[0].negate).toBeUndefined()
    expect(b[0].patterns[0].negate).toBeUndefined()
  })

  test('passes flags through to the compiled regex', () => {
    const out = compileFilters([f({ patterns: [{ target: 'tool', regex: 'bash', flags: 'i' }] })])
    expect(out[0].patterns[0].regex.flags() & RE2JS.CASE_INSENSITIVE).toBeTruthy()
    expect(out[0].patterns[0].regex.test('BASH')).toBe(true)
    expect(out[0].patterns[0].regex.test('Bash')).toBe(true)
  })

  test('absent flags compile to a case-sensitive regex', () => {
    const out = compileFilters([f({ patterns: [{ target: 'tool', regex: 'bash' }] })])
    expect(out[0].patterns[0].regex.flags() & RE2JS.CASE_INSENSITIVE).toBeFalsy()
    expect(out[0].patterns[0].regex.test('BASH')).toBe(false)
  })
})

describe('flagsStringToRE2', () => {
  test('maps i/m/s into the RE2JS bitfield', () => {
    expect(flagsStringToRE2('')).toBe(0)
    expect(flagsStringToRE2(undefined)).toBe(0)
    expect(flagsStringToRE2('i') & RE2JS.CASE_INSENSITIVE).toBeTruthy()
    expect(flagsStringToRE2('m') & RE2JS.MULTILINE).toBeTruthy()
    expect(flagsStringToRE2('s') & RE2JS.DOTALL).toBeTruthy()
    // Combined letters compose to the OR of their flag bits.
    const all = flagsStringToRE2('ims')
    expect(all & RE2JS.CASE_INSENSITIVE).toBeTruthy()
    expect(all & RE2JS.MULTILINE).toBeTruthy()
    expect(all & RE2JS.DOTALL).toBeTruthy()
  })
})
