import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useFilterStore } from '@/stores/filter-store'
import { useFilterDraftStore, type FilterDraft } from '@/stores/filter-draft-store'
import { useUIStore } from '@/stores/ui-store'
import { applyFilters } from '@/lib/filters/matcher'
import { wrapWithAnchor } from '@/lib/filters/compile'
import type { CompiledFilter } from '@/lib/filters/types'
import type { Filter, ParsedEvent } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'

// In-progress edits live in filter-draft-store so the SettingsModal
// close handler can detect them. Save / Discard removes the entry;
// selecting a filter without an existing draft falls back to the
// committed values on the filter itself.
type Draft = FilterDraft

function draftFromFilter(f: Filter): Draft {
  return {
    name: f.name,
    pillName: f.pillName,
    pillNameAutoMirror: f.name === f.pillName,
    display: f.display,
    combinator: f.combinator,
    patterns: f.patterns,
  }
}

export function FiltersTab() {
  const { filters, loaded, load } = useFilterStore()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const drafts = useFilterDraftStore((s) => s.drafts)
  const setDraftFor = useFilterDraftStore((s) => s.setDraft)
  const clearDraftFor = useFilterDraftStore((s) => s.clearDraft)

  // Merge any in-progress draft into a filter so the sidebar reflects
  // edits (name + pattern count) before the user saves. `enabled` is
  // not a draft field — it stays from the committed value.
  const effective = (f: Filter): Filter => {
    const d = drafts.get(f.id)
    return d ? { ...f, name: d.name, patterns: d.patterns } : f
  }

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const filteredList = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q === '') return filters
    return filters.filter((f) => {
      const displayName = drafts.get(f.id)?.name ?? f.name
      return displayName.toLowerCase().includes(q)
    })
  }, [filters, search, drafts])

  const userFilters = filteredList.filter((f) => f.kind === 'user').sort(byName)
  const defaultFilters = filteredList.filter((f) => f.kind === 'default').sort(byName)

  const selected: Filter | null = useMemo(
    () => filters.find((f) => f.id === selectedId) ?? null,
    [filters, selectedId],
  )

  return (
    <div className="flex flex-1 min-h-0">
      <aside className="w-72 border-r border-border flex flex-col">
        <div className="p-3">
          <Input
            placeholder="Filter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 text-xs">
          <Section label="Custom">
            {userFilters.length === 0 ? (
              <div className="px-2 py-1 text-muted-foreground italic">(None)</div>
            ) : (
              userFilters.map((f) => (
                <Row
                  key={f.id}
                  f={effective(f)}
                  selected={selectedId === f.id}
                  modified={drafts.has(f.id)}
                  onSelect={() => setSelectedId(f.id)}
                />
              ))
            )}
          </Section>
          <Section label="Default 🔒" className="mt-5">
            {defaultFilters.map((f) => (
              <Row
                key={f.id}
                f={effective(f)}
                selected={selectedId === f.id}
                modified={drafts.has(f.id)}
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
                // New filters default to Primary; user can flip via the
                // editor's Display toggle.
                display: 'primary',
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
        {selected ? (
          <FilterEditor
            filter={selected}
            draft={drafts.get(selected.id) ?? null}
            onDraftChange={(d) => setDraftFor(selected.id, d)}
            onDiscard={() => clearDraftFor(selected.id)}
          />
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  )
}

function byName(a: Filter, b: Filter) {
  return a.name.localeCompare(b.name)
}

function Section({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn('mb-3', className)}>
      <div className="flex items-center px-2 mb-1 text-[10px] uppercase text-muted-foreground">
        <span className="flex-1">{label}</span>
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

function Row({
  f,
  selected,
  modified,
  onSelect,
}: {
  f: Filter
  selected: boolean
  modified: boolean
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
      {modified ? (
        <span
          className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0"
          title="Unsaved changes"
        />
      ) : null}
      <span className="flex-1 truncate">{f.name}</span>
      <span
        className={cn(
          'font-mono text-[9px] px-1 rounded',
          f.display === 'primary'
            ? 'bg-orange-500/20 text-orange-700 dark:text-orange-400'
            : 'bg-blue-500/20 text-blue-700 dark:text-blue-300',
        )}
        title={f.display === 'primary' ? 'Primary row pill' : 'Secondary row pill'}
      >
        {f.display === 'primary' ? 'P' : 'S'}
      </span>
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

function FilterEditor({
  filter,
  draft,
  onDraftChange,
  onDiscard,
}: {
  filter: Filter
  draft: Draft | null
  onDraftChange: (next: Draft) => void
  onDiscard: () => void
}) {
  const { update, remove, duplicate } = useFilterStore()
  const isUser = filter.kind === 'user'
  const hasDraft = draft !== null
  // The form reads from the draft if one exists, otherwise from the
  // committed filter. Any edit lifts a new draft (seeded from the filter)
  // into the parent.
  const current: Draft = draft ?? draftFromFilter(filter)
  const { name, pillName, pillNameAutoMirror, display, combinator, patterns } = current

  const setDraft = (patch: Partial<Draft>) => onDraftChange({ ...current, ...patch })

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  useEffect(() => {
    setConfirmDeleteOpen(false)
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

  // Save/Delete/Duplicate are fast now: they POST/PATCH/DELETE to the
  // server, then mark filter-store.dirty so SettingsModal prompts a
  // refresh on close. No event-pipeline re-pass happens, so the UI
  // stays responsive even on large sessions.
  async function onSave() {
    if (!isUser) return
    if (invalidPattern) return
    if (!hasDraft) return
    await update(filter.id, { name, pillName, display, combinator, patterns })
    onDiscard() // clears the draft once committed
  }
  async function onDelete() {
    await remove(filter.id)
  }
  async function onDuplicate() {
    await duplicate(filter.id)
  }

  return (
    <div className="border rounded-lg h-full flex flex-col overflow-hidden">
      {!isUser ? (
        <div className="px-4 py-2 bg-red-500/15 border-b border-red-500/40 text-red-700 dark:text-red-400 text-xs font-semibold uppercase tracking-wider text-center">
          Default Filter — Read Only
        </div>
      ) : null}
      <div className="p-4 flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <button
          onClick={() => void update(filter.id, { enabled: !filter.enabled })}
          className={cn(
            'text-[10px] font-mono px-2 py-0.5 rounded border transition-colors',
            filter.enabled
              ? 'border-green-500/40 bg-green-500/15 text-green-700 dark:text-green-400'
              : 'border-border text-muted-foreground hover:bg-accent',
          )}
          title="Click to toggle"
        >
          {filter.enabled ? 'ENABLED' : 'DISABLED'}
        </button>
        {hasDraft ? (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/20 text-violet-600">
            UNSAVED
          </span>
        ) : null}
        <div className="flex-1" />
        {isUser && hasDraft ? (
          <Button variant="outline" size="sm" onClick={onDiscard}>
            Discard
          </Button>
        ) : null}
        {isUser ? (
          <Button
            variant="outline"
            size="sm"
            disabled={!hasDraft || !!invalidPattern}
            onClick={onSave}
          >
            Save
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onDuplicate}>
          Duplicate
        </Button>
        {isUser ? (
          <Button
            size="sm"
            variant="outline"
            className="text-red-600 border-red-300"
            onClick={() => setConfirmDeleteOpen(true)}
          >
            Delete
          </Button>
        ) : null}
      </div>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete filter “{filter.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the filter. Events that currently match it will lose their
              “{filter.pillName}” pill. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={(e) => {
                e.preventDefault()
                setConfirmDeleteOpen(false)
                void onDelete()
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-xs uppercase text-muted-foreground">Filter name</label>
          <Input
            value={name}
            onChange={(e) => {
              const v = e.target.value
              setDraft(pillNameAutoMirror ? { name: v, pillName: v } : { name: v })
            }}
            disabled={!isUser}
          />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground">Pill name</label>
          <Input
            value={pillName}
            onChange={(e) => setDraft({ pillName: e.target.value, pillNameAutoMirror: false })}
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
            {(['primary', 'secondary'] as const).map((d) => {
              const isActive = display === d
              const activeClass =
                d === 'primary'
                  ? 'bg-orange-500/20 text-orange-700 dark:text-orange-400'
                  : 'bg-blue-500/20 text-blue-700 dark:text-blue-300'
              return (
                <button
                  key={d}
                  disabled={!isUser}
                  onClick={() => setDraft({ display: d })}
                  className={cn(
                    'px-3 py-1 flex-1',
                    isActive ? activeClass : 'bg-transparent',
                  )}
                >
                  {d === 'primary' ? 'Primary' : 'Secondary'}
                </button>
              )
            })}
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
              onClick={() => setDraft({ combinator: c })}
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
                    setDraft({
                      patterns: patterns.map((pp, ii) =>
                        ii === i ? { ...pp, target: t } : pp,
                      ),
                    })
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
                setDraft({
                  patterns: patterns.map((pp, ii) =>
                    ii === i ? { ...pp, regex: e.target.value } : pp,
                  ),
                })
              }
              className="font-mono text-xs flex-1"
            />
            {isUser ? (
              <Button
                size="sm"
                variant="ghost"
                className="text-red-600"
                onClick={() => setDraft({ patterns: patterns.filter((_, ii) => ii !== i) })}
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
          onClick={() => setDraft({ patterns: [...patterns, { target: 'hook', regex: '' }] })}
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
      </div>
      </div>
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
  const [enabled, setEnabled] = useState(true)
  const [debounced, setDebounced] = useState({ pillName, display, combinator, patterns })

  // 500ms debounce on input changes — only fires when preview is on.
  useEffect(() => {
    if (!enabled) return
    const id = setTimeout(() => setDebounced({ pillName, display, combinator, patterns }), 500)
    return () => clearTimeout(id)
  }, [enabled, pillName, display, combinator, patterns])

  // Pre-cache the stringified events. Rebuilds only when the events
  // array reference changes (new event arrived), not on every keystroke.
  // This avoids paying JSON.stringify for the full event list on each
  // test run.
  const events = useMemo(
    () => (sessionId ? (queryClient.getQueryData<ParsedEvent[]>(['events', sessionId]) ?? []) : []),
    [queryClient, sessionId],
  )
  const eventStrings = useMemo(() => {
    if (!enabled) return null
    return events.map((e) => JSON.stringify(e))
  }, [events, enabled])

  const count = useMemo(() => {
    if (!enabled || !sessionId || !eventStrings) return null
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
          regex: new RegExp(wrapWithAnchor(p.regex)),
        })),
      }
    } catch {
      return null
    }
    let total = 0
    for (let i = 0; i < events.length; i++) {
      const e = events[i]
      // We're outside the agent-class pipeline, so derive toolName from
      // payload.tool_name (matches claude-code's deriveToolName for the
      // live-preview common case).
      const p = e.payload as Record<string, unknown> | undefined
      const tn = p?.tool_name
      const toolName = typeof tn === 'string' ? tn : null
      const out = applyFilters(e, toolName, [compiled], eventStrings[i])
      total += out.primary.length + out.secondary.length
    }
    return total
  }, [enabled, events, eventStrings, sessionId, debounced])

  const label = !enabled
    ? 'Preview disabled'
    : !sessionId
      ? 'Preview: open a session to count matches'
      : count == null
        ? 'Preview: invalid regex'
        : `Preview: ${count} matches across loaded events`

  const boxClass = enabled
    ? 'mt-3 p-2 rounded text-xs bg-green-500/10 border border-green-500/30 text-green-700 dark:text-green-400'
    : 'mt-3 p-2 rounded text-xs bg-muted text-muted-foreground'

  return (
    <label className={cn(boxClass, 'flex items-center gap-2 cursor-pointer')}>
      <input
        type="checkbox"
        checked={enabled}
        onChange={(e) => setEnabled(e.target.checked)}
        className="h-3 w-3"
      />
      <span>{label}</span>
    </label>
  )
}
