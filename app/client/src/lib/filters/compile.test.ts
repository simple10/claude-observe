import { describe, test, expect } from 'vitest'
import { compileFilters } from './compile'
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
    expect(out[0].patterns[0].regex).toBeInstanceOf(RegExp)
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
})
