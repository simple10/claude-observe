import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { EventStream } from './event-stream'
import { useUIStore } from '@/stores/ui-store'
import type { ParsedEvent, Agent } from '@/types'

// ── Mock hooks ──────────────────────────────────────────────

const mockEvents: ParsedEvent[] = []
const mockAgents: Agent[] = []

vi.mock('@/hooks/use-events', () => ({
  useEvents: () => ({ data: mockEvents }),
}))

vi.mock('@/hooks/use-agents', () => ({
  useAgents: () => ({ data: mockAgents }),
}))

// Mock api-client to prevent real fetch calls
vi.mock('@/lib/api-client', () => ({
  api: {
    updateAgentMetadata: vi.fn(() => Promise.resolve()),
    getThread: vi.fn(() => Promise.resolve([])),
    getEvents: vi.fn(() => Promise.resolve([])),
    getAgents: vi.fn(() => Promise.resolve([])),
  },
}))

// Mock timeago.js to return stable strings
vi.mock('timeago.js', () => ({
  format: () => 'just now',
}))

function setMockEvents(events: ParsedEvent[]) {
  mockEvents.length = 0
  mockEvents.push(...events)
}

function setMockAgents(agents: Agent[]) {
  mockAgents.length = 0
  mockAgents.push(...agents)
}

function makeEvent(overrides: Partial<ParsedEvent>): ParsedEvent {
  return {
    id: 1,
    agentId: 'agent-1',
    sessionId: 'sess-1',
    type: 'hook',
    subtype: null,
    toolName: null,
    toolUseId: null,
    status: 'pending',
    timestamp: Date.now(),
    payload: {},
    ...overrides,
  }
}

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: 'agent-1',
    sessionId: 'sess-1',
    parentAgentId: null,
    slug: null,
    name: null,
    status: 'active',
    startedAt: Date.now(),
    stoppedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  setMockEvents([])
  setMockAgents([])

  // Reset UI store
  useUIStore.setState({
    selectedProjectId: 1,
    selectedSessionId: 'sess-1',
    selectedAgentIds: [],
    activeStaticFilters: [],
    activeToolFilters: [],
    searchQuery: '',
    autoFollow: true,
    expandedEventIds: new Set(),
    expandAllCounter: 0,
    selectedEventId: null,
    scrollToEventId: null,
    sessionFilterStates: new Map(),
  })
})

describe('EventStream', () => {
  it('should show "Select a project" when no session selected', () => {
    useUIStore.setState({ selectedSessionId: null })
    renderWithProviders(<EventStream />)
    expect(screen.getByText('Select a project to view events')).toBeInTheDocument()
  })

  it('should show "No events yet" when session selected but no events', () => {
    setMockEvents([])
    renderWithProviders(<EventStream />)
    expect(screen.getByText('No events yet')).toBeInTheDocument()
  })

  it('should render events when available', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Fix the bug' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'SessionStart',
        payload: { source: 'cli' },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderWithProviders(<EventStream />)

    // Should show event count
    expect(screen.getByText('2')).toBeInTheDocument()
    // Should show event summaries
    expect(screen.getByText('Fix the bug')).toBeInTheDocument()
    expect(screen.getByText('Session cli')).toBeInTheDocument()
  })

  // ── PreToolUse + PostToolUse deduplication ────────────────

  it('should merge PreToolUse + PostToolUse into a single row', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'Bash',
        toolUseId: 'tu-1',
        status: 'pending',
        payload: { tool_input: { command: 'ls' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PostToolUse',
        toolName: 'Bash',
        toolUseId: 'tu-1',
        status: 'completed',
        payload: { tool_input: { command: 'ls' }, tool_response: { stdout: 'files' } },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderWithProviders(<EventStream />)

    // Should show only 1 event (merged), not 2
    expect(screen.getByText('1')).toBeInTheDocument()
    // The tool name should appear
    const bashElements = screen.getAllByText('Bash')
    expect(bashElements.length).toBeGreaterThan(0)
  })

  it('should show merged PreToolUse + PostToolUseFailure as failed status', () => {
    // When merged, the event keeps subtype='PreToolUse' but gets status='failed'.
    // The payload is replaced with PostToolUseFailure's payload.
    // The event row detects failure via status, not subtype.
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'Bash',
        toolUseId: 'tu-fail',
        status: 'pending',
        payload: { tool_input: { command: 'bad-cmd' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PostToolUseFailure',
        toolName: 'Bash',
        toolUseId: 'tu-fail',
        status: 'failed',
        payload: { error: 'Command not found', tool_input: { command: 'bad-cmd' } },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderWithProviders(<EventStream />)

    // Should show 1 merged event (not 2)
    expect(screen.getByText('1')).toBeInTheDocument()
    // The merged row keeps subtype PreToolUse so summary uses tool_input from PostToolUseFailure payload
    expect(screen.getByText('bad-cmd')).toBeInTheDocument()
  })

  it('should NOT merge events with different toolUseIds', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'Bash',
        toolUseId: 'tu-1',
        payload: { tool_input: { command: 'ls' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PreToolUse',
        toolName: 'Read',
        toolUseId: 'tu-2',
        payload: { tool_input: { file_path: '/tmp/f.txt' } },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderWithProviders(<EventStream />)

    // Should show 2 events (no merge)
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  // ── Agent filtering ───────────────────────────────────────

  it('should filter events by selected agent IDs', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        agentId: 'agent-1',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Agent 1 prompt' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        agentId: 'agent-2',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Agent 2 prompt' },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([
      makeAgent({ id: 'agent-1' }),
      makeAgent({ id: 'agent-2', parentAgentId: 'agent-1' }),
    ])

    // Select only agent-1
    useUIStore.setState({ selectedAgentIds: ['agent-1'] })

    renderWithProviders(<EventStream />)

    expect(screen.getByText('Agent 1 prompt')).toBeInTheDocument()
    expect(screen.queryByText('Agent 2 prompt')).not.toBeInTheDocument()
  })

  // ── Static/tool filter application ────────────────────────

  it('should apply static filters to events', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'My prompt' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'SessionStart',
        payload: { source: 'cli' },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    // Only show Prompts
    useUIStore.setState({ activeStaticFilters: ['Prompts'] })

    renderWithProviders(<EventStream />)

    expect(screen.getByText('My prompt')).toBeInTheDocument()
    expect(screen.queryByText('Session cli')).not.toBeInTheDocument()
  })

  it('should apply tool name filters to events', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'PreToolUse',
        toolName: 'Bash',
        toolUseId: 'tu-1',
        payload: { tool_input: { command: 'ls -la' } },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'PreToolUse',
        toolName: 'Read',
        toolUseId: 'tu-2',
        payload: { tool_input: { file_path: '/tmp/file.txt' } },
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    // Only show Bash tools
    useUIStore.setState({ activeToolFilters: ['Bash'] })

    renderWithProviders(<EventStream />)

    // Bash event should be visible
    expect(screen.getByText('ls -la')).toBeInTheDocument()
    // Read event should be filtered out
    expect(screen.queryByText('/tmp/file.txt')).not.toBeInTheDocument()
  })

  // ── Event count display ───────────────────────────────────

  it('should show raw count when filters reduce the visible count', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hello' },
        timestamp: 1700000000000,
      }),
      makeEvent({
        id: 2,
        subtype: 'SessionStart',
        payload: {},
        timestamp: 1700000001000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    // Filter to only Prompts (1 visible out of 2 raw)
    useUIStore.setState({ activeStaticFilters: ['Prompts'] })

    renderWithProviders(<EventStream />)

    // Should show "1" for filtered count and "2 raw" for total
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText(/2 raw/)).toBeInTheDocument()
  })

  // ── Agent label display ───────────────────────────────────

  it('should show agent labels when multiple agents exist', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        agentId: 'agent-1',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hello' },
        timestamp: 1700000000000,
      }),
    ])
    setMockAgents([
      makeAgent({ id: 'agent-1', parentAgentId: null }),
      makeAgent({ id: 'agent-2', parentAgentId: 'agent-1', name: 'worker' }),
    ])

    renderWithProviders(<EventStream />)

    // With 2 agents, should show agent labels
    expect(screen.getByText('Main')).toBeInTheDocument()
  })

  it('should NOT show agent labels when only one agent exists', () => {
    setMockEvents([
      makeEvent({
        id: 1,
        agentId: 'agent-1',
        subtype: 'UserPromptSubmit',
        payload: { prompt: 'Hello' },
        timestamp: 1700000000000,
      }),
    ])
    setMockAgents([makeAgent({ id: 'agent-1' })])

    renderWithProviders(<EventStream />)

    // With only 1 agent, "Main" label should not appear
    expect(screen.queryByText('Main')).not.toBeInTheDocument()
  })
})
