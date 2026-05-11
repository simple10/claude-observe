import { create } from 'zustand'
import type { Filter } from '@/types'
import type { CompiledFilter } from '@/lib/filters/types'
import { compileFilters } from '@/lib/filters/compile'
import { api } from '@/lib/api-client'

interface FilterStore {
  filters: Filter[]
  compiled: readonly CompiledFilter[]
  loaded: boolean
  /** Flipped to true on any mutation after the initial `load()`. Stays
   *  true for the rest of the page session. The Settings modal checks
   *  this on close to prompt the user to refresh so changes can take
   *  effect on the running event pipeline. */
  dirty: boolean

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
  dirty: false,

  load: async () => {
    const filters = await api.listFilters()
    set({ ...setFilters({ filters: [] }, filters), loaded: true })
  },

  create: async (input) => {
    const f = await api.createFilter(input)
    // Use the same upsert-by-id path as the WS broadcast handler so a
    // racing `filter:created` broadcast can't double-insert.
    get().upsertFromBroadcast(f)
    return f
  },

  update: async (id, patch) => {
    const f = await api.updateFilter(id, patch)
    set((s) => ({
      ...setFilters(
        s,
        s.filters.map((x) => (x.id === id ? f : x)),
      ),
      dirty: true,
    }))
    return f
  },

  remove: async (id) => {
    await api.deleteFilter(id)
    set((s) => ({
      ...setFilters(
        s,
        s.filters.filter((x) => x.id !== id),
      ),
      dirty: true,
    }))
  },

  duplicate: async (id) => {
    const f = await api.duplicateFilter(id)
    // Same dedup reasoning as `create` above.
    get().upsertFromBroadcast(f)
    return f
  },

  resetDefaults: async () => {
    const fresh = await api.resetDefaultFilters()
    // Replace defaults; keep users as-is.
    set((s) => {
      const merged = [...s.filters.filter((x) => x.kind === 'user'), ...fresh]
      return { ...setFilters(s, merged), dirty: true }
    })
  },

  upsertFromBroadcast: (f) => {
    set((s) => {
      const idx = s.filters.findIndex((x) => x.id === f.id)
      const next = idx === -1 ? [...s.filters, f] : s.filters.map((x, i) => (i === idx ? f : x))
      return { ...setFilters(s, next), dirty: true }
    })
  },

  removeFromBroadcast: (id) => {
    set((s) => ({
      ...setFilters(
        s,
        s.filters.filter((x) => x.id !== id),
      ),
      dirty: true,
    }))
  },

  bulkChangedFromBroadcast: async () => {
    await get().load()
    set({ dirty: true })
  },
}))
