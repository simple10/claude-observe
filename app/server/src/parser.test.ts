import { describe, test, expect } from 'vitest'
import { parseRawEvent } from './parser'

// ---------------------------------------------------------------------------
// Transcript JSONL format
// ---------------------------------------------------------------------------
describe('parseRawEvent — transcript JSONL format', () => {
  test('parses user prompt event', () => {
    const raw = {
      project_name: 'my-project',
      session_id: 'sess-123',
      slug: 'twinkly-dragon',
      type: 'user',
      timestamp: '2026-03-25T22:24:17.686Z',
      message: {
        role: 'user',
        content: 'hello world',
      },
      version: '2.1.83',
      gitBranch: 'main',
      cwd: '/Users/joe/project',
      entrypoint: 'cli',
    }

    const result = parseRawEvent(raw)
    expect(result.projectName).toBe('my-project')
    expect(result.sessionId).toBe('sess-123')
    expect(result.slug).toBe('twinkly-dragon')
    expect(result.type).toBe('user')
    expect(result.subtype).toBeNull()
    expect(result.toolName).toBeNull()
    expect(result.timestamp).toBeGreaterThan(0)
    expect(result.metadata.version).toBe('2.1.83')
  })

  test('parses assistant tool_use event with Agent tool', () => {
    const raw = {
      project_name: 'my-project',
      session_id: 'sess-123',
      slug: 'twinkly-dragon',
      type: 'assistant',
      timestamp: '2026-03-25T22:24:25.479Z',
      message: {
        model: 'claude-opus-4-6',
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Agent',
            input: { description: 'List current directory', prompt: 'Run ls...' },
          },
        ],
      },
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('assistant')
    expect(result.toolName).toBe('Agent')
    expect(result.subAgentName).toBeNull()
    expect(result.subAgentDescription).toBe('List current directory')
  })

  test('parses assistant tool_use for non-Agent tool (no subAgentName)', () => {
    const raw = {
      project_name: 'my-project',
      sessionId: 'sess-123',
      type: 'assistant',
      timestamp: '2026-03-25T22:24:25.479Z',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            name: 'Bash',
            input: { command: 'ls -la' },
          },
        ],
      },
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('assistant')
    expect(result.toolName).toBe('Bash')
    expect(result.subAgentName).toBeNull()
  })

  test('parses progress/hook_progress event with subtype', () => {
    const raw = {
      project_name: 'my-project',
      sessionId: 'sess-123',
      type: 'progress',
      data: {
        type: 'hook_progress',
        hookEvent: 'PreToolUse',
        hookName: 'PreToolUse:Agent',
      },
      timestamp: '2026-03-25T22:24:25.482Z',
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('progress')
    expect(result.subtype).toBe('PreToolUse')
    expect(result.toolName).toBe('Agent')
  })

  test('parses hook_progress with hookName lacking colon (no toolName)', () => {
    const raw = {
      project_name: 'my-project',
      sessionId: 'sess-123',
      type: 'progress',
      data: {
        type: 'hook_progress',
        hookEvent: 'Stop',
        hookName: 'Stop',
      },
      timestamp: '2026-03-25T22:24:39.271Z',
    }

    const result = parseRawEvent(raw)
    expect(result.subtype).toBe('Stop')
    expect(result.toolName).toBeNull()
  })

  test('parses agent_progress event and extracts agentId', () => {
    const raw = {
      project_name: 'my-project',
      sessionId: 'sess-123',
      type: 'progress',
      data: {
        type: 'agent_progress',
        agentId: 'ad03a9f1e00dc2c79',
        prompt: 'Run ls in the current directory',
      },
      toolUseID: 'agent_msg_123',
      parentToolUseID: 'toolu_abc',
      timestamp: '2026-03-25T22:24:25.614Z',
    }

    const result = parseRawEvent(raw)
    expect(result.subAgentId).toBe('ad03a9f1e00dc2c79')
    expect(result.type).toBe('progress')
    expect(result.subtype).toBe('agent_progress')
  })

  test('parses agent_progress with nested tool_use extraction', () => {
    const raw = {
      project_name: 'my-project',
      sessionId: 'sess-123',
      type: 'progress',
      data: {
        type: 'agent_progress',
        agentId: 'sub-agent-1',
        message: {
          message: {
            content: [
              { type: 'text', text: 'Let me run that command.' },
              { type: 'tool_use', name: 'Bash', input: { command: 'ls' } },
            ],
          },
        },
      },
      timestamp: 1711411200000,
    }

    const result = parseRawEvent(raw)
    expect(result.subtype).toBe('agent_progress')
    expect(result.subAgentId).toBe('sub-agent-1')
    expect(result.toolName).toBe('Bash')
  })

  test('agent_progress without nested tool_use sets toolName null', () => {
    const raw = {
      project_name: 'my-project',
      sessionId: 'sess-123',
      type: 'progress',
      data: {
        type: 'agent_progress',
        agentId: 'sub-agent-1',
        message: {
          message: {
            content: [{ type: 'text', text: 'just text' }],
          },
        },
      },
      timestamp: 1711411200000,
    }

    const result = parseRawEvent(raw)
    expect(result.toolName).toBeNull()
  })

  test('parses tool_result user event with agentId in toolUseResult', () => {
    const raw = {
      project_name: 'my-project',
      sessionId: 'sess-123',
      type: 'user',
      toolUseResult: {
        status: 'completed',
        agentId: 'ad03a9f1e00dc2c79',
        totalDurationMs: 6308,
        totalTokens: 10071,
      },
      message: {
        role: 'user',
        content: [
          {
            tool_use_id: 'toolu_abc',
            type: 'tool_result',
            content: [{ type: 'text', text: 'result' }],
          },
        ],
      },
      timestamp: '2026-03-25T22:24:31.920Z',
    }

    const result = parseRawEvent(raw)
    expect(result.subAgentId).toBe('ad03a9f1e00dc2c79')
  })

  test('toolUseResult without agentId does not set subAgentId', () => {
    const raw = {
      project_name: 'my-project',
      sessionId: 'sess-123',
      type: 'user',
      toolUseResult: {
        status: 'completed',
      },
      timestamp: 1711411200000,
    }

    const result = parseRawEvent(raw)
    expect(result.subAgentId).toBeNull()
  })

  test('parses Stop system event', () => {
    const raw = {
      project_name: 'my-project',
      sessionId: 'sess-123',
      type: 'system',
      subtype: 'stop_hook_summary',
      timestamp: '2026-03-25T22:24:39.468Z',
      hookCount: 2,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('system')
    expect(result.subtype).toBe('stop_hook_summary')
  })
})

// ---------------------------------------------------------------------------
// Hook format (hook_event_name present)
// ---------------------------------------------------------------------------
describe('parseRawEvent — hook format', () => {
  test('SessionStart', () => {
    const raw = {
      hook_event_name: 'SessionStart',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411200000,
      version: '2.2.0',
      gitBranch: 'feat/hooks',
      cwd: '/home/dev/repo',
      entrypoint: 'cli',
      permissionMode: 'auto',
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('session')
    expect(result.subtype).toBe('SessionStart')
    expect(result.projectName).toBe('hook-proj')
    expect(result.sessionId).toBe('hook-sess-1')
    expect(result.toolName).toBeNull()
    expect(result.subAgentId).toBeNull()
    expect(result.ownerAgentId).toBeNull()
    expect(result.metadata).toEqual({
      version: '2.2.0',
      gitBranch: 'feat/hooks',
      cwd: '/home/dev/repo',
      entrypoint: 'cli',
      permissionMode: 'auto',
    })
  })

  test('UserPromptSubmit', () => {
    const raw = {
      hook_event_name: 'UserPromptSubmit',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411201000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('user')
    expect(result.subtype).toBe('UserPromptSubmit')
  })

  test('PreToolUse with non-Agent tool', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls -la' },
      timestamp: 1711411202000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PreToolUse')
    expect(result.toolName).toBe('Bash')
    expect(result.subAgentName).toBeNull()
  })

  test('PreToolUse with Agent tool extracts name and description from tool_input', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Agent',
      tool_input: { name: 'ls-agent', description: 'Run ls in the repo', prompt: 'List files' },
      timestamp: 1711411202000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PreToolUse')
    expect(result.toolName).toBe('Agent')
    expect(result.subAgentName).toBe('ls-agent')
    expect(result.subAgentDescription).toBe('Run ls in the repo')
    expect(result.subAgentId).toBeNull()
  })

  test('PostToolUse with non-Agent tool', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/test.txt' },
      tool_response: { content: 'file contents' },
      timestamp: 1711411203000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PostToolUse')
    expect(result.toolName).toBe('Read')
    expect(result.subAgentId).toBeNull()
    expect(result.subAgentName).toBeNull()
  })

  test('PostToolUse with Agent tool extracts subAgentId, name, and description', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Agent',
      tool_input: {
        name: 'file-searcher',
        description: 'Search for files',
        prompt: 'Find all .ts files',
      },
      tool_response: { agentId: 'sub-agent-abc', result: 'done' },
      timestamp: 1711411203000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PostToolUse')
    expect(result.toolName).toBe('Agent')
    expect(result.subAgentId).toBe('sub-agent-abc')
    expect(result.subAgentName).toBe('file-searcher')
    expect(result.subAgentDescription).toBe('Search for files')
  })

  test('PostToolUse:Agent without tool_response does not set subAgentId', () => {
    const raw = {
      hook_event_name: 'PostToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Agent',
      tool_input: { description: 'Do something' },
      timestamp: 1711411203000,
    }

    const result = parseRawEvent(raw)
    expect(result.toolName).toBe('Agent')
    expect(result.subAgentId).toBeNull()
    expect(result.subAgentName).toBeNull()
  })

  test('Stop', () => {
    const raw = {
      hook_event_name: 'Stop',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411204000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('system')
    expect(result.subtype).toBe('Stop')
  })

  test('SubagentStop extracts subAgentId from agent_id', () => {
    const raw = {
      hook_event_name: 'SubagentStop',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      agent_id: 'sub-agent-xyz',
      timestamp: 1711411205000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('system')
    expect(result.subtype).toBe('SubagentStop')
    expect(result.subAgentId).toBe('sub-agent-xyz')
    // ownerAgentId is also agent_id (they use the same field)
    expect(result.ownerAgentId).toBe('sub-agent-xyz')
  })

  test('PostToolUseFailure', () => {
    const raw = {
      hook_event_name: 'PostToolUseFailure',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Bash',
      timestamp: 1711411206000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PostToolUseFailure')
    expect(result.toolName).toBe('Bash')
  })

  test('Notification', () => {
    const raw = {
      hook_event_name: 'Notification',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411207000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('system')
    expect(result.subtype).toBe('Notification')
  })

  test('unknown hook event name falls through to default', () => {
    const raw = {
      hook_event_name: 'FutureEvent',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      timestamp: 1711411208000,
    }

    const result = parseRawEvent(raw)
    expect(result.type).toBe('system')
    expect(result.subtype).toBe('FutureEvent')
  })

  test('hook event from subagent has ownerAgentId from agent_id', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      agent_id: 'sub-agent-owner',
      tool_name: 'Bash',
      timestamp: 1711411209000,
    }

    const result = parseRawEvent(raw)
    expect(result.ownerAgentId).toBe('sub-agent-owner')
    expect(result.type).toBe('tool')
    expect(result.subtype).toBe('PreToolUse')
  })

  test('hook event extracts tool_use_id', () => {
    const raw = {
      hook_event_name: 'PreToolUse',
      project_name: 'hook-proj',
      session_id: 'hook-sess-1',
      tool_name: 'Read',
      tool_use_id: 'toolu_12345',
      timestamp: 1711411210000,
    }

    const result = parseRawEvent(raw)
    expect(result.toolUseId).toBe('toolu_12345')
  })

  test('hook event — extracts transcript_path', () => {
    const parsed = parseRawEvent({
      hook_event_name: 'PreToolUse',
      session_id: 'sess-1',
      tool_name: 'Bash',
      tool_input: { command: 'ls' },
      transcript_path: '/Users/joe/.claude/projects/-Users-joe-my-app/sess-1.jsonl',
      timestamp: 1000,
    })
    expect(parsed.transcriptPath).toBe('/Users/joe/.claude/projects/-Users-joe-my-app/sess-1.jsonl')
  })

  test('hook event — transcriptPath is null when not present', () => {
    const parsed = parseRawEvent({
      hook_event_name: 'Stop',
      session_id: 'sess-1',
      timestamp: 1000,
    })
    expect(parsed.transcriptPath).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Common behavior: metadata, timestamp, defaults
// ---------------------------------------------------------------------------
describe('parseRawEvent — common behavior', () => {
  test('extracts all metadata keys when present', () => {
    const raw = {
      hook_event_name: 'SessionStart',
      project_name: 'proj',
      session_id: 'sess',
      timestamp: 1711411200000,
      version: '2.2.0',
      gitBranch: 'main',
      cwd: '/home/user',
      entrypoint: 'cli',
      permissionMode: 'auto',
      userType: 'pro',
      permission_mode: 'auto_accept',
    }

    const result = parseRawEvent(raw)
    expect(result.metadata).toEqual({
      version: '2.2.0',
      gitBranch: 'main',
      cwd: '/home/user',
      entrypoint: 'cli',
      permissionMode: 'auto',
      userType: 'pro',
      permission_mode: 'auto_accept',
    })
  })

  test('metadata is empty when no metadata keys are present', () => {
    const raw = {
      project_name: 'proj',
      session_id: 'sess',
      type: 'user',
      timestamp: 1711411200000,
    }

    const result = parseRawEvent(raw)
    expect(result.metadata).toEqual({})
  })

  test('projectName defaults to null when not present', () => {
    const parsed = parseRawEvent({ hook_event_name: 'Stop', session_id: 'x' })
    expect(parsed.projectName).toBeNull()
  })

  test('defaults sessionId to "unknown" when session_id is absent', () => {
    const raw = { project_name: 'p', type: 'user', timestamp: 1711411200000 }
    const result = parseRawEvent(raw)
    expect(result.sessionId).toBe('unknown')
  })

  test('slug is null when not provided', () => {
    const raw = { project_name: 'p', session_id: 's', type: 'user', timestamp: 1711411200000 }
    const result = parseRawEvent(raw)
    expect(result.slug).toBeNull()
  })

  test('raw is passed through as-is', () => {
    const raw = {
      project_name: 'p',
      session_id: 's',
      type: 'user',
      timestamp: 1711411200000,
      custom_field: 'hello',
    }
    const result = parseRawEvent(raw)
    expect(result.raw).toBe(raw)
  })
})

// ---------------------------------------------------------------------------
// parseTimestamp (exercised through parseRawEvent)
// ---------------------------------------------------------------------------
describe('parseRawEvent — timestamp parsing', () => {
  test('numeric timestamp is used directly', () => {
    const raw = { project_name: 'p', session_id: 's', type: 'user', timestamp: 1711411200000 }
    const result = parseRawEvent(raw)
    expect(result.timestamp).toBe(1711411200000)
  })

  test('ISO string timestamp is converted to epoch ms', () => {
    const raw = {
      project_name: 'p',
      session_id: 's',
      type: 'user',
      timestamp: '2026-03-25T22:24:17.686Z',
    }
    const result = parseRawEvent(raw)
    expect(result.timestamp).toBe(new Date('2026-03-25T22:24:17.686Z').getTime())
  })

  test('invalid string timestamp falls back to Date.now()', () => {
    const now = Date.now()
    const raw = { project_name: 'p', session_id: 's', type: 'user', timestamp: 'not-a-date' }
    const result = parseRawEvent(raw)
    // Should be close to now (within 1 second)
    expect(result.timestamp).toBeGreaterThanOrEqual(now - 1000)
    expect(result.timestamp).toBeLessThanOrEqual(now + 1000)
  })

  test('missing timestamp falls back to Date.now()', () => {
    const now = Date.now()
    const raw = { project_name: 'p', session_id: 's', type: 'user' }
    const result = parseRawEvent(raw)
    expect(result.timestamp).toBeGreaterThanOrEqual(now - 1000)
    expect(result.timestamp).toBeLessThanOrEqual(now + 1000)
  })

  test('null timestamp falls back to Date.now()', () => {
    const now = Date.now()
    const raw = { project_name: 'p', session_id: 's', type: 'user', timestamp: null }
    const result = parseRawEvent(raw)
    expect(result.timestamp).toBeGreaterThanOrEqual(now - 1000)
    expect(result.timestamp).toBeLessThanOrEqual(now + 1000)
  })
})
