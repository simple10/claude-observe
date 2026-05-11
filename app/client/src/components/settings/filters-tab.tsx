import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useFilterStore } from '@/stores/filter-store'
import { useUIStore } from '@/stores/ui-store'
import { applyFilters } from '@/lib/filters/matcher'
import type { CompiledFilter } from '@/lib/filters/types'
import type { Filter, ParsedEvent } from '@/types'
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
            onClick={async () => {
              const f = await useFilterStore.getState().create({
                name: 'New filter',
                pillName: 'New filter',
                display: displayTab,
                combinator: 'and',
                // Inert placeholder regex — user replaces this in the editor
                // before the filter does anything visible. Avoids flooding the
                // pill bar on first click.
                patterns: [{ target: 'hook', regex: '^$' }],
              })
              setSelectedId(f.id)
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

function Row({ f, selected, onSelect }: { f: Filter; selected: boolean; onSelect: () => void }) {
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
  const { update, remove, duplicate } = useFilterStore()
  const isUser = filter.kind === 'user'

  // Local form state — initialized from the filter, syncs back on save.
  const [name, setName] = useState(filter.name)
  const [pillName, setPillName] = useState(filter.pillName)
  const [pillNameAutoMirror, setPillNameAutoMirror] = useState(filter.name === filter.pillName)
  const [display, setDisplay] = useState(filter.display)
  const [combinator, setCombinator] = useState(filter.combinator)
  const [patterns, setPatterns] = useState(filter.patterns)
  // Re-initialize when a different filter is selected.
  useEffect(() => {
    setName(filter.name)
    setPillName(filter.pillName)
    setPillNameAutoMirror(filter.name === filter.pillName)
    setDisplay(filter.display)
    setCombinator(filter.combinator)
    setPatterns(filter.patterns)
  }, [filter.id])

  const invalidPattern = useMemo(() => {
    for (const p of patterns) {
      try {
        new RegExp(p.regex)
      } catch (e) {
        return (e as Error).message
      }
    }
    return null
  }, [patterns])

  async function onSave() {
    if (!isUser) return
    if (invalidPattern) return
    await update(filter.id, { name, pillName, display, combinator, patterns })
  }

  return (
    <div className="border rounded-lg p-4 max-w-2xl">
      <div className="flex items-center gap-2 mb-3">
        <span
          className={cn(
            'text-[10px] font-mono px-2 py-0.5 rounded',
            isUser ? 'bg-violet-500/20 text-violet-600' : 'bg-muted text-muted-foreground',
          )}
        >
          {isUser ? 'USER' : 'DEFAULT · READ-ONLY'}
        </span>
        <div className="flex-1" />
        <Button size="sm" variant="outline" onClick={() => void duplicate(filter.id)}>
          Duplicate
        </Button>
        {isUser ? (
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 border-red-300"
            onClick={() => void remove(filter.id)}
          >
            Delete
          </Button>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground">Filter name</label>
          <Input
            value={name}
            onChange={(e) => {
              const v = e.target.value
              setName(v)
              if (pillNameAutoMirror) setPillName(v)
            }}
            disabled={!isUser}
          />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground">Pill name</label>
          <Input
            value={pillName}
            onChange={(e) => {
              setPillName(e.target.value)
              setPillNameAutoMirror(false)
            }}
            disabled={!isUser}
            className="font-mono text-xs"
          />
          <div className="text-[10px] text-muted-foreground mt-1">
            Vars: <code>{'{hookName}'}</code> <code>{'{toolName}'}</code>{' '}
            <code>{'{bashCommand}'}</code>
          </div>
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground">Display</label>
          <div className="flex border rounded text-xs overflow-hidden">
            {(['primary', 'secondary'] as const).map((d) => (
              <button
                key={d}
                disabled={!isUser}
                onClick={() => setDisplay(d)}
                className={cn(
                  'px-3 py-1 flex-1',
                  display === d ? 'bg-violet-500 text-white' : 'bg-transparent',
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <label className="text-xs uppercase text-muted-foreground">Patterns</label>
        <span className="text-xs text-muted-foreground">·</span>
        <span className="text-xs text-muted-foreground">combine with:</span>
        <div className="flex border rounded text-[10px] overflow-hidden">
          {(['and', 'or'] as const).map((c) => (
            <button
              key={c}
              disabled={!isUser}
              onClick={() => setCombinator(c)}
              className={cn(
                'px-2 py-1',
                combinator === c ? 'bg-muted-foreground text-background' : 'bg-transparent',
              )}
            >
              {c.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2 mt-2">
        {patterns.map((p, i) => (
          <div key={i} className="flex gap-2 items-center border rounded p-2">
            <div className="flex border rounded text-[10px] overflow-hidden">
              {(['hook', 'tool', 'payload'] as const).map((t) => (
                <button
                  key={t}
                  disabled={!isUser}
                  onClick={() =>
                    setPatterns(patterns.map((pp, ii) => (ii === i ? { ...pp, target: t } : pp)))
                  }
                  className={cn(
                    'px-2 py-1 capitalize',
                    p.target === t ? 'bg-muted-foreground text-background' : 'bg-transparent',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <Input
              value={p.regex}
              disabled={!isUser}
              onChange={(e) =>
                setPatterns(
                  patterns.map((pp, ii) => (ii === i ? { ...pp, regex: e.target.value } : pp)),
                )
              }
              className="font-mono text-xs flex-1"
            />
            {isUser ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() => setPatterns(patterns.filter((_, ii) => ii !== i))}
              >
                ×
              </Button>
            ) : null}
          </div>
        ))}
      </div>

      {isUser ? (
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => setPatterns([...patterns, { target: 'hook', regex: '' }])}
        >
          + Add pattern
        </Button>
      ) : null}

      <LivePreview
        pillName={pillName}
        display={display}
        combinator={combinator}
        patterns={patterns}
      />

      {invalidPattern ? (
        <div className="mt-3 text-xs text-red-600">Invalid regex: {invalidPattern}</div>
      ) : null}

      {isUser ? (
        <div className="mt-4 flex gap-2 justify-end">
          <Button variant="outline" size="sm" disabled={!!invalidPattern} onClick={onSave}>
            Save
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function LivePreview({
  pillName,
  display,
  combinator,
  patterns,
}: {
  pillName: string
  display: 'primary' | 'secondary'
  combinator: 'and' | 'or'
  patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
}) {
  const queryClient = useQueryClient()
  const sessionId = useUIStore((s) => s.selectedSessionId)
  const [debounced, setDebounced] = useState({ pillName, display, combinator, patterns })

  useEffect(() => {
    const id = setTimeout(() => setDebounced({ pillName, display, combinator, patterns }), 300)
    return () => clearTimeout(id)
  }, [pillName, display, combinator, patterns])

  const count = useMemo(() => {
    if (!sessionId) return null
    const events = queryClient.getQueryData<ParsedEvent[]>(['events', sessionId]) ?? []
    let compiled: CompiledFilter
    try {
      compiled = {
        id: 'preview',
        name: 'preview',
        pillName: debounced.pillName,
        display: debounced.display,
        combinator: debounced.combinator,
        patterns: debounced.patterns.map((p) => ({
          target: p.target,
          regex: new RegExp(p.regex),
        })),
      }
    } catch {
      return null
    }
    let total = 0
    for (const e of events) {
      // We're outside the agent-class pipeline, so derive toolName from
      // payload.tool_name (matches claude-code's deriveToolName behavior
      // for the live-preview common case).
      const p = e.payload as Record<string, unknown> | undefined
      const tn = p?.tool_name
      const toolName = typeof tn === 'string' ? tn : null
      const out = applyFilters(e, toolName, [compiled])
      total += out.primary.length + out.secondary.length
    }
    return total
  }, [queryClient, sessionId, debounced])

  if (count === null) {
    return (
      <div className="mt-3 p-2 rounded text-xs bg-muted text-muted-foreground">
        Open a session to see live match counts
      </div>
    )
  }
  return (
    <div className="mt-3 p-2 rounded text-xs bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400">
      <span className="font-semibold">{count} matches</span> across loaded events
    </div>
  )
}
