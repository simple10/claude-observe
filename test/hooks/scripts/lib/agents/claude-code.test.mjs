import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import {
  buildHookEvent,
  buildEnv,
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
  it('returns null when transcriptPath is missing', () => {
    expect(getSessionInfo({}, { log: makeLog() })).toBeNull()
  })

  it('returns null when the transcript file cannot be read', () => {
    const log = makeLog()
    expect(getSessionInfo({ transcriptPath: '/no/such/file' }, { log })).toBeNull()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('cannot read transcript'))
  })

  it('accepts the snake_case transcript_path alias for back-compat', () => {
    const { path, dir } = writeTranscript([{ slug: 'snake', gitBranch: 'main' }])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.slug).toBe('snake')
    rmSync(dir, { recursive: true, force: true })
  })

  it('extracts slug and gitBranch from top-level fields', () => {
    const { path, dir } = writeTranscript([
      { type: 'system' },
      { slug: 'my-session', gitBranch: 'feat/foo', cwd: '/tmp' },
    ])
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
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
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: 'the-slug',
      git: { branch: 'main', repository_url: null },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null fields when neither appears in the transcript', () => {
    const { path, dir } = writeTranscript([{ type: 'system' }, { type: 'user' }])
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
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
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
    expect(result.slug).toBe('real-slug')
    expect(result.git.branch).toBe('real-branch')
    rmSync(dir, { recursive: true, force: true })
  })

  it('ignores empty-string values', () => {
    const { path, dir } = writeTranscript([{ slug: '', gitBranch: '' }, { slug: 'ok' }])
    const result = getSessionInfo({ transcriptPath: path }, { log: makeLog() })
    expect(result.slug).toBe('ok')
    expect(result.git.branch).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('claude-code.buildHookEvent', () => {
  const config = { agentClass: 'claude-code', projectSlug: 'my-proj' }

  it('stamps agentClass and lifts identity to the new envelope shape', () => {
    const { envelope } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'Bash',
    })
    expect(envelope.agentClass).toBe('claude-code')
    expect(envelope.sessionId).toBe('sess-1')
    expect(envelope.agentId).toBe('sess-1') // defaulted from sessionId
    expect(envelope.hookName).toBe('PreToolUse')
    expect(envelope.payload.hook_event_name).toBe('PreToolUse')
    expect(envelope._meta?.project?.slug).toBe('my-proj')
  })

  it('flags Notification events with startsNotification:true', () => {
    const { envelope } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'Notification',
      session_id: 'sess-1',
    })
    expect(envelope.flags?.startsNotification).toBe(true)
    expect(envelope.flags?.clearsNotification).toBeUndefined()
  })

  it('flags UserPromptSubmit with clearsNotification:true', () => {
    const { envelope } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-1',
    })
    expect(envelope.flags?.clearsNotification).toBe(true)
    expect(envelope.flags?.stopsSession).toBeUndefined()
  })

  it('flags SessionEnd with stopsSession:true', () => {
    const { envelope } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'SessionEnd',
      session_id: 'sess-1',
    })
    expect(envelope.flags?.stopsSession).toBe(true)
  })

  it('flags SessionStart with resolveProject:true', () => {
    const { envelope } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'SessionStart',
      session_id: 'sess-1',
    })
    expect(envelope.flags?.resolveProject).toBe(true)
  })

  it('leaves ordinary events with no flags object', () => {
    const cases = ['PreToolUse', 'PostToolUse', 'Stop', 'SubagentStop']
    for (const hook_event_name of cases) {
      const { envelope } = buildHookEvent(config, makeLog(), {
        hook_event_name,
        session_id: 'sess-1',
      })
      expect(envelope.flags).toBeUndefined()
    }
  })

  it('returns hookEvent and toolName for logging', () => {
    const { hookEvent, toolName } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'Bash',
    })
    expect(hookEvent).toBe('PreToolUse')
    expect(toolName).toBe('Bash')
  })

  describe('identity lifting (sessionId / agentId / cwd / transcriptPath)', () => {
    it('lifts agent_id from payload for subagent events', () => {
      const { envelope } = buildHookEvent(config, makeLog(), {
        hook_event_name: 'SubagentStop',
        session_id: 'sess-1',
        agent_id: 'sub-uuid-42',
      })
      expect(envelope.agentId).toBe('sub-uuid-42')
    })

    it('defaults agentId to sessionId for main-agent events', () => {
      const { envelope } = buildHookEvent(config, makeLog(), {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'sess-1',
      })
      expect(envelope.agentId).toBe('sess-1')
    })

    it('lifts cwd to envelope.cwd and _meta.session.startCwd', () => {
      const { envelope } = buildHookEvent(config, makeLog(), {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-1',
        cwd: '/Users/joe/repo',
      })
      expect(envelope.cwd).toBe('/Users/joe/repo')
      expect(envelope._meta?.session?.startCwd).toBe('/Users/joe/repo')
    })

    it('lifts transcript_path to _meta.session.transcriptPath', () => {
      const { envelope } = buildHookEvent(config, makeLog(), {
        hook_event_name: 'SessionStart',
        session_id: 'sess-1',
        transcript_path: '/path/to/sess-1.jsonl',
      })
      expect(envelope._meta?.session?.transcriptPath).toBe('/path/to/sess-1.jsonl')
    })

    it('does NOT mutate the input payload', () => {
      const payload = {
        hook_event_name: 'PreToolUse',
        session_id: 'sess-1',
        tool_name: 'Bash',
        cwd: '/x',
      }
      const snapshot = JSON.parse(JSON.stringify(payload))
      buildHookEvent(config, makeLog(), payload)
      expect(payload).toEqual(snapshot)
    })
  })

  describe('notificationOnEvents opt-in/opt-out', () => {
    it('opting Stop into the list flags it as startsNotification', () => {
      const optIn = { ...config, notificationOnEvents: ['Notification', 'Stop'] }
      const { envelope } = buildHookEvent(optIn, makeLog(), {
        hook_event_name: 'Stop',
        session_id: 'sess-1',
      })
      expect(envelope.flags?.startsNotification).toBe(true)
    })

    it('UserPromptSubmit still gets clearsNotification even with custom opt-in list', () => {
      const optIn = { ...config, notificationOnEvents: ['Stop'] }
      const { envelope } = buildHookEvent(optIn, makeLog(), {
        hook_event_name: 'UserPromptSubmit',
        session_id: 'sess-1',
      })
      expect(envelope.flags?.clearsNotification).toBe(true)
    })

    it('empty list suppresses startsNotification on Notification events', () => {
      const optOut = { ...config, notificationOnEvents: [] }
      const { envelope } = buildHookEvent(optOut, makeLog(), {
        hook_event_name: 'Notification',
        session_id: 'sess-1',
      })
      expect(envelope.flags?.startsNotification).toBeUndefined()
    })
  })
})

describe('claude-code.buildEnv', () => {
  it('mirrors the default lib buildEnv', () => {
    expect(buildEnv({ projectSlug: 'p' })).toEqual({ AGENTS_OBSERVE_PROJECT_SLUG: 'p' })
    expect(buildEnv({})).toEqual({})
  })
})
