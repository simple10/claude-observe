import { describe, test, expect, beforeEach } from 'vitest'
import { SqliteAdapter } from './sqlite-adapter'

let store: SqliteAdapter

beforeEach(() => {
  store = new SqliteAdapter(':memory:')
})

describe('SqliteAdapter', () => {
  test('upsert project and query', async () => {
    await store.upsertProject('test-proj', 'Test Project')
    const projects = await store.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].id).toBe('test-proj')
  })

  test('upsert session with agents and events', async () => {
    await store.upsertProject('proj1', 'Project 1')
    await store.upsertSession('sess1', 'proj1', 'twinkly-dragon', null, Date.now())
    await store.upsertAgent('agent1', 'sess1', null, 'twinkly-dragon', null, Date.now())
    await store.upsertAgent('agent2', 'sess1', 'agent1', null, 'ls-subagent', Date.now())

    const eventId = await store.insertEvent({
      agentId: 'agent1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: Date.now(),
      payload: { test: true },
    })
    expect(eventId).toBeGreaterThan(0)

    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(2)

    const events = await store.getEventsForSession('sess1')
    expect(events).toHaveLength(1)
  })

  test('event filtering by agent', async () => {
    await store.upsertProject('proj1', 'Project 1')
    await store.upsertSession('sess1', 'proj1', null, null, Date.now())
    await store.upsertAgent('a1', 'sess1', null, null, null, Date.now())
    await store.upsertAgent('a2', 'sess1', null, null, null, Date.now())

    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: Date.now(),
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: Date.now(),
      payload: {},
    })

    const filtered = await store.getEventsForSession('sess1', { agentIds: ['a1'] })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].agent_id).toBe('a1')
  })

  test('clearAllData empties all tables', async () => {
    await store.upsertProject('proj1', 'Project 1')
    await store.upsertSession('sess1', 'proj1', null, null, Date.now())
    await store.upsertAgent('a1', 'sess1', null, null, null, Date.now())
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,
      summary: null,
      timestamp: Date.now(),
      payload: {},
    })

    await store.clearAllData()
    const projects = await store.getProjects()
    expect(projects).toHaveLength(0)
  })

  test('deleteSession removes session, agents, and events', async () => {
    await store.upsertProject('proj1', 'Project 1')
    await store.upsertSession('sess1', 'proj1', null, null, Date.now())
    await store.upsertAgent('a1', 'sess1', null, null, null, Date.now())
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub', Date.now())
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: Date.now(),
      payload: {},
    })

    await store.deleteSession('sess1')

    const sessions = await store.getSessionsForProject('proj1')
    expect(sessions).toHaveLength(0)
    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(0)
    const events = await store.getEventsForSession('sess1')
    expect(events).toHaveLength(0)
    // Project should still exist
    const projects = await store.getProjects()
    expect(projects).toHaveLength(1)
  })

  test('clearSessionEvents removes events and agents but keeps the session', async () => {
    await store.upsertProject('proj1', 'Project 1')
    await store.upsertSession('sess1', 'proj1', 'my-session', null, Date.now())
    await store.upsertAgent('a1', 'sess1', null, null, null, Date.now())
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub', Date.now())
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: Date.now(),
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: Date.now(),
      payload: {},
    })

    await store.clearSessionEvents('sess1')

    // Session should remain
    const session = await store.getSessionById('sess1')
    expect(session).not.toBeNull()
    // Events should be gone
    const events = await store.getEventsForSession('sess1')
    expect(events).toHaveLength(0)
    // Agents should also be gone
    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(0)
  })

  test('getEventsSince returns events after timestamp', async () => {
    await store.upsertProject('proj1', 'Project 1')
    await store.upsertSession('sess1', 'proj1', null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null, 1000)

    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,
      summary: null,
      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: 2000,
      payload: {},
    })

    const since = await store.getEventsSince('sess1', 1500)
    expect(since).toHaveLength(1)
    expect(since[0].timestamp).toBe(2000)
  })
})
