import { describe, it, expect, beforeEach, vi } from 'vitest'
import { screen, act } from '@testing-library/react'
import { renderWithProviders } from '@/test/test-utils'
import { MainPanel } from './main-panel'
import { useUIStore } from '@/stores/ui-store'

// Mock child components to isolate routing logic.
// We verify which component gets rendered based on UI store state.

vi.mock('./home-page', () => ({
  HomePage: () => <div data-testid="home-page">HomePage</div>,
}))

vi.mock('./project-page', () => ({
  ProjectPage: () => <div data-testid="project-page">ProjectPage</div>,
}))

vi.mock('./scope-bar', () => ({
  ScopeBar: () => <div data-testid="scope-bar">ScopeBar</div>,
}))

vi.mock('./event-filter-bar', () => ({
  EventFilterBar: () => <div data-testid="event-filter-bar">EventFilterBar</div>,
}))

vi.mock('@/components/timeline/activity-timeline', () => ({
  ActivityTimeline: () => <div data-testid="activity-timeline">ActivityTimeline</div>,
}))

vi.mock('@/components/event-stream/event-stream', () => ({
  EventStream: () => <div data-testid="event-stream">EventStream</div>,
}))

beforeEach(() => {
  useUIStore.setState({
    selectedProjectId: null,
    selectedSessionId: null,
    selectedAgentIds: [],
    activePrimaryFilters: [],
    activeSecondaryFilters: [],
    searchQuery: '',
    sessionFilterStates: new Map(),
  })
})

describe('MainPanel routing', () => {
  it('should render HomePage when no project is selected', () => {
    renderWithProviders(<MainPanel />)

    expect(screen.getByTestId('home-page')).toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-stream')).not.toBeInTheDocument()
  })

  it('should render ProjectPage when project is selected but no session', () => {
    useUIStore.setState({ selectedProjectId: 1 })

    renderWithProviders(<MainPanel />)

    expect(screen.getByTestId('project-page')).toBeInTheDocument()
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('event-stream')).not.toBeInTheDocument()
  })

  it('should render full session view when project and session are selected', () => {
    useUIStore.setState({
      selectedProjectId: 1,
      selectedSessionId: 'sess-1',
    })

    renderWithProviders(<MainPanel />)

    expect(screen.getByTestId('scope-bar')).toBeInTheDocument()
    expect(screen.getByTestId('event-filter-bar')).toBeInTheDocument()
    expect(screen.getByTestId('activity-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('event-stream')).toBeInTheDocument()
    expect(screen.queryByTestId('home-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
  })

  it('should transition from session view back to ProjectPage when session is deselected', () => {
    useUIStore.setState({
      selectedProjectId: 1,
      selectedSessionId: 'sess-1',
    })

    const { rerender } = renderWithProviders(<MainPanel />)
    expect(screen.getByTestId('scope-bar')).toBeInTheDocument()

    // Deselect session
    act(() => {
      useUIStore.setState({ selectedSessionId: null })
    })
    rerender(<MainPanel />)

    expect(screen.getByTestId('project-page')).toBeInTheDocument()
    expect(screen.queryByTestId('scope-bar')).not.toBeInTheDocument()
  })

  it('should transition from ProjectPage to HomePage when project is deselected', () => {
    useUIStore.setState({ selectedProjectId: 1 })

    const { rerender } = renderWithProviders(<MainPanel />)
    expect(screen.getByTestId('project-page')).toBeInTheDocument()

    // Deselect project
    act(() => {
      useUIStore.setState({ selectedProjectId: null })
    })
    rerender(<MainPanel />)

    expect(screen.getByTestId('home-page')).toBeInTheDocument()
    expect(screen.queryByTestId('project-page')).not.toBeInTheDocument()
  })
})
