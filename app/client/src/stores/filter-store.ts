import { create } from 'zustand'
import type { Filter } from '@/types'
import type { CompiledFilter } from '@/lib/filters/types'
import { compileFilters } from '@/lib/filters/compile'
import { api } from '@/lib/api-client'

interface FilterStore {
  filters: Filter[]
  compiled: readonly CompiledFilter[]
  loaded: boolean

  load: () => Promise<void>
  create: (input: {
    name: string
    pillName: string
    display: 'primary' | 'secondary'
    combinator: 'and' | 'or'
    patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
  }) => Promise<Filter>
  update: (
    id: string,
    patch: Partial<{
      name: string
      pillName: string
      display: 'primary' | 'secondary'
      combinator: 'and' | 'or'
      patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
      enabled: boolean
    }>,
  ) => Promise<Filter>
  remove: (id: string) => Promise<void>
  duplicate: (id: string) => Promise<Filter>
  resetDefaults: () => Promise<void>

  upsertFromBroadcast: (f: Filter) => void
  removeFromBroadcast: (id: string) => void
  bulkChangedFromBroadcast: () => Promise<void>
}

function setFilters(state: { filters: Filter[] }, next: Filter[]) {
  return { filters: next, compiled: compileFilters(next) }
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  filters: [],
  compiled: [],
  loaded: false,

  load: async () => {
    const filters = await api.listFilters()
    set({ ...setFilters({ filters: [] }, filters), loaded: true })
  },

  create: async (input) => {
    const f = await api.createFilter(input)
    // Server broadcast will land via WS; but apply locally now for snappy UX.
    set((s) => setFilters(s, [...s.filters, f]))
    return f
  },

  update: async (id, patch) => {
    const f = await api.updateFilter(id, patch)
    set((s) => setFilters(s, s.filters.map((x) => (x.id === id ? f : x))))
    return f
  },

  remove: async (id) => {
    await api.deleteFilter(id)
    set((s) => setFilters(s, s.filters.filter((x) => x.id !== id)))
  },

  duplicate: async (id) => {
    const f = await api.duplicateFilter(id)
    set((s) => setFilters(s, [...s.filters, f]))
    return f
  },

  resetDefaults: async () => {
    const fresh = await api.resetDefaultFilters()
    // Replace defaults; keep users as-is.
    set((s) => {
      const merged = [...s.filters.filter((x) => x.kind === 'user'), ...fresh]
      return setFilters(s, merged)
    })
  },

  upsertFromBroadcast: (f) => {
    set((s) => {
      const idx = s.filters.findIndex((x) => x.id === f.id)
      const next =
        idx === -1
          ? [...s.filters, f]
          : s.filters.map((x, i) => (i === idx ? f : x))
      return setFilters(s, next)
    })
  },

  removeFromBroadcast: (id) => {
    set((s) => setFilters(s, s.filters.filter((x) => x.id !== id)))
  },

  bulkChangedFromBroadcast: async () => {
    await get().load()
  },
}))
