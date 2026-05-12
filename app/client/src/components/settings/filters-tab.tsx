import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useFilterStore } from '@/stores/filter-store'
import { useFilterDraftStore, type FilterDraft } from '@/stores/filter-draft-store'
import { useUIStore } from '@/stores/ui-store'
import { RE2JS } from 're2js'
import { applyFilters } from '@/lib/filters/matcher'
import { flagsStringToRE2, wrapWithAnchor } from '@/lib/filters/compile'
import type { CompiledFilter } from '@/lib/filters/types'
import { ColorPicker } from './color-picker'
import { COLOR_PRESETS } from '@/hooks/use-icon-customizations'
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
import { ChevronDown, ChevronRight } from 'lucide-react'

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
    // Old broadcasts / stale rows may not have config yet — keep the
    // editor crash-free with a `{}` fallback.
    config: f.config ?? {},
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
          <Section label="Default 🔒" className="mt-7">
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
            onSelect={setSelectedId}
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
        <span className="h-1.5 w-1.5 rounded-full bg-violet-500 shrink-0" title="Unsaved changes" />
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

/**
 * Filter-editor wrapper around the icon-settings ColorPicker that
 * round-trips a raw CSS color string (hex, named color, rgb(), etc.)
 * instead of preset keys. Shows the typed value in a text input
 * alongside a swatch button that opens the existing preset/custom
 * picker popover. Submitting a preset writes the preset's swatch hex
 * back into the input.
 */
function CssColorPicker({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled?: boolean
}) {
  const presetKey = useMemo(() => {
    if (!value) return undefined
    const target = value.toLowerCase().trim()
    for (const [key, p] of Object.entries(COLOR_PRESETS)) {
      if (p.swatch.toLowerCase() === target) return key
    }
    return undefined
  }, [value])

  return (
    <div className="flex items-center gap-2">
      <Input
        value={value}
        placeholder="#3b82f6"
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="font-mono text-xs flex-1"
      />
      {disabled ? null : (
        <ColorPicker
          currentColor={value ? (presetKey ?? 'custom') : undefined}
          customHex={presetKey ? undefined : value || undefined}
          onSelect={(name, customHex) => {
            const next = name === 'custom' ? (customHex ?? '') : (COLOR_PRESETS[name]?.swatch ?? '')
            onChange(next)
          }}
          defaultSwatch={value || undefined}
        />
      )}
    </div>
  )
}

function FilterEditor({
  filter,
  draft,
  onDraftChange,
  onDiscard,
  onSelect,
}: {
  filter: Filter
  draft: Draft | null
  onDraftChange: (next: Draft) => void
  onDiscard: () => void
  onSelect: (id: string) => void
}) {
  const { update, remove, duplicate } = useFilterStore()
  const isUser = filter.kind === 'user'
  const hasDraft = draft !== null
  // The form reads from the draft if one exists, otherwise from the
  // committed filter. Any edit lifts a new draft (seeded from the filter)
  // into the parent.
  const current: Draft = draft ?? draftFromFilter(filter)
  const { name, pillName, pillNameAutoMirror, display, combinator, patterns, config } = current

  const setDraft = (patch: Partial<Draft>) => onDraftChange({ ...current, ...patch })

  const colorValue = typeof config.color === 'string' ? config.color : ''
  const setColor = (next: string) => {
    const nextConfig = { ...config }
    if (next === '') delete nextConfig.color
    else nextConfig.color = next
    setDraft({ config: nextConfig })
  }

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  // Which pattern rows have their "Advanced" panel expanded. Stored by
  // index — patterns don't have stable ids and the array is short, so
  // this is fine even when rows are added/removed.
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())
  useEffect(() => {
    setConfirmDeleteOpen(false)
    setExpandedRows(new Set())
  }, [filter.id])

  const invalidPattern = useMemo(() => {
    for (const p of patterns) {
      try {
        RE2JS.compile(p.regex, flagsStringToRE2(p.flags))
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
    await update(filter.id, { name, pillName, display, combinator, patterns, config })
    onDiscard() // clears the draft once committed
  }
  async function onDelete() {
    await remove(filter.id)
  }
  async function onDuplicate() {
    const created = await duplicate(filter.id)
    onSelect(created.id)
  }

  return (
    <div
      className={cn(
        'relative border rounded-lg h-full flex flex-col overflow-visible transition-colors',
        hasDraft ? 'border-violet-500/60' : 'border-border/50',
      )}
    >
      {hasDraft ? (
        // Float the UNSAVED chip half-over the top-left corner so it
        // reads as a status badge on the card rather than a chip in the
        // toolbar. Keeps the original tinted look (light violet bg, dark
        // violet text) so the dark-mode appearance is the same magenta
        // tone the badge had when it lived in the toolbar.
        <span className="absolute -top-2 left-3 z-10 text-[10px] font-mono px-2 py-0.5 rounded bg-violet-500/20 text-violet-600">
          UNSAVED
        </span>
      ) : null}
      {!isUser ? (
        <div className="px-4 py-2 bg-red-500/15 border-b border-red-500/40 text-red-700 dark:text-red-400 text-xs font-semibold uppercase tracking-wider text-center rounded-t-lg">
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
          <Input
            value={name}
            onChange={(e) => {
              const v = e.target.value
              setDraft(pillNameAutoMirror ? { name: v, pillName: v } : { name: v })
            }}
            disabled={!isUser}
            placeholder="Filter name"
            className="flex-1 min-w-[10rem] h-8 text-sm font-semibold"
          />
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
              className="hover:text-red-600 hover:border-red-500"
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
                      className={cn('px-3 py-1 flex-1', isActive ? activeClass : 'bg-transparent')}
                    >
                      {d === 'primary' ? 'Primary' : 'Secondary'}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <label className="text-xs uppercase text-muted-foreground">Color</label>
              <CssColorPicker value={colorValue} onChange={setColor} disabled={!isUser} />
              <div className="text-[10px] text-muted-foreground mt-1">
                Any CSS color (e.g. <code>#ea580c</code>, <code>red</code>,{' '}
                <code>rgb(255,0,0)</code>)
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

          <div className="flex flex-col gap-3 mt-2">
            {patterns.map((p, i) => {
              const expanded = expandedRows.has(i)
              const caseInsensitive = (p.flags ?? '').includes('i')
              const hasAdvanced = !!p.negate || caseInsensitive
              const toggleExpanded = () =>
                setExpandedRows((prev) => {
                  const next = new Set(prev)
                  if (next.has(i)) next.delete(i)
                  else next.add(i)
                  return next
                })
              const updatePattern = (changes: Partial<(typeof patterns)[number]>) =>
                setDraft({
                  patterns: patterns.map((pp, ii) => (ii === i ? { ...pp, ...changes } : pp)),
                })
              return (
                <div key={i} className="flex flex-col gap-1">
                  <div className="flex gap-2 items-center">
                    <span
                      className={cn('h-2.5 w-2.5 rounded-sm shrink-0', patternPaletteClass(i))}
                      title={`Pattern ${i + 1} highlight color (used in preview)`}
                    />
                    <div className="flex border rounded text-[10px] overflow-hidden">
                      {(['hook', 'tool', 'payload'] as const).map((t) => (
                        <button
                          key={t}
                          disabled={!isUser}
                          onClick={() => updatePattern({ target: t })}
                          className={cn(
                            'px-2 py-1 capitalize',
                            p.target === t
                              ? 'bg-muted-foreground text-background'
                              : 'bg-transparent',
                          )}
                        >
                          {t}
                        </button>
                      ))}
                    </div>
                    <Input
                      value={p.regex}
                      disabled={!isUser}
                      onChange={(e) => updatePattern({ regex: e.target.value })}
                      className="font-mono text-xs flex-1 border-muted-foreground/50 dark:border-muted-foreground/50"
                    />
                    <button
                      type="button"
                      title="Advanced"
                      onClick={toggleExpanded}
                      className={cn(
                        'h-7 w-7 flex items-center justify-center rounded border transition-colors',
                        hasAdvanced
                          ? 'border-green-500/40 bg-green-500/15 text-green-700 dark:text-green-400'
                          : 'border-border text-muted-foreground hover:bg-accent',
                      )}
                    >
                      {expanded ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                    {isUser ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-red-600"
                        onClick={() => setDraft({ patterns: patterns.filter((_, ii) => ii !== i) })}
                      >
                        ×
                      </Button>
                    ) : null}
                  </div>
                  {expanded ? (
                    // pl-[166px] approximates the width of the color dot +
                    // the [Hook|Tool|Payload] target picker plus the row's
                    // gap-2s, so the checkboxes line up with the regex input's
                    // left edge.
                    <div className="flex gap-4 pl-[166px] py-1 text-xs text-muted-foreground">
                      <label
                        className={cn(
                          'flex items-center gap-1.5',
                          isUser ? 'cursor-pointer' : 'cursor-default',
                        )}
                        title="When checked, the pattern matches events whose target does NOT match the regex"
                      >
                        <input
                          type="checkbox"
                          checked={!!p.negate}
                          disabled={!isUser}
                          onChange={(e) => updatePattern({ negate: e.target.checked || undefined })}
                          className="h-3 w-3"
                        />
                        Invert match
                      </label>
                      <label
                        className={cn(
                          'flex items-center gap-1.5',
                          isUser ? 'cursor-pointer' : 'cursor-default',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={caseInsensitive}
                          disabled={!isUser}
                          onChange={(e) => {
                            const cur = p.flags ?? ''
                            const next = e.target.checked
                              ? cur.includes('i')
                                ? cur
                                : cur + 'i'
                              : cur.replace('i', '')
                            updatePattern({ flags: next || undefined })
                          }}
                          className="h-3 w-3"
                        />
                        Case insensitive
                      </label>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          {isUser ? (
            <button
              type="button"
              className="self-start mt-2 px-2 py-1 text-[10px] rounded border border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
              onClick={() => setDraft({ patterns: [...patterns, { target: 'hook', regex: '' }] })}
            >
              + Add pattern
            </button>
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

interface LivePreviewPattern {
  target: 'hook' | 'tool' | 'payload'
  regex: string
  negate?: boolean
  flags?: string
}

// Cap on the rendered payload text so a multi-MB event can't lock the
// browser. 32KB is comfortably more than any real Claude Code event we
// see, while still bounding the worst case for Range construction.
const MAX_PREVIEW_TEXT = 32_000

// Max ranges we'll register per pattern. Real payloads rarely have more
// than a handful — this is purely an O(N) safety belt against pathological
// regexes (e.g. `.` against a 32KB string).
const MAX_RANGES_PER_PATTERN = 1000

// Number of `::highlight(filter-preview-N)` slots defined in index.css.
// Pattern index modulo this size determines its color.
export const PREVIEW_PALETTE_SIZE = 5

// Tailwind background classes matching index.css's
// ::highlight(filter-preview-N) rules. Used for the inline legend dots
// in both the FilterEditor pattern rows and the LivePreview labels so
// users can map color → pattern at a glance.
const PREVIEW_PALETTE_BG = [
  'bg-purple-500',
  'bg-sky-400',
  'bg-lime-500',
  'bg-amber-500',
  'bg-pink-500',
] as const

function patternPaletteClass(patternIdx: number): string {
  return PREVIEW_PALETTE_BG[patternIdx % PREVIEW_PALETTE_SIZE]
}

interface PatternHighlight {
  patternIdx: number
  kind: 'payload' | 'hook' | 'tool' | 'negated' | 'no-match' | 'invalid'
  // For payload-target patterns: byte ranges within the displayed text.
  ranges: { start: number; end: number }[]
  // For hook/tool: the target value (e.g. 'Stop'). For other kinds: null.
  value: string | null
}

interface HighlightedEvent {
  text: string
  truncated: boolean
  highlights: PatternHighlight[]
}

function findHighlightedEvent(
  events: readonly ParsedEvent[],
  eventStrings: readonly string[],
  compiledFilter: CompiledFilter,
  rawPatterns: readonly LivePreviewPattern[],
): HighlightedEvent | null {
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const p = e.payload as Record<string, unknown> | undefined
    const tn = p?.tool_name
    const toolName = typeof tn === 'string' ? tn : null
    const out = applyFilters(e, toolName, [compiledFilter], eventStrings[i])
    if (out.primary.length + out.secondary.length === 0) continue

    const stringified = eventStrings[i]
    const truncated = stringified.length > MAX_PREVIEW_TEXT
    const text = truncated ? stringified.slice(0, MAX_PREVIEW_TEXT) : stringified

    const highlights: PatternHighlight[] = rawPatterns.map((rp, patternIdx) => {
      if (rp.negate) {
        return { patternIdx, kind: 'negated', ranges: [], value: null }
      }
      if (!rp.regex) {
        return { patternIdx, kind: 'invalid', ranges: [], value: null }
      }
      // Compile the user's raw regex (not the auto-anchored variant) so
      // the position ranges below line up with what the user actually
      // wrote. Matching is linear in the input under RE2.
      let r: RE2JS
      try {
        r = RE2JS.compile(rp.regex, flagsStringToRE2(rp.flags))
      } catch {
        return { patternIdx, kind: 'invalid', ranges: [], value: null }
      }
      if (rp.target === 'payload') {
        const ranges: { start: number; end: number }[] = []
        const matcher = r.matcher(text)
        while (matcher.find()) {
          const start = matcher.start()
          const end = matcher.end()
          if (end > start) {
            ranges.push({ start, end })
          } else {
            // Zero-length match — bail rather than loop. RE2's matcher
            // doesn't auto-advance past empty hits.
            break
          }
          if (ranges.length >= MAX_RANGES_PER_PATTERN) break
        }
        return {
          patternIdx,
          kind: ranges.length > 0 ? 'payload' : 'no-match',
          ranges,
          value: null,
        }
      }
      // hook / tool — match the small target string, label outside the
      // <pre>. We don't try to highlight the value's location inside the
      // stringified event because the same string can appear incidentally
      // elsewhere and confuse the visualization.
      const target = rp.target === 'hook' ? (e.hookName ?? '') : (toolName ?? '')
      if (r.test(target)) {
        return { patternIdx, kind: rp.target, ranges: [], value: target }
      }
      return { patternIdx, kind: 'no-match', ranges: [], value: null }
    })

    return { text, truncated, highlights }
  }
  return null
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
  patterns: LivePreviewPattern[]
}) {
  const queryClient = useQueryClient()
  const sessionId = useUIStore((s) => s.selectedSessionId)
  const [enabled, setEnabled] = useState(true)
  const [debounced, setDebounced] = useState({ pillName, display, combinator, patterns })
  const preRef = useRef<HTMLPreElement>(null)

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

  const result = useMemo<{ count: number | null; highlighted: HighlightedEvent | null }>(() => {
    if (!enabled || !sessionId || !eventStrings) return { count: null, highlighted: null }
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
          regex: RE2JS.compile(wrapWithAnchor(p.regex), flagsStringToRE2(p.flags)),
          ...(p.negate ? { negate: true } : {}),
        })),
      }
    } catch {
      return { count: null, highlighted: null }
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
    const highlighted =
      total > 0 ? findHighlightedEvent(events, eventStrings, compiled, debounced.patterns) : null
    return { count: total, highlighted }
  }, [enabled, events, eventStrings, sessionId, debounced])

  const count = result.count
  const highlighted = result.highlighted

  // Register Range-based highlights against the <pre>'s text node after
  // render. Re-runs whenever the highlighted event changes, which only
  // happens on the 500ms debounced filter input or when new events arrive
  // while the preview is on.
  useEffect(() => {
    if (!('highlights' in CSS)) return // graceful degrade on older browsers
    const clear = () => {
      for (let i = 0; i < PREVIEW_PALETTE_SIZE; i++) {
        CSS.highlights.delete(`filter-preview-${i}`)
      }
    }
    clear()
    if (!highlighted) return
    const pre = preRef.current
    if (!pre) return
    // Walk siblings instead of assuming firstChild is the text node —
    // mirrors the logs-modal approach to dodge Suspense/comment markers.
    let textNode: Text | null = null
    for (let n: Node | null = pre.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE) {
        textNode = n as Text
        break
      }
    }
    if (!textNode) return
    const textLen = textNode.textContent?.length ?? 0
    const bySlot = new Map<number, Range[]>()
    // Track the first Range we create in pattern order so we can scroll
    // it into view once highlights are registered — without this, a
    // match near the bottom of the truncated text is invisible until the
    // user scrolls the preview manually.
    let firstRange: Range | null = null
    for (const h of highlighted.highlights) {
      if (h.kind !== 'payload') continue
      const slot = h.patternIdx % PREVIEW_PALETTE_SIZE
      let arr = bySlot.get(slot)
      if (!arr) bySlot.set(slot, (arr = []))
      for (const { start, end } of h.ranges) {
        if (start >= textLen || end > textLen) continue
        const range = document.createRange()
        try {
          range.setStart(textNode, start)
          range.setEnd(textNode, end)
          arr.push(range)
          if (!firstRange) firstRange = range
        } catch {
          // Offsets stale or out-of-bounds — skip silently.
        }
      }
    }
    for (const [slot, ranges] of bySlot) {
      const h = new Highlight()
      for (const r of ranges) h.add(r)
      CSS.highlights.set(`filter-preview-${slot}`, h)
    }
    if (firstRange) {
      // Only scroll if the match falls outside the visible band — keeps
      // matches already near the top from snapping the view downward.
      const rangeRect = firstRange.getBoundingClientRect()
      const preRect = pre.getBoundingClientRect()
      const visible = rangeRect.top >= preRect.top && rangeRect.bottom <= preRect.bottom
      if (!visible) {
        const delta = rangeRect.top + rangeRect.height / 2 - (preRect.top + preRect.height / 2)
        pre.scrollBy({ top: delta, behavior: 'instant' })
      }
    }
    return clear
  }, [highlighted])

  const label = !enabled
    ? 'Preview disabled'
    : !sessionId
      ? 'Preview: open a session to count matches'
      : count == null
        ? 'Preview: invalid regex'
        : `Preview: ${count} matches across loaded events`

  // Box stays a muted gray in every state except "Preview: N matches"
  // where N > 0. Only the count itself goes green there so the box
  // doesn't visually compete with the rest of the editor.
  const showGreen = enabled && typeof count === 'number' && count > 0

  return (
    <div className="mt-6 p-2 rounded bg-muted text-xs text-muted-foreground">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="h-3 w-3"
        />
        <span className={cn(showGreen && 'text-green-600 dark:text-green-400')}>{label}</span>
      </label>
      {highlighted ? (
        <div className="mt-2 flex flex-col gap-2">
          <div className="flex flex-col gap-0.5">
            {highlighted.highlights.map((h) => (
              <PatternLegendRow key={h.patternIdx} h={h} />
            ))}
          </div>
          <pre
            ref={preRef}
            // ~5 lines at text-[11px] leading-snug (~15px line-height)
            // plus p-2 vertical padding ≈ 91px. Set explicitly so the
            // preview never grows tall enough to push other editor
            // content out of view.
            className="max-h-[91px] overflow-auto rounded bg-background/60 border border-border/40 p-2 font-mono text-[11px] leading-snug whitespace-pre-wrap break-all text-muted-foreground"
          >
            {highlighted.text}
          </pre>
          {highlighted.truncated ? (
            <div className="text-[10px] italic">
              Showing first {MAX_PREVIEW_TEXT.toLocaleString()} characters
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function PatternLegendRow({ h }: { h: PatternHighlight }) {
  const dotColor = patternPaletteClass(h.patternIdx)
  const name = `Pattern ${h.patternIdx + 1}`
  // Match-count patterns get a solid swatch to mirror the in-payload
  // highlight; other states stay outlined so the user reads them as
  // status rather than a color key.
  const dot =
    h.kind === 'payload' ? (
      <span className={cn('h-2.5 w-2.5 rounded-sm shrink-0', dotColor)} />
    ) : (
      <span className="h-2.5 w-2.5 rounded-sm shrink-0 border border-muted-foreground/40" />
    )

  const body = (() => {
    switch (h.kind) {
      case 'payload':
        return `${h.ranges.length} match${h.ranges.length === 1 ? '' : 'es'} in payload`
      case 'hook':
        return (
          <>
            matched hook <code className="font-mono text-foreground">{h.value}</code>
          </>
        )
      case 'tool':
        return (
          <>
            matched tool <code className="font-mono text-foreground">{h.value}</code>
          </>
        )
      case 'negated':
        return 'negated (not highlighted)'
      case 'invalid':
        return 'invalid regex'
      case 'no-match':
        return 'no match in this event'
    }
  })()

  return (
    <div className="flex items-center gap-2 text-[11px]">
      {dot}
      <span className="text-foreground">{name}</span>
      <span className="text-muted-foreground">— {body}</span>
    </div>
  )
}
