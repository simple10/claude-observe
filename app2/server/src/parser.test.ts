import { test, expect } from 'bun:test';
import { parseRawEvent } from './parser';

test('parses user prompt event', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
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
  };

  const result = parseRawEvent(raw);
  expect(result.projectName).toBe('my-project');
  expect(result.sessionId).toBe('sess-123');
  expect(result.slug).toBe('twinkly-dragon');
  expect(result.type).toBe('user');
  expect(result.subtype).toBeNull();
  expect(result.toolName).toBeNull();
  expect(result.summary).toBe('"hello world"');
  expect(result.timestamp).toBeGreaterThan(0);
  expect(result.metadata.version).toBe('2.1.83');
});

test('parses assistant tool_use event', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
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
  };

  const result = parseRawEvent(raw);
  expect(result.type).toBe('assistant');
  expect(result.toolName).toBe('Agent');
  expect(result.summary).toContain('Agent');
  expect(result.summary).toContain('List current directory');
});

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
  };

  const result = parseRawEvent(raw);
  expect(result.type).toBe('progress');
  expect(result.subtype).toBe('PreToolUse');
  expect(result.toolName).toBe('Agent');
});

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
  };

  const result = parseRawEvent(raw);
  expect(result.subAgentId).toBe('ad03a9f1e00dc2c79');
  expect(result.type).toBe('progress');
  expect(result.subtype).toBe('agent_progress');
});

test('parses tool_result user event', () => {
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
      content: [{ tool_use_id: 'toolu_abc', type: 'tool_result', content: [{ type: 'text', text: 'result' }] }],
    },
    timestamp: '2026-03-25T22:24:31.920Z',
  };

  const result = parseRawEvent(raw);
  expect(result.subAgentId).toBe('ad03a9f1e00dc2c79');
  expect(result.summary).toContain('completed');
});

test('parses Stop system event', () => {
  const raw = {
    project_name: 'my-project',
    sessionId: 'sess-123',
    type: 'system',
    subtype: 'stop_hook_summary',
    timestamp: '2026-03-25T22:24:39.468Z',
    hookCount: 2,
  };

  const result = parseRawEvent(raw);
  expect(result.type).toBe('system');
  expect(result.subtype).toBe('stop_hook_summary');
});

test('extracts hook_event subtype from progress events', () => {
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
  };

  const result = parseRawEvent(raw);
  expect(result.subtype).toBe('Stop');
});
