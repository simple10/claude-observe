import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildHookEvent,
  getSessionInfo,
} from '../../../../../hooks/scripts/lib/agents/claude-code.mjs'

function makeLog() {
  return {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  }
}

function writeTranscript(lines) {
  const dir = join(tmpdir(), `cc-getinfo-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'transcript.jsonl')
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'))
  return { path, dir }
}

describe('claude-code.getSessionInfo', () => {
  it('returns null when transcript_path is missing', () => {
    expect(getSessionInfo({}, { log: makeLog() })).toBeNull()
  })

  it('returns null when the transcript file cannot be read', () => {
    const log = makeLog()
    expect(getSessionInfo({ transcript_path: '/no/such/file' }, { log })).toBeNull()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('cannot read transcript'))
  })

  it('extracts slug and gitBranch from top-level fields', () => {
    const { path, dir } = writeTranscript([
      { type: 'system' },
      { slug: 'my-session', gitBranch: 'feat/foo', cwd: '/tmp' },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: 'my-session',
      git: { branch: 'feat/foo', repository_url: null },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('combines slug and gitBranch when they appear on different lines', () => {
    const { path, dir } = writeTranscript([
      { gitBranch: 'main', type: 'hook' },
      { type: 'assistant' },
      { slug: 'the-slug' },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: 'the-slug',
      git: { branch: 'main', repository_url: null },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null fields when neither appears in the transcript', () => {
    const { path, dir } = writeTranscript([{ type: 'system' }, { type: 'user' }])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: null,
      git: { branch: null, repository_url: null },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('ignores malformed json lines', () => {
    const { path, dir } = writeTranscript([
      '{ not valid json',
      { slug: 'real-slug', gitBranch: 'real-branch' },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.slug).toBe('real-slug')
    expect(result.git.branch).toBe('real-branch')
    rmSync(dir, { recursive: true, force: true })
  })

  it('ignores empty-string values', () => {
    const { path, dir } = writeTranscript([{ slug: '', gitBranch: '' }, { slug: 'ok' }])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.slug).toBe('ok')
    expect(result.git.branch).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('claude-code.buildHookEvent', () => {
  const config = { agentClass: 'claude-code', projectSlug: 'my-proj' }

  it('stamps agentClass and env on every envelope', () => {
    const { envelope } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    })
    expect(envelope.meta.agentClass).toBe('claude-code')
    expect(envelope.meta.env.AGENTS_OBSERVE_PROJECT_SLUG).toBe('my-proj')
    expect(envelope.hook_payload.hook_event_name).toBe('PreToolUse')
  })

  it('flags Notification events with isNotification:true', () => {
    const { envelope } = buildHookEvent(config, makeLog(), { hook_event_name: 'Notification' })
    expect(envelope.meta.isNotification).toBe(true)
    expect(envelope.meta.clearsNotification).toBeUndefined()
  })

  it('flags SubagentStop events with clearsNotification:false', () => {
    const { envelope } = buildHookEvent(config, makeLog(), { hook_event_name: 'SubagentStop' })
    expect(envelope.meta.clearsNotification).toBe(false)
    expect(envelope.meta.isNotification).toBeUndefined()
  })

  it('flags Stop events with clearsNotification:false', () => {
    const { envelope } = buildHookEvent(config, makeLog(), { hook_event_name: 'Stop' })
    expect(envelope.meta.clearsNotification).toBe(false)
  })

  it('leaves ordinary events unflagged (default-clears)', () => {
    const cases = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'SessionEnd']
    for (const hook_event_name of cases) {
      const { envelope } = buildHookEvent(config, makeLog(), { hook_event_name })
      expect(envelope.meta.isNotification).toBeUndefined()
      expect(envelope.meta.clearsNotification).toBeUndefined()
    }
  })

  it('returns hookEvent and toolName for logging', () => {
    const { hookEvent, toolName } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
    })
    expect(hookEvent).toBe('PreToolUse')
    expect(toolName).toBe('Bash')
  })

  describe('notificationOnEvents opt-in/opt-out', () => {
    it('opting Stop into the list flags it as isNotification (overrides non-clearing default)', () => {
      const optIn = { ...config, notificationOnEvents: ['Notification', 'Stop'] }
      const { envelope } = buildHookEvent(optIn, makeLog(), { hook_event_name: 'Stop' })
      expect(envelope.meta.isNotification).toBe(true)
      expect(envelope.meta.clearsNotification).toBeUndefined()
    })

    it('opt-in list still leaves SubagentStop as non-clearing (not configurable)', () => {
      const optIn = { ...config, notificationOnEvents: ['Notification', 'Stop'] }
      const { envelope } = buildHookEvent(optIn, makeLog(), { hook_event_name: 'SubagentStop' })
      expect(envelope.meta.isNotification).toBeUndefined()
      expect(envelope.meta.clearsNotification).toBe(false)
    })

    it('empty list suppresses isNotification on every event', () => {
      const optOut = { ...config, notificationOnEvents: [] }
      const { envelope } = buildHookEvent(optOut, makeLog(), { hook_event_name: 'Notification' })
      expect(envelope.meta.isNotification).toBeUndefined()
    })

    it('empty list still flags Stop / SubagentStop as non-clearing', () => {
      const optOut = { ...config, notificationOnEvents: [] }
      const stop = buildHookEvent(optOut, makeLog(), { hook_event_name: 'Stop' })
      expect(stop.envelope.meta.clearsNotification).toBe(false)
      const subStop = buildHookEvent(optOut, makeLog(), { hook_event_name: 'SubagentStop' })
      expect(subStop.envelope.meta.clearsNotification).toBe(false)
    })

    it('empty list leaves ordinary events unflagged (defaults still clear)', () => {
      const optOut = { ...config, notificationOnEvents: [] }
      const { envelope } = buildHookEvent(optOut, makeLog(), { hook_event_name: 'PreToolUse' })
      expect(envelope.meta.isNotification).toBeUndefined()
      expect(envelope.meta.clearsNotification).toBeUndefined()
    })
  })
})
