import { create } from 'zustand'
import type { FilterPattern } from '@/types'

// In-progress edits to filters, keyed by filter id. Lives outside the
// FiltersTab component so SettingsModal can detect unsaved work and
// intercept the close attempt. Cleared on Save or explicit Discard.

export interface FilterDraft {
  name: string
  pillName: string
  pillNameAutoMirror: boolean
  display: 'primary' | 'secondary'
  combinator: 'and' | 'or'
  patterns: FilterPattern[]
}

interface FilterDraftStore {
  drafts: Map<string, FilterDraft>
  setDraft: (id: string, draft: FilterDraft) => void
  clearDraft: (id: string) => void
  clearAll: () => void
}

export const useFilterDraftStore = create<FilterDraftStore>((set) => ({
  drafts: new Map(),
  setDraft: (id, draft) =>
    set((s) => {
      const m = new Map(s.drafts)
      m.set(id, draft)
      return { drafts: m }
    }),
  clearDraft: (id) =>
    set((s) => {
      if (!s.drafts.has(id)) return {}
      const m = new Map(s.drafts)
      m.delete(id)
      return { drafts: m }
    }),
  clearAll: () => set({ drafts: new Map() }),
}))
