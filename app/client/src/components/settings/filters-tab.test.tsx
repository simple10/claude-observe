import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FiltersTab } from './filters-tab'
import { useFilterStore } from '@/stores/filter-store'

vi.mock('@/lib/api-client', () => ({
  api: {
    listFilters: vi.fn().mockResolvedValue([]),
    createFilter: vi.fn(async (input) => ({
      id: 'new',
      ...input,
      // Server always returns the parsed config; mirror that here so the
      // FilterEditor doesn't crash dereferencing `config.color`.
      config: input.config ?? {},
      kind: 'user',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    })),
    updateFilter: vi.fn(),
    deleteFilter: vi.fn(),
    duplicateFilter: vi.fn(),
    resetDefaultFilters: vi.fn(),
  },
}))

// FiltersTab renders LivePreview, which calls useQueryClient(). Wrap the
// render in a QueryClientProvider so the hook resolves to a real client.
function renderWithQuery(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('FiltersTab', () => {
  beforeEach(() => {
    useFilterStore.setState({ filters: [], compiled: [], loaded: false, dirty: false })
  })

  test('clicking + New filter creates a user filter and selects it', async () => {
    renderWithQuery(<FiltersTab />)
    // Wait for load() to complete (mocked empty list).
    await act(async () => {})

    fireEvent.click(screen.getByText('+ New filter'))
    await act(async () => {})

    expect(screen.getByText('New filter')).toBeInTheDocument()
    // User filters render Save / Delete buttons; default filters don't.
    // Use the latter as a proxy that this is opened as a user filter.
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })
})
