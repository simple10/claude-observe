import { describe, test, expect, beforeEach } from 'vitest'
import { SqliteAdapter } from '../storage/sqlite-adapter'
import { resolveProject } from './project-resolver'

let store: SqliteAdapter

beforeEach(() => {
  store = new SqliteAdapter(':memory:')
})

describe('resolveProject', () => {
  test('creates new project from slug when no project exists', async () => {
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'my-project',
      transcriptPath: null,
    })
    expect(result.projectId).toBeGreaterThan(0)
    expect(result.projectSlug).toBe('my-project')
    expect(result.created).toBe(true)
  })

  test('returns existing project when slug matches', async () => {
    const existingId = await store.createProject('my-project', 'my-project', null)
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'my-project',
      transcriptPath: null,
    })
    expect(result.projectId).toBe(existingId)
    expect(result.created).toBe(false)
  })

  test('matches project by transcript_path when no slug provided', async () => {
    const existingId = await store.createProject(
      'my-project',
      'my-project',
      '/Users/joe/.claude/projects/-Users-joe-my-app',
    )
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.claude/projects/-Users-joe-my-app/session.jsonl',
    })
    expect(result.projectId).toBe(existingId)
    expect(result.created).toBe(false)
  })

  test('creates project from transcript_path when no match exists', async () => {
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.claude/projects/-Users-joe-Development-my-app/session.jsonl',
    })
    expect(result.projectId).toBeGreaterThan(0)
    expect(result.projectSlug).toBe('my-app')
    expect(result.created).toBe(true)
  })

  test('handles slug collision when deriving from transcript_path', async () => {
    await store.createProject('my-app', 'my-app', '/other/path')
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.claude/projects/-Users-joe-Development-my-app/session.jsonl',
    })
    expect(result.projectId).toBeGreaterThan(0)
    expect(result.projectSlug).toBe('development-my-app')
    expect(result.created).toBe(true)
  })

  test('falls back to unknown project when no slug or transcript_path', async () => {
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: null,
    })
    expect(result.projectId).toBeGreaterThan(0)
    expect(result.projectSlug).toBe('unknown')
    expect(result.created).toBe(true)
  })

  test('reuses existing unknown project on second call', async () => {
    const r1 = await resolveProject(store, { sessionId: 's1', slug: null, transcriptPath: null })
    const r2 = await resolveProject(store, { sessionId: 's2', slug: null, transcriptPath: null })
    expect(r1.projectId).toBe(r2.projectId)
  })

  test('slug override takes priority over transcript_path', async () => {
    await store.createProject(
      'from-path',
      'from-path',
      '/Users/joe/.claude/projects/-Users-joe-my-app',
    )
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'custom-slug',
      transcriptPath: '/Users/joe/.claude/projects/-Users-joe-my-app/session.jsonl',
    })
    expect(result.projectSlug).toBe('custom-slug')
    expect(result.created).toBe(true)
  })

  // ── cwd-based resolution ────────────────────────────────────────────

  test('matches existing project by cwd before falling through to transcript_path', async () => {
    const existingId = await store.createProject(
      'my-app',
      'my-app',
      '/some/other/transcript/dir',
      '/Users/joe/Development/my-app',
    )
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.codex/sessions/2026/04/17/xxx.jsonl',
      cwd: '/Users/joe/Development/my-app',
    })
    expect(result.projectId).toBe(existingId)
    expect(result.projectSlug).toBe('my-app')
    expect(result.created).toBe(false)
  })

  test('creates new project with cwd-derived slug (not transcript-path-derived)', async () => {
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.codex/sessions/2026/04/17/xxx.jsonl',
      cwd: '/Users/joe/Development/my-app',
    })
    expect(result.projectSlug).toBe('my-app')
    expect(result.created).toBe(true)
    // cwd persisted on the project so the next session at the same cwd matches
    const project = await store.getProjectById(result.projectId)
    expect(project.cwd).toBe('/Users/joe/Development/my-app')
  })

  test('normalizes trailing slashes on cwd for matching', async () => {
    const existingId = await store.createProject(
      'my-app',
      'my-app',
      null,
      '/Users/joe/Development/my-app',
    )
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: null,
      cwd: '/Users/joe/Development/my-app/',
    })
    expect(result.projectId).toBe(existingId)
  })

  test('cwd match takes precedence over transcript_path match', async () => {
    // Two projects: one keyed by cwd, one by transcript_path. cwd wins.
    const cwdProject = await store.createProject(
      'cwd-match',
      'cwd-match',
      null,
      '/Users/joe/Development/my-app',
    )
    await store.createProject(
      'path-match',
      'path-match',
      '/Users/joe/.codex/sessions/2026/04/17',
      null,
    )
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.codex/sessions/2026/04/17/xxx.jsonl',
      cwd: '/Users/joe/Development/my-app',
    })
    expect(result.projectId).toBe(cwdProject)
    expect(result.projectSlug).toBe('cwd-match')
  })

  test('slug collision when deriving from cwd appends suffix', async () => {
    // Pre-existing "my-app" project at a different cwd
    await store.createProject('my-app', 'my-app', null, '/some/other/path')
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: null,
      cwd: '/Users/joe/Development/my-app',
    })
    // First candidate "my-app" is taken, falls back to "development-my-app"
    expect(result.projectSlug).toBe('development-my-app')
    expect(result.created).toBe(true)
  })

  test('backfills cwd on a pre-existing project when matched by slug', async () => {
    const id = await store.createProject('my-project', 'my-project', null, null)
    await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'my-project',
      transcriptPath: null,
      cwd: '/Users/joe/my-project',
    })
    const project = await store.getProjectById(id)
    expect(project.cwd).toBe('/Users/joe/my-project')
  })

  test('does not overwrite an existing cwd when matched by slug', async () => {
    const id = await store.createProject(
      'my-project',
      'my-project',
      null,
      '/Users/joe/original-cwd',
    )
    await resolveProject(store, {
      sessionId: 'sess1',
      slug: 'my-project',
      transcriptPath: null,
      cwd: '/Users/joe/different-cwd',
    })
    const project = await store.getProjectById(id)
    expect(project.cwd).toBe('/Users/joe/original-cwd')
  })

  test('falls through to transcript_path when cwd does not match an existing project', async () => {
    // Only a transcript-path project exists; new session with a DIFFERENT cwd
    // should NOT match it (cwd has higher priority and creates a new project).
    await store.createProject(
      'from-path',
      'from-path',
      '/Users/joe/.claude/projects/-Users-joe-my-app',
      null,
    )
    const result = await resolveProject(store, {
      sessionId: 'sess1',
      slug: null,
      transcriptPath: '/Users/joe/.claude/projects/-Users-joe-my-app/session.jsonl',
      cwd: '/Users/joe/Development/other-app',
    })
    expect(result.projectSlug).toBe('other-app')
    expect(result.created).toBe(true)
  })
})
