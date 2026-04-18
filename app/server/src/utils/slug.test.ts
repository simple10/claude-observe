import { describe, test, expect } from 'vitest'
import {
  extractProjectDir,
  deriveSlugCandidates,
  deriveSlugCandidatesFromCwd,
  normalizeCwd,
} from './slug'

describe('extractProjectDir', () => {
  test('strips filename from transcript path', () => {
    expect(
      extractProjectDir('/Users/joe/.claude/projects/-Users-joe-Dev-my-app/abc-123.jsonl'),
    ).toBe('/Users/joe/.claude/projects/-Users-joe-Dev-my-app')
  })

  test('returns directory as-is when no file extension', () => {
    expect(extractProjectDir('/Users/joe/.claude/projects/-Users-joe-Dev-my-app')).toBe(
      '/Users/joe/.claude/projects/-Users-joe-Dev-my-app',
    )
  })

  test('strips trailing slash', () => {
    expect(extractProjectDir('/Users/joe/.claude/projects/-Users-joe-Dev-my-app/')).toBe(
      '/Users/joe/.claude/projects/-Users-joe-Dev-my-app',
    )
  })
})

describe('deriveSlugCandidates', () => {
  test('extracts last two segments from Claude project path', () => {
    const candidates = deriveSlugCandidates(
      '/Users/joe/.claude/projects/-Users-joe-Development-opik-agent-super-spy-agents-observe',
    )
    expect(candidates[0]).toBe('agents-observe')
  })

  test('returns progressively longer segments', () => {
    const candidates = deriveSlugCandidates(
      '/Users/joe/.claude/projects/-Users-joe-Development-my-app',
    )
    expect(candidates[0]).toBe('my-app')
    expect(candidates[1]).toBe('development-my-app')
  })

  test('handles single-segment encoded path', () => {
    const candidates = deriveSlugCandidates('/Users/joe/.claude/projects/-myproject')
    expect(candidates[0]).toBe('myproject')
  })

  test('handles transcript path with filename', () => {
    const candidates = deriveSlugCandidates(
      '/Users/joe/.claude/projects/-Users-joe-Development-my-app/abc-123.jsonl',
    )
    expect(candidates[0]).toBe('my-app')
  })

  test('lowercases the slug', () => {
    const candidates = deriveSlugCandidates('/Users/joe/.claude/projects/-MyApp')
    expect(candidates[0]).toBe('myapp')
  })

  test('returns unknown for empty path', () => {
    expect(deriveSlugCandidates('')).toEqual(['unknown'])
  })

  // Codex's transcripts live under /YYYY/MM/DD, so the bare "17"
  // fallback slug was meaningless — prefer the full date string.
  test('collapses trailing YYYY/MM/DD into a single YYYY-MM-DD slug', () => {
    expect(deriveSlugCandidates('/Users/joe/.codex/sessions/2026/04/17/abc-123.jsonl')).toEqual([
      '2026-04-17',
    ])
  })

  test('zero-pads single-digit month/day', () => {
    expect(deriveSlugCandidates('/Users/joe/.codex/sessions/2026/4/7/session.jsonl')).toEqual([
      '2026-04-07',
    ])
  })

  test('matches directory path without a filename', () => {
    expect(deriveSlugCandidates('/Users/joe/.codex/sessions/2026/04/17')).toEqual(['2026-04-17'])
  })

  test('tolerates trailing slash on the directory', () => {
    expect(deriveSlugCandidates('/Users/joe/.codex/sessions/2026/04/17/')).toEqual(['2026-04-17'])
  })

  test('does not match when the date is not at the tail', () => {
    // /projects/2026/04/17/my-app — last segment is "my-app", not a date
    const candidates = deriveSlugCandidates('/Users/joe/projects/2026/04/17/my-app')
    expect(candidates[0]).toBe('my-app')
  })
})

describe('normalizeCwd', () => {
  test('strips a trailing slash', () => {
    expect(normalizeCwd('/Users/joe/proj/')).toBe('/Users/joe/proj')
  })

  test('strips multiple trailing slashes', () => {
    expect(normalizeCwd('/Users/joe/proj///')).toBe('/Users/joe/proj')
  })

  test('returns null for null/undefined/empty', () => {
    expect(normalizeCwd(null)).toBeNull()
    expect(normalizeCwd(undefined)).toBeNull()
    expect(normalizeCwd('')).toBeNull()
  })

  test('leaves non-trailing-slash input alone', () => {
    expect(normalizeCwd('/Users/joe/proj')).toBe('/Users/joe/proj')
  })
})

describe('deriveSlugCandidatesFromCwd', () => {
  test('first candidate is the basename', () => {
    const candidates = deriveSlugCandidatesFromCwd('/Users/joe/Development/my-app')
    expect(candidates[0]).toBe('my-app')
  })

  test('returns progressively longer candidates', () => {
    const candidates = deriveSlugCandidatesFromCwd('/Users/joe/Development/my-app')
    expect(candidates[0]).toBe('my-app')
    expect(candidates[1]).toBe('development-my-app')
    expect(candidates[2]).toBe('joe-development-my-app')
  })

  test('lowercases the slug', () => {
    const candidates = deriveSlugCandidatesFromCwd('/Users/joe/Development/MyApp')
    expect(candidates[0]).toBe('myapp')
    expect(candidates[1]).toBe('development-myapp')
  })

  test('handles trailing slash', () => {
    expect(deriveSlugCandidatesFromCwd('/Users/joe/Dev/my-app/')[0]).toBe('my-app')
  })

  test('handles single-segment cwd', () => {
    expect(deriveSlugCandidatesFromCwd('/tmp')).toEqual(['tmp'])
  })

  test('returns unknown for empty string', () => {
    expect(deriveSlugCandidatesFromCwd('')).toEqual(['unknown'])
  })
})
