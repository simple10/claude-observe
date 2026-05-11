import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/api-client', () => ({
  api: {
    listFilters: vi.fn(),
    createFilter: vi.fn(),
    updateFilter: vi.fn(),
    deleteFilter: vi.fn(),
    duplicateFilter: vi.fn(),
    resetDefaultFilters: vi.fn(),
  },
}))

import { useFilterStore } from './filter-store'
import { api } from '@/lib/api-client'
import type { Filter } from '@/types'

const FAKE: Filter = {
  id: 'f1',
  name: 'x',
  pillName: 'x',
  display: 'primary',
  combinator: 'and',
  patterns: [{ target: 'hook', regex: '.' }],
  kind: 'user',
  enabled: true,
  createdAt: 0,
  updatedAt: 0,
}

describe('filter-store', () => {
  beforeEach(() => {
    useFilterStore.setState({ filters: [], compiled: [], loaded: false, dirty: false })
    vi.mocked(api.listFilters).mockReset()
    vi.mocked(api.createFilter).mockReset()
    vi.mocked(api.deleteFilter).mockReset()
  })

  test('load() populates filters and compiles them', async () => {
    vi.mocked(api.listFilters).mockResolvedValue([FAKE])
    await useFilterStore.getState().load()
    expect(useFilterStore.getState().filters).toEqual([FAKE])
    expect(useFilterStore.getState().compiled.length).toBe(1)
    expect(useFilterStore.getState().loaded).toBe(true)
  })

  test('upsertFromBroadcast adds a new filter and recompiles', () => {
    useFilterStore.getState().upsertFromBroadcast(FAKE)
    expect(useFilterStore.getState().filters.length).toBe(1)
    expect(useFilterStore.getState().compiled.length).toBe(1)
  })

  test('upsertFromBroadcast replaces existing filter by id', () => {
    useFilterStore.setState({ filters: [FAKE] })
    useFilterStore.getState().upsertFromBroadcast({ ...FAKE, name: 'renamed' })
    expect(useFilterStore.getState().filters[0].name).toBe('renamed')
  })

  test('removeFromBroadcast drops the filter', () => {
    useFilterStore.setState({ filters: [FAKE] })
    useFilterStore.getState().removeFromBroadcast(FAKE.id)
    expect(useFilterStore.getState().filters).toEqual([])
  })
})
