import { describe, test, expect } from 'vitest'
import { deriveSlugFromPath } from './slug'

describe('deriveSlugFromPath', () => {
  test('uses the basename of the path', () => {
    expect(deriveSlugFromPath('/Users/joe/Development/my-app')).toBe('my-app')
  })

  test('lowercases the slug', () => {
    expect(deriveSlugFromPath('/Users/joe/.claude/projects/-MyApp')).toBe('myapp')
  })

  test('strips trailing slashes before taking the basename', () => {
    expect(deriveSlugFromPath('/Users/joe/Dev/my-app/')).toBe('my-app')
  })

  test('replaces non-alphanumeric runs with a single hyphen', () => {
    expect(deriveSlugFromPath('/tmp/My App (test)')).toBe('my-app-test')
  })

  test('trims leading and trailing hyphens from the result', () => {
    expect(deriveSlugFromPath('/-foo-')).toBe('foo')
  })

  test('returns "unnamed" for empty input', () => {
    expect(deriveSlugFromPath('')).toBe('unnamed')
  })

  test('returns "unnamed" when basename normalizes to empty', () => {
    expect(deriveSlugFromPath('/!!!')).toBe('unnamed')
  })

  test('handles a single-segment path', () => {
    expect(deriveSlugFromPath('/tmp')).toBe('tmp')
  })
})
