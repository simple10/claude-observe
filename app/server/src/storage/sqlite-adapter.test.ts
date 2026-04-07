import { describe, test, expect, beforeEach } from 'vitest'
import { SqliteAdapter } from './sqlite-adapter'

let store: SqliteAdapter

beforeEach(() => {
  store = new SqliteAdapter(':memory:')
})

// ---------------------------------------------------------------------------
// Helper: seed a minimal project + session + agent
// ---------------------------------------------------------------------------
async function seedBasic() {
  const projectId = await store.createProject('proj1', 'Project 1', '/path/proj1')
  await store.upsertSession('sess1', projectId, 'my-session', null, 1000)
  await store.upsertAgent('a1', 'sess1', null, null, null)
  return { projectId, sessionId: 'sess1', rootAgentId: 'a1' }
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
describe('SqliteAdapter — projects', () => {
  test('createProject returns an integer id', async () => {
    const id = await store.createProject('my-project', 'My Project', null)
    expect(typeof id).toBe('number')
    expect(id).toBeGreaterThan(0)
  })

  test('createProject stores slug, name, and transcript_path', async () => {
    const id = await store.createProject('my-project', 'My Project', '/path/to/transcript')
    const project = await store.getProjectBySlug('my-project')
    expect(project).not.toBeNull()
    expect(project.id).toBe(id)
    expect(project.slug).toBe('my-project')
    expect(project.name).toBe('My Project')
    expect(project.transcript_path).toBe('/path/to/transcript')
  })

  test('createProject with null transcript_path', async () => {
    await store.createProject('no-transcript', 'No Transcript', null)
    const project = await store.getProjectBySlug('no-transcript')
    expect(project.transcript_path).toBeNull()
  })

  test('getProjectBySlug returns null for unknown slug', async () => {
    const project = await store.getProjectBySlug('does-not-exist')
    expect(project).toBeNull()
  })

  test('getProjectByTranscriptPath finds project by path', async () => {
    const id = await store.createProject('proj-a', 'Project A', '/transcripts/proj-a')
    const project = await store.getProjectByTranscriptPath('/transcripts/proj-a')
    expect(project).not.toBeNull()
    expect(project.id).toBe(id)
    expect(project.slug).toBe('proj-a')
  })

  test('getProjectByTranscriptPath returns null when no match', async () => {
    const project = await store.getProjectByTranscriptPath('/no/such/path')
    expect(project).toBeNull()
  })

  test('updateProjectName changes the name', async () => {
    const id = await store.createProject('proj1', 'Original Name', null)
    await store.updateProjectName(id, 'Updated Name')
    const project = await store.getProjectBySlug('proj1')
    expect(project.name).toBe('Updated Name')
  })

  test('updateProjectName can be updated multiple times', async () => {
    const id = await store.createProject('proj1', 'First', null)
    await store.updateProjectName(id, 'Second')
    await store.updateProjectName(id, 'Third')
    const project = await store.getProjectBySlug('proj1')
    expect(project.name).toBe('Third')
  })

  test('isSlugAvailable returns true for unused slug', async () => {
    const available = await store.isSlugAvailable('brand-new-slug')
    expect(available).toBe(true)
  })

  test('isSlugAvailable returns false after createProject with that slug', async () => {
    await store.createProject('taken-slug', 'Some Project', null)
    const available = await store.isSlugAvailable('taken-slug')
    expect(available).toBe(false)
  })

  test('getProjects returns session_count', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    const projects = await store.getProjects()
    expect(projects[0].session_count).toBe(2)
  })

  test('getProjects returns slug and name fields', async () => {
    await store.createProject('test-proj', 'Test Project', null)
    const projects = await store.getProjects()
    expect(projects).toHaveLength(1)
    expect(projects[0].slug).toBe('test-proj')
    expect(projects[0].name).toBe('Test Project')
  })

  test('getRecentSessions includes project_slug and project_name', async () => {
    const projId = await store.createProject('proj1', 'Project One', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    const recent = await store.getRecentSessions()
    expect(recent).toHaveLength(1)
    expect(recent[0].project_slug).toBe('proj1')
    expect(recent[0].project_name).toBe('Project One')
  })
})

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------
describe('SqliteAdapter — sessions', () => {
  test('upsert session with slug and metadata', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, 'twinkly-dragon', { version: '2.1' }, 1000)
    const session = await store.getSessionById('sess1')
    expect(session).not.toBeNull()
    expect(session.slug).toBe('twinkly-dragon')
    expect(JSON.parse(session.metadata)).toEqual({ version: '2.1' })
    expect(session.status).toBe('active')
  })

  test('upsert session updates slug via COALESCE', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess1', projId, 'new-slug', null, 1000)
    const session = await store.getSessionById('sess1')
    expect(session.slug).toBe('new-slug')
  })

  test('getSessionsForProject returns aggregated counts', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')
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

    const sessions = await store.getSessionsForProject(projId)
    expect(sessions).toHaveLength(1)
    expect(sessions[0].agent_count).toBe(2)
    expect(sessions[0].event_count).toBe(1)
  })

  test('getSessionById returns null for non-existent session', async () => {
    const session = await store.getSessionById('no-such-session')
    expect(session).toBeNull()
  })

  test('updateSessionStatus sets status and stopped_at for "stopped"', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)

    await store.updateSessionStatus('sess1', 'stopped')
    const session = await store.getSessionById('sess1')
    expect(session.status).toBe('stopped')
    expect(session.stopped_at).toBeGreaterThan(0)
  })

  test('updateSessionStatus with non-stopped status sets stopped_at to null', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)

    await store.updateSessionStatus('sess1', 'active')
    const session = await store.getSessionById('sess1')
    expect(session.status).toBe('active')
    expect(session.stopped_at).toBeNull()
  })

  test('updateSessionSlug', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, 'old-slug', null, 1000)

    await store.updateSessionSlug('sess1', 'new-slug')
    const session = await store.getSessionById('sess1')
    expect(session.slug).toBe('new-slug')
  })

  test('upsertSession stores and preserves transcript_path', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000, '/path/to/session.jsonl')

    const session = await store.getSessionById('sess1')
    expect(session.transcript_path).toBe('/path/to/session.jsonl')

    // Re-upsert without transcript_path should preserve it
    await store.upsertSession('sess1', projId, null, null, 2000)
    const session2 = await store.getSessionById('sess1')
    expect(session2.transcript_path).toBe('/path/to/session.jsonl')
  })

  test('upsertSession backfills transcript_path on later event', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)

    const session = await store.getSessionById('sess1')
    expect(session.transcript_path).toBeNull()

    // Later event provides transcript_path
    await store.upsertSession('sess1', projId, null, null, 2000, '/path/to/session.jsonl')
    const session2 = await store.getSessionById('sess1')
    expect(session2.transcript_path).toBe('/path/to/session.jsonl')
  })

  test('updateSessionProject moves session to a different project', async () => {
    const proj1 = await store.createProject('proj1', 'Project 1', null)
    const proj2 = await store.createProject('proj2', 'Project 2', null)
    await store.upsertSession('sess1', proj1, null, null, 1000)

    await store.updateSessionProject('sess1', proj2)
    const session = await store.getSessionById('sess1')
    expect(session.project_id).toBe(proj2)
  })
})

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------
describe('SqliteAdapter — agents', () => {
  test('upsert agent with parent, name, and description', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, 'root', null)
    await store.upsertAgent('a2', 'sess1', 'a1', 'ls-agent', 'List files in directory')

    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(2)
    const sub = agents.find((a: any) => a.id === 'a2')
    expect(sub.parent_agent_id).toBe('a1')
    expect(sub.name).toBe('ls-agent')
    expect(sub.description).toBe('List files in directory')
  })

  test('upsertAgent with agentType', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null, 'code-writer')

    const agent = await store.getAgentById('a1')
    expect(agent).not.toBeNull()
    expect(agent.agent_type).toBe('code-writer')
  })

  test('upsertAgent updates agent_type via COALESCE on conflict', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    expect((await store.getAgentById('a1')).agent_type).toBeNull()

    await store.upsertAgent('a1', 'sess1', null, null, null, 'researcher')
    expect((await store.getAgentById('a1')).agent_type).toBe('researcher')
  })

  test('getAgentById returns null for non-existent agent', async () => {
    const agent = await store.getAgentById('no-such-agent')
    expect(agent).toBeNull()
  })

  test('getAgentById returns a single agent', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, 'my-agent', 'my-description')

    const agent = await store.getAgentById('a1')
    expect(agent.id).toBe('a1')
    expect(agent.session_id).toBe('sess1')
    expect(agent.name).toBe('my-agent')
    expect(agent.description).toBe('my-description')
  })

  test('updateAgentName', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, 'old-name', null)

    await store.updateAgentName('a1', 'new-name')
    const agent = await store.getAgentById('a1')
    expect(agent.name).toBe('new-name')
  })

  test('updateAgentType', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)

    await store.updateAgentType('a1', 'debugger')
    const agent = await store.getAgentById('a1')
    expect(agent.agent_type).toBe('debugger')
  })

  test('getAgentsForSession returns agents', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
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

    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// Events — insert and query
// ---------------------------------------------------------------------------
describe('SqliteAdapter — events', () => {
  test('insertEvent returns auto-incremented id', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    const id1 = await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: 1000,
      payload: { text: 'hello' },
    })
    const id2 = await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: 2000,
      payload: {},
    })
    expect(id1).toBeGreaterThan(0)
    expect(id2).toBe(id1 + 1)
  })

  test('insertEvent with toolUseId and status', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Read',
      summary: null,
      timestamp: 1000,
      payload: {},
      toolUseId: 'toolu_abc123',
      status: 'success',
    })

    const events = await store.getEventsForSession(sessionId)
    expect(events).toHaveLength(1)
    expect(events[0].tool_use_id).toBe('toolu_abc123')
    expect(events[0].status).toBe('success')
  })

  test('insertEvent defaults status to "pending"', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'user',
      subtype: null,
      toolName: null,
      summary: null,
      timestamp: 1000,
      payload: {},
    })

    const events = await store.getEventsForSession(sessionId)
    expect(events[0].status).toBe('pending')
  })

  test('getEventsForAgent returns only that agent events', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')

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
      agentId: 'a2',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: 2000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,
      summary: null,
      timestamp: 3000,
      payload: {},
    })

    const a1Events = await store.getEventsForAgent('a1')
    expect(a1Events).toHaveLength(2)
    expect(a1Events.every((e) => e.agent_id === 'a1')).toBe(true)
    // Ordered by timestamp ASC
    expect(a1Events[0].timestamp).toBeLessThanOrEqual(a1Events[1].timestamp)

    const a2Events = await store.getEventsForAgent('a2')
    expect(a2Events).toHaveLength(1)
    expect(a2Events[0].agent_id).toBe('a2')
  })

  test('getEventsSince returns events after timestamp', async () => {
    const { sessionId, rootAgentId } = await seedBasic()
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'user',
      subtype: null,
      toolName: null,
      summary: null,
      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: rootAgentId,
      sessionId,
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: 2000,
      payload: {},
    })

    const since = await store.getEventsSince(sessionId, 1500)
    expect(since).toHaveLength(1)
    expect(since[0].timestamp).toBe(2000)
  })
})

// ---------------------------------------------------------------------------
// Event filtering (getEventsForSession)
// ---------------------------------------------------------------------------
describe('SqliteAdapter — event filtering', () => {
  async function seedWithMixedEvents() {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')

    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: 'User asked a question',
      timestamp: 1000,
      payload: { text: 'hello world' },
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: 'Running ls command',
      timestamp: 2000,
      payload: { command: 'ls -la' },
    })
    await store.insertEvent({
      agentId: 'a2',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PostToolUse',
      toolName: 'Read',
      summary: 'Read file contents',
      timestamp: 3000,
      payload: { file: '/tmp/test.txt' },
    })
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,
      summary: null,
      timestamp: 4000,
      payload: {},
    })
  }

  test('filter by agentIds', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { agentIds: ['a1'] })
    expect(filtered).toHaveLength(3)
    expect(filtered.every((e) => e.agent_id === 'a1')).toBe(true)
  })

  test('filter by multiple agentIds', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { agentIds: ['a1', 'a2'] })
    expect(filtered).toHaveLength(4)
  })

  test('filter by type', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { type: 'tool' })
    expect(filtered).toHaveLength(2)
    expect(filtered.every((e) => e.type === 'tool')).toBe(true)
  })

  test('filter by subtype', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { subtype: 'PreToolUse' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].subtype).toBe('PreToolUse')
  })

  test('filter by search (matches summary)', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { search: 'question' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].summary).toContain('question')
  })

  test('filter by search (matches payload)', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { search: 'hello world' })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].type).toBe('user')
  })

  test('filter with limit', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { limit: 2 })
    expect(filtered).toHaveLength(2)
    // Should be first 2 by timestamp ASC
    expect(filtered[0].timestamp).toBe(1000)
    expect(filtered[1].timestamp).toBe(2000)
  })

  test('filter with limit and offset', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', { limit: 2, offset: 1 })
    expect(filtered).toHaveLength(2)
    // Skips first, takes next 2
    expect(filtered[0].timestamp).toBe(2000)
    expect(filtered[1].timestamp).toBe(3000)
  })

  test('combined filters: type + agentIds', async () => {
    await seedWithMixedEvents()
    const filtered = await store.getEventsForSession('sess1', {
      type: 'tool',
      agentIds: ['a1'],
    })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].tool_name).toBe('Bash')
  })

  test('offset without limit is ignored (no OFFSET without LIMIT)', async () => {
    await seedWithMixedEvents()
    // offset alone should not crash; code only adds OFFSET if limit is set
    const filtered = await store.getEventsForSession('sess1', { offset: 2 })
    expect(filtered).toHaveLength(4) // all events returned
  })
})

// ---------------------------------------------------------------------------
// getThreadForEvent
// ---------------------------------------------------------------------------
describe('SqliteAdapter — getThreadForEvent', () => {
  test('returns empty array for non-existent event', async () => {
    const thread = await store.getThreadForEvent(999)
    expect(thread).toEqual([])
  })

  test('subagent event: returns all events for that agent', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    // Root agent has same id as session
    await store.upsertAgent('sess1', 'sess1', null, null, null)
    await store.upsertAgent('sub1', 'sess1', 'sess1', null, 'sub')

    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: 1000,
      payload: {},
    })
    const subEvent1Id = await store.insertEvent({
      agentId: 'sub1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: 2000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sub1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PostToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: 3000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,
      summary: null,
      timestamp: 4000,
      payload: {},
    })

    // Query thread for a subagent event — should get all sub1 events only
    const thread = await store.getThreadForEvent(subEvent1Id)
    expect(thread).toHaveLength(2)
    expect(thread.every((e) => e.agent_id === 'sub1')).toBe(true)
  })

  test('SubagentStop event: returns all events for that agent', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('sess1', 'sess1', null, null, null)
    await store.upsertAgent('sub1', 'sess1', 'sess1', null, 'sub')

    await store.insertEvent({
      agentId: 'sub1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: 1000,
      payload: {},
    })
    // SubagentStop is on root agent but tagged with SubagentStop subtype
    const stopId = await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'SubagentStop',
      toolName: null,
      summary: null,
      timestamp: 2000,
      payload: {},
    })

    // SubagentStop on root agent — code checks subtype === 'SubagentStop' first
    // agentId === sessionId so isSubagent is false, but SubagentStop branch triggers
    // returns all events for that agent (sess1)
    const thread = await store.getThreadForEvent(stopId)
    // agent_id is 'sess1' which equals session_id, so isSubagent = false
    // But subtype is 'SubagentStop', so it takes the subagent branch
    // Returns all events where agent_id = 'sess1'
    expect(thread).toHaveLength(1) // only the SubagentStop event itself belongs to agent sess1
    expect(thread[0].subtype).toBe('SubagentStop')
  })

  test('root agent event: returns turn between UserPromptSubmit and Stop', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    // Turn 1
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: 1000,
      payload: {},
    })
    const toolEventId = await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: 2000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,
      summary: null,
      timestamp: 3000,
      payload: {},
    })

    // Turn 2
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: 4000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,
      summary: null,
      timestamp: 5000,
      payload: {},
    })

    // Query thread for the tool event in turn 1
    const thread = await store.getThreadForEvent(toolEventId)
    // Turn boundary: from UserPromptSubmit(1000) through Stop(3000)
    expect(thread.length).toBeGreaterThanOrEqual(2)
    expect(thread.length).toBeLessThanOrEqual(3) // Prompt, Tool, Stop
    // All events should be within turn 1 timestamps
    for (const e of thread) {
      expect(e.timestamp).toBeGreaterThanOrEqual(1000)
      expect(e.timestamp).toBeLessThanOrEqual(3000)
    }
  })

  test('root agent event with no subsequent boundary returns all remaining events', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: 1000,
      payload: {},
    })
    const toolId = await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Read',
      summary: null,
      timestamp: 2000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PostToolUse',
      toolName: 'Read',
      summary: null,
      timestamp: 3000,
      payload: {},
    })
    // No Stop event — session still active

    const thread = await store.getThreadForEvent(toolId)
    // endTs is Infinity path: returns all events from startTs onward
    expect(thread).toHaveLength(3)
  })

  test('root agent event with no preceding UserPromptSubmit uses startTs=0', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 500)
    await store.upsertAgent('sess1', 'sess1', null, null, null)

    // No UserPromptSubmit, just a tool event
    const toolId = await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'tool',
      subtype: 'PreToolUse',
      toolName: 'Bash',
      summary: null,
      timestamp: 1000,
      payload: {},
    })
    await store.insertEvent({
      agentId: 'sess1',
      sessionId: 'sess1',
      type: 'system',
      subtype: 'Stop',
      toolName: null,
      summary: null,
      timestamp: 2000,
      payload: {},
    })

    const thread = await store.getThreadForEvent(toolId)
    // startTs = 0 (no previous prompt), endTs = 2000 (Stop)
    expect(thread).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// getRecentSessions
// ---------------------------------------------------------------------------
describe('SqliteAdapter — getRecentSessions', () => {
  test('returns sessions ordered by last activity descending', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, 'first', null, 1000)
    await store.upsertSession('sess2', projId, 'second', null, 2000)

    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess2', null, null, null)

    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: null,
      toolName: null,
      summary: null,
      timestamp: 5000, // more recent activity
      payload: {},
    })
    await store.insertEvent({
      agentId: 'a2',
      sessionId: 'sess2',
      type: 'user',
      subtype: null,
      toolName: null,
      summary: null,
      timestamp: 3000,
      payload: {},
    })

    const recent = await store.getRecentSessions(10)
    expect(recent).toHaveLength(2)
    // sess1 has more recent last_activity (5000)
    expect(recent[0].id).toBe('sess1')
    expect(recent[1].id).toBe('sess2')
    expect(recent[0].project_name).toBe('Project 1')
    expect(recent[0].last_activity).toBe(5000)
  })

  test('respects limit parameter', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertSession('sess3', projId, null, null, 3000)

    const recent = await store.getRecentSessions(2)
    expect(recent).toHaveLength(2)
  })

  test('returns aggregated counts', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')

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

    const recent = await store.getRecentSessions()
    expect(recent).toHaveLength(1)
    expect(recent[0].agent_count).toBe(2)
    expect(recent[0].event_count).toBe(1)
  })

  test('session without events uses started_at for ordering', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess-no-events', projId, null, null, 9000)
    await store.upsertSession('sess-with-events', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess-with-events', null, null, null)
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess-with-events',
      type: 'user',
      subtype: null,
      toolName: null,
      summary: null,
      timestamp: 5000,
      payload: {},
    })

    const recent = await store.getRecentSessions()
    expect(recent).toHaveLength(2)
    // sess-no-events has COALESCE(NULL, 9000) = 9000
    // sess-with-events has COALESCE(5000, 1000) = 5000
    expect(recent[0].id).toBe('sess-no-events')
    expect(recent[1].id).toBe('sess-with-events')
  })
})

// ---------------------------------------------------------------------------
// Deletion
// ---------------------------------------------------------------------------
describe('SqliteAdapter — deletion', () => {
  test('deleteSession removes session, agents, and events but keeps project', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess1', 'a1', null, 'sub')
    await store.insertEvent({
      agentId: 'a1',
      sessionId: 'sess1',
      type: 'user',
      subtype: 'UserPromptSubmit',
      toolName: null,
      summary: null,
      timestamp: 1000,
      payload: {},
    })

    await store.deleteSession('sess1')

    const sessions = await store.getSessionsForProject(projId)
    expect(sessions).toHaveLength(0)
    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(0)
    const events = await store.getEventsForSession('sess1')
    expect(events).toHaveLength(0)
    const projects = await store.getProjects()
    expect(projects).toHaveLength(1)
  })

  test('deleteProject cascades through sessions, agents, and events', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertSession('sess2', projId, null, null, 2000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
    await store.upsertAgent('a2', 'sess2', null, null, null)
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
      agentId: 'a2',
      sessionId: 'sess2',
      type: 'user',
      subtype: null,
      toolName: null,
      summary: null,
      timestamp: 2000,
      payload: {},
    })

    await store.deleteProject(projId)

    const projects = await store.getProjects()
    expect(projects).toHaveLength(0)
    const sessions = await store.getSessionsForProject(projId)
    expect(sessions).toHaveLength(0)
    const events1 = await store.getEventsForSession('sess1')
    expect(events1).toHaveLength(0)
    const events2 = await store.getEventsForSession('sess2')
    expect(events2).toHaveLength(0)
    const agents1 = await store.getAgentsForSession('sess1')
    expect(agents1).toHaveLength(0)
    const agents2 = await store.getAgentsForSession('sess2')
    expect(agents2).toHaveLength(0)
  })

  test('deleteProject with no sessions is a no-op beyond removing the project', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.deleteProject(projId)
    const projects = await store.getProjects()
    expect(projects).toHaveLength(0)
  })

  test('clearAllData empties all tables', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, null, null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
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

    await store.clearAllData()
    const projects = await store.getProjects()
    expect(projects).toHaveLength(0)
  })

  test('clearSessionEvents removes events and agents but keeps the session', async () => {
    const projId = await store.createProject('proj1', 'Project 1', null)
    await store.upsertSession('sess1', projId, 'my-session', null, 1000)
    await store.upsertAgent('a1', 'sess1', null, null, null)
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

    await store.clearSessionEvents('sess1')

    const session = await store.getSessionById('sess1')
    expect(session).not.toBeNull()
    expect(session.slug).toBe('my-session')
    const events = await store.getEventsForSession('sess1')
    expect(events).toHaveLength(0)
    const agents = await store.getAgentsForSession('sess1')
    expect(agents).toHaveLength(0)
  })
})
