import { useMemo, useState, useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useFilterStore } from '@/stores/filter-store'
import { useProcessedEvents } from '@/agents/event-processing-context'
import { cn } from '@/lib/utils'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { focusSiblingMatching } from '@/lib/keyboard-nav'

export function EventFilterBar() {
  const {
    activePrimaryFilters,
    activeSecondaryFilters,
    togglePrimaryFilter,
    toggleSecondaryFilter,
    clearAllFilters,
    searchQuery,
    setSearchQuery,
    selectedAgentIds,
  } = useUIStore()

  // Local input state for responsive typing; debounce before updating the store
  const [localSearch, setLocalSearch] = useState(searchQuery)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setLocalSearch(searchQuery)
  }, [searchQuery])

  function handleSearchChange(value: string) {
    setLocalSearch(value)
    clearTimeout(debounceRef.current)
    if (value === '') {
      setSearchQuery('')
    } else {
      debounceRef.current = setTimeout(() => setSearchQuery(value), 350)
    }
  }

  const { events: enrichedEvents } = useProcessedEvents()

  // Only consider displayed events for filter state
  const displayedEvents = useMemo(
    () => enrichedEvents.filter((e) => e.displayEventStream),
    [enrichedEvents],
  )

  // Apply agent selection filter before computing available filters
  const agentFilteredEvents = useMemo(
    () =>
      selectedAgentIds.length > 0
        ? displayedEvents.filter((e) => selectedAgentIds.includes(e.agentId))
        : displayedEvents,
    [displayedEvents, selectedAgentIds],
  )

  // Pill names that appear in at least one displayed event, by row.
  const primaryNames = useMemo(() => {
    const out = new Set<string>()
    for (const e of agentFilteredEvents) {
      for (const name of e.filters.primary) out.add(name)
    }
    return Array.from(out).sort()
  }, [agentFilteredEvents])

  const secondaryNames = useMemo(() => {
    const out = new Set<string>()
    for (const e of agentFilteredEvents) {
      for (const name of e.filters.secondary) out.add(name)
    }
    return Array.from(out).sort()
  }, [agentFilteredEvents])

  // Map pill name -> kind for styling. User filters win when multiple
  // filters share the same pill name so user-customized pills are always
  // visually distinguishable.
  const filters = useFilterStore((s) => s.filters)
  const pillKindByName = useMemo(() => {
    const m = new Map<string, 'user' | 'default'>()
    for (const f of filters) {
      const existing = m.get(f.pillName)
      if (existing === 'user') continue
      m.set(f.pillName, f.kind)
    }
    return m
  }, [filters])

  // Map rendered pill name -> filter.config.color. Every enabled filter
  // contributes a resolver, even if it has no color — the first resolver
  // whose template/literal matches the rendered pill name "owns" that
  // pill and returns its color (possibly undefined). This prevents a
  // wildcard templated filter (e.g. `{toolName}` → regex `^.+$`) from
  // claiming pills produced by a literal filter that just happens to
  // have no color set.
  //
  // Precedence: user-literal > default-literal > user-templated >
  // default-templated. Literals always beat templates, and within each
  // bucket user filters beat defaults.
  const pillColorFor = useMemo(() => {
    type Resolver = {
      color: string | undefined
      rank: number
      match: (name: string) => boolean
    }
    const resolvers: Resolver[] = []
    for (const f of filters) {
      if (!f.enabled) continue
      const color =
        typeof f.config?.color === 'string' && f.config.color ? f.config.color : undefined
      const hasVars = /\{[a-zA-Z]+\}/.test(f.pillName)
      if (hasVars) {
        const escaped = f.pillName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const withWild = escaped.replace(/\\\{[a-zA-Z]+\\\}/g, '.+')
        let re: RegExp
        try {
          re = new RegExp('^' + withWild + '$')
        } catch {
          continue
        }
        resolvers.push({
          color,
          rank: f.kind === 'user' ? 2 : 3,
          match: (name) => re.test(name),
        })
      } else {
        const literal = f.pillName
        resolvers.push({
          color,
          rank: f.kind === 'user' ? 0 : 1,
          match: (name) => name === literal,
        })
      }
    }
    resolvers.sort((a, b) => a.rank - b.rank)
    return (name: string): string | undefined => {
      for (const r of resolvers) if (r.match(name)) return r.color
      return undefined
    }
  }, [filters])

  const hasAnyFilter = activePrimaryFilters.length > 0 || activeSecondaryFilters.length > 0

  return (
    <div
      className="flex flex-col gap-1 px-3 py-1.5 border-b border-border"
      onKeyDown={(e) => {
        const target = e.target as HTMLElement
        if (!target.matches('[data-filter-pill]')) return
        const container = e.currentTarget

        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          const direction = e.key === 'ArrowRight' ? 1 : -1
          if (focusSiblingMatching(target, '[data-filter-pill]', container, direction)) {
            e.preventDefault()
          }
          return
        }

        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const currentRow = target.getAttribute('data-filter-row')
          if (currentRow == null) return
          const targetRow = String(Number(currentRow) + (e.key === 'ArrowDown' ? 1 : -1))
          const sameRow = Array.from(
            container.querySelectorAll<HTMLElement>(
              `[data-filter-pill][data-filter-row="${currentRow}"]`,
            ),
          )
          const otherRow = Array.from(
            container.querySelectorAll<HTMLElement>(
              `[data-filter-pill][data-filter-row="${targetRow}"]`,
            ),
          )
          if (otherRow.length === 0) return
          const idx = sameRow.indexOf(target)
          const clamped = Math.max(0, Math.min(idx, otherRow.length - 1))
          otherRow[clamped].focus()
          e.preventDefault()
        }
      }}
    >
      {/* Row 1: Static category filters + search */}
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 flex-wrap">
          <span className="text-xs text-muted-foreground">Filters:</span>
          <button
            data-filter-pill=""
            data-filter-row="0"
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              !hasAnyFilter
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent',
            )}
            onClick={clearAllFilters}
          >
            All
          </button>
          {primaryNames.map((category) => {
            const isActive = activePrimaryFilters.includes(category)
            const isUser = pillKindByName.get(category) === 'user'
            const color = pillColorFor(category)
            return (
              <button
                key={category}
                data-filter-pill=""
                data-filter-row="0"
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                  color
                    ? 'hover:brightness-110'
                    : isActive
                      ? isUser
                        ? 'bg-violet-500 text-white border-violet-500'
                        : 'bg-primary text-primary-foreground border-primary'
                      : isUser
                        ? 'bg-secondary text-secondary-foreground border-violet-500/40 hover:bg-accent'
                        : 'bg-secondary text-secondary-foreground border-primary/40 hover:bg-accent',
                )}
                style={
                  color
                    ? isActive
                      ? { backgroundColor: color, borderColor: color, color: 'white' }
                      : { borderColor: color, color }
                    : undefined
                }
                onClick={() => togglePrimaryFilter(category)}
              >
                {category}
              </button>
            )
          })}
        </div>

        <div className="flex-1" />

        <div className="relative w-48">
          <Search
            className={cn(
              'absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5',
              localSearch ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
            )}
          />
          <Input
            data-region-target="search"
            placeholder="Search events..."
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            className={cn(
              'h-7 pl-7 text-xs',
              localSearch &&
                'border-green-600 dark:border-green-400 ring-1 ring-green-600/30 dark:ring-green-400/30',
              localSearch &&
                localSearch !== localSearch.trim() &&
                'bg-green-600/5 dark:bg-green-400/5',
              localSearch && 'pr-7',
            )}
          />
          {localSearch && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-4 w-4 flex items-center justify-center rounded-sm text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {/* Row 2: Dynamic tool filters — caps at ~2 rows of pills, then
          scrolls vertically. Keeps the filter bar from eating the
          whole panel when there are many matching secondary pills.
          max-h-12 = 3rem ≈ 2 × (text-xs pill height + gap-1). */}
      {secondaryNames.length > 0 && (
        <div className="flex items-start gap-1 flex-wrap max-h-12 overflow-y-auto">
          {secondaryNames.map((name) => {
            const isActive = activeSecondaryFilters.includes(name)
            const isUser = pillKindByName.get(name) === 'user'
            const color = pillColorFor(name)
            return (
              <button
                key={name}
                data-filter-pill=""
                data-filter-row="1"
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                  color
                    ? 'hover:brightness-110'
                    : isUser
                      ? isActive
                        ? 'border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-400'
                        : 'border-border text-muted-foreground hover:border-violet-500/50 hover:text-foreground'
                      : isActive
                        ? 'border-blue-500 bg-blue-500/15 text-blue-700 dark:text-blue-400'
                        : 'border-border text-muted-foreground hover:border-blue-500/50 hover:text-foreground',
                )}
                style={
                  color
                    ? isActive
                      ? { backgroundColor: color, borderColor: color, color: 'white' }
                      : { borderColor: color, color }
                    : undefined
                }
                onClick={() => toggleSecondaryFilter(name)}
              >
                {name}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
