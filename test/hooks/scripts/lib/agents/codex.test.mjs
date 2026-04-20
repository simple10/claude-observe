import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { buildHookEvent, getSessionInfo } from '../../../../../hooks/scripts/lib/agents/codex.mjs'

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
  const dir = join(tmpdir(), `codex-getinfo-${Date.now()}-${Math.random()}`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'transcript.jsonl')
  writeFileSync(path, lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n'))
  return { path, dir }
}

describe('codex.getSessionInfo', () => {
  it('returns null when transcript_path is missing', () => {
    expect(getSessionInfo({}, { log: makeLog() })).toBeNull()
  })

  it('returns null when the transcript file cannot be read', () => {
    const log = makeLog()
    expect(getSessionInfo({ transcript_path: '/no/such/file' }, { log })).toBeNull()
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('cannot read transcript'))
  })

  it('extracts git info from session_meta payload', () => {
    const { path, dir } = writeTranscript([
      {
        type: 'session_meta',
        payload: {
          git: {
            commit_hash: 'abc',
            branch: 'feat/agent-class-support',
            repository_url: 'git@github.com:simple10/agents-observe.git',
          },
        },
      },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: null,
      git: {
        branch: 'feat/agent-class-support',
        repository_url: 'git@github.com:simple10/agents-observe.git',
      },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('also accepts git at the top level as a fallback shape', () => {
    const { path, dir } = writeTranscript([
      { type: 'other' },
      { git: { branch: 'main', repository_url: 'git@ex:r.git' } },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.git).toEqual({ branch: 'main', repository_url: 'git@ex:r.git' })
    rmSync(dir, { recursive: true, force: true })
  })

  it('returns null fields when no git info is present', () => {
    const { path, dir } = writeTranscript([{ type: 'session_meta', payload: {} }])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result).toEqual({
      slug: null,
      git: { branch: null, repository_url: null },
    })
    rmSync(dir, { recursive: true, force: true })
  })

  it('slug is always null for codex', () => {
    const { path, dir } = writeTranscript([
      { payload: { git: { branch: 'x', repository_url: 'y' } } },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.slug).toBeNull()
    rmSync(dir, { recursive: true, force: true })
  })

  it('ignores malformed json lines', () => {
    const { path, dir } = writeTranscript([
      'not json { "git":',
      { payload: { git: { branch: 'ok' } } },
    ])
    const result = getSessionInfo({ transcript_path: path }, { log: makeLog() })
    expect(result.git.branch).toBe('ok')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('codex.buildHookEvent', () => {
  const config = { agentClass: 'codex', projectSlug: 'cdx-proj' }

  it('builds a basic envelope with no notification flags', () => {
    const { envelope, hookEvent, toolName } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'some-codex-event',
      tool_name: 'shell',
    })
    expect(envelope.meta.agentClass).toBe('codex')
    expect(envelope.meta.env.AGENTS_OBSERVE_PROJECT_SLUG).toBe('cdx-proj')
    expect(envelope.meta.isNotification).toBeUndefined()
    expect(envelope.meta.clearsNotification).toBeUndefined()
    expect(hookEvent).toBe('some-codex-event')
    expect(toolName).toBe('shell')
  })

  it('stamps hookName / toolName / sessionId / agentId from payload', () => {
    const { envelope } = buildHookEvent(config, makeLog(), {
      hook_event_name: 'codex-turn-end',
      tool_name: 'shell',
      session_id: 'cdx-sess-1',
      agent_id: 'cdx-sub-1',
    })
    expect(envelope.meta.hookName).toBe('codex-turn-end')
    expect(envelope.meta.toolName).toBe('shell')
    expect(envelope.meta.sessionId).toBe('cdx-sess-1')
    expect(envelope.meta.agentId).toBe('cdx-sub-1')
    // Codex doesn't map type / subtype yet — both stay undefined.
    expect(envelope.meta.type).toBeUndefined()
    expect(envelope.meta.subtype).toBeUndefined()
  })

  describe('notificationOnEvents opt-in', () => {
    it('default config: no events fire isNotification', () => {
      const { envelope } = buildHookEvent(config, makeLog(), { hook_event_name: 'Stop' })
      expect(envelope.meta.isNotification).toBeUndefined()
      // No NON_CLEARING set for Codex — every non-opted-in event clears.
      expect(envelope.meta.clearsNotification).toBeUndefined()
    })

    it('opting Stop into notificationOnEvents fires isNotification on Stop', () => {
      const optIn = { ...config, notificationOnEvents: ['Stop'] }
      const { envelope } = buildHookEvent(optIn, makeLog(), { hook_event_name: 'Stop' })
      expect(envelope.meta.isNotification).toBe(true)
      expect(envelope.meta.clearsNotification).toBeUndefined()
    })

    it('opt-in does not affect non-matching events', () => {
      const optIn = { ...config, notificationOnEvents: ['Stop'] }
      const { envelope } = buildHookEvent(optIn, makeLog(), { hook_event_name: 'some-other-event' })
      expect(envelope.meta.isNotification).toBeUndefined()
    })

    it('empty list suppresses isNotification even for otherwise-default events', () => {
      const optOut = { ...config, notificationOnEvents: [] }
      const { envelope } = buildHookEvent(optOut, makeLog(), { hook_event_name: 'Notification' })
      expect(envelope.meta.isNotification).toBeUndefined()
    })
  })
})
