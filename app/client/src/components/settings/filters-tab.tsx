import { useEffect, useMemo, useState } from 'react'
import { useFilterStore } from '@/stores/filter-store'
import type { Filter } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

type DisplayTab = 'primary' | 'secondary'

export function FiltersTab() {
  const { filters, loaded, load, resetDefaults } = useFilterStore()
  const [displayTab, setDisplayTab] = useState<DisplayTab>('primary')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase()
    return filters.filter(
      (f) => f.display === displayTab && (q === '' || f.name.toLowerCase().includes(q)),
    )
  }, [filters, displayTab, search])

  const userFilters = filteredList.filter((f) => f.kind === 'user').sort(byName)
  const defaultFilters = filteredList.filter((f) => f.kind === 'default').sort(byName)

  const selected: Filter | null = useMemo(
    () => filters.find((f) => f.id === selectedId) ?? null,
    [filters, selectedId],
  )

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-72 border-r border-border flex flex-col">
        <div className="p-3 flex gap-2">
          <Button
            size="sm"
            variant={displayTab === 'primary' ? 'default' : 'ghost'}
            onClick={() => setDisplayTab('primary')}
          >
            Primary
          </Button>
          <Button
            size="sm"
            variant={displayTab === 'secondary' ? 'default' : 'ghost'}
            onClick={() => setDisplayTab('secondary')}
          >
            Secondary
          </Button>
        </div>
        <div className="px-3">
          <Input
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 text-xs">
          <Section label="User">
            {userFilters.map((f) => (
              <Row
                key={f.id}
                f={f}
                selected={selectedId === f.id}
                onSelect={() => setSelectedId(f.id)}
              />
            ))}
          </Section>
          <Section
            label="Default 🔒"
            right={
              <button
                className="text-[10px] text-muted-foreground hover:underline"
                onClick={() => resetDefaults()}
              >
                ↻ Reset all
              </button>
            }
          >
            {defaultFilters.map((f) => (
              <Row
                key={f.id}
                f={f}
                selected={selectedId === f.id}
                onSelect={() => setSelectedId(f.id)}
              />
            ))}
          </Section>
        </div>
        <div className="p-3 border-t border-border">
          <Button
            size="sm"
            className="w-full"
            onClick={() => {
              /* TODO Task 7.4 */
            }}
          >
            + New filter
          </Button>
        </div>
      </aside>
      <main className="flex-1 min-h-0 overflow-y-auto p-4">
        {selected ? <FilterEditor filter={selected} /> : <EmptyState />}
      </main>
    </div>
  )
}

function byName(a: Filter, b: Filter) {
  return a.name.localeCompare(b.name)
}

function Section({
  label,
  right,
  children,
}: {
  label: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="mb-3">
      <div className="flex items-center px-2 mb-1 text-[10px] uppercase text-muted-foreground">
        <span className="flex-1">{label}</span>
        {right}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

function Row({
  f,
  selected,
  onSelect,
}: {
  f: Filter
  selected: boolean
  onSelect: () => void
}) {
  const { update } = useFilterStore()
  return (
    <button
      onClick={onSelect}
      className={cn(
        'flex items-center gap-2 px-2 py-1 rounded text-left',
        selected ? 'bg-primary/15' : 'hover:bg-accent',
      )}
    >
      <span className="flex-1 truncate">{f.name}</span>
      <span className="font-mono text-[9px] bg-muted px-1 rounded">{f.patterns.length}</span>
      <input
        type="checkbox"
        checked={f.enabled}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => void update(f.id, { enabled: e.target.checked })}
        className="h-3 w-3"
      />
    </button>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
      Select a filter to view or edit
    </div>
  )
}

function FilterEditor({ filter }: { filter: Filter }) {
  // Implemented in Task 7.3
  return <pre className="text-xs">{JSON.stringify(filter, null, 2)}</pre>
}
