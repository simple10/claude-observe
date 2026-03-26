import { create } from 'zustand'

function parseHash(): { projectId: string | null; sessionId: string | null } {
  const hash = window.location.hash.slice(1) // remove #
  if (!hash || hash === '/') return { projectId: null, sessionId: null }
  const parts = hash.split('/').filter(Boolean)
  return {
    projectId: parts[0] || null,
    sessionId: parts[1] || null,
  }
}

function updateHash(projectId: string | null, sessionId: string | null) {
  if (!projectId) {
    window.history.replaceState(null, '', '#/')
  } else if (!sessionId) {
    window.history.replaceState(null, '', `#/${projectId}`)
  } else {
    window.history.replaceState(null, '', `#/${projectId}/${sessionId}`)
  }
}

interface UIState {
  sidebarCollapsed: boolean
  sidebarWidth: number
  setSidebarCollapsed: (collapsed: boolean) => void
  setSidebarWidth: (width: number) => void

  selectedProjectId: string | null
  selectedSessionId: string | null
  selectedAgentIds: string[]
  setSelectedProjectId: (id: string | null) => void
  setSelectedSessionId: (id: string | null) => void
  setSelectedAgentIds: (ids: string[]) => void
  toggleAgentId: (id: string) => void
  removeAgentId: (id: string) => void

  activeEventTypes: string[]
  searchQuery: string
  setActiveEventTypes: (types: string[]) => void
  toggleEventType: (type: string) => void
  setSearchQuery: (query: string) => void

  timelineHeight: number
  timeRange: '1m' | '5m' | '10m'
  setTimelineHeight: (height: number) => void
  setTimeRange: (range: '1m' | '5m' | '10m') => void

  expandedEventIds: Set<number>
  scrollToEventId: number | null
  toggleExpandedEvent: (id: number) => void
  collapseAllEvents: () => void
  expandAllEvents: (ids: number[]) => void
  setScrollToEventId: (id: number | null) => void

  // Auto-follow
  autoFollow: boolean
  setAutoFollow: (enabled: boolean) => void
}

const { projectId: initialProjectId, sessionId: initialSessionId } = parseHash()

export const useUIStore = create<UIState>((set, get) => ({
  sidebarCollapsed: false,
  sidebarWidth: 260,
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setSidebarWidth: (width) => set({ sidebarWidth: width }),

  selectedProjectId: initialProjectId,
  selectedSessionId: initialSessionId,
  selectedAgentIds: [],
  setSelectedProjectId: (id) => {
    set({ selectedProjectId: id, selectedSessionId: null, selectedAgentIds: [] })
    updateHash(id, null)
  },
  setSelectedSessionId: (id) => {
    set({ selectedSessionId: id, selectedAgentIds: [] })
    updateHash(get().selectedProjectId, id)
  },
  setSelectedAgentIds: (ids) => set({ selectedAgentIds: ids }),
  toggleAgentId: (id) =>
    set((s) => ({
      selectedAgentIds: s.selectedAgentIds.includes(id)
        ? s.selectedAgentIds.filter((a) => a !== id)
        : [...s.selectedAgentIds, id],
    })),
  removeAgentId: (id) =>
    set((s) => ({ selectedAgentIds: s.selectedAgentIds.filter((a) => a !== id) })),

  activeEventTypes: [],
  searchQuery: '',
  setActiveEventTypes: (types) => set({ activeEventTypes: types }),
  toggleEventType: (type) =>
    set((s) => ({
      activeEventTypes: s.activeEventTypes.includes(type)
        ? s.activeEventTypes.filter((t) => t !== type)
        : [...s.activeEventTypes, type],
    })),
  setSearchQuery: (query) => set({ searchQuery: query }),

  timelineHeight: 150,
  timeRange: '5m',
  setTimelineHeight: (height) => set({ timelineHeight: height }),
  setTimeRange: (range) => set({ timeRange: range }),

  expandedEventIds: new Set(),
  scrollToEventId: null,
  toggleExpandedEvent: (id) =>
    set((s) => {
      const next = new Set(s.expandedEventIds)
      const isExpanding = !next.has(id)
      if (isExpanding) next.add(id)
      else next.delete(id)
      // Disable auto-follow when expanding a row
      return { expandedEventIds: next, ...(isExpanding ? { autoFollow: false } : {}) }
    }),
  collapseAllEvents: () => set({ expandedEventIds: new Set() }),
  expandAllEvents: (ids: number[]) => set({ expandedEventIds: new Set(ids), autoFollow: false }),
  setScrollToEventId: (id) => set({ scrollToEventId: id }),

  autoFollow: true,
  setAutoFollow: (enabled) => set({ autoFollow: enabled }),
}))

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const { projectId, sessionId } = parseHash()
    const state = useUIStore.getState()
    if (projectId !== state.selectedProjectId) {
      state.setSelectedProjectId(projectId)
    }
    if (sessionId !== state.selectedSessionId) {
      state.setSelectedSessionId(sessionId)
    }
  })
}
