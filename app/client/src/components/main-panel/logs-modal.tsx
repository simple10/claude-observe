import { useState, useRef, useEffect, useTransition, useMemo, useCallback, memo } from 'react'
import { useEvents } from '@/hooks/use-events'
import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogClose,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ScrollText,
  Copy,
  Check,
  ArrowDownToLine,
  CloudDownload,
  ClipboardCopy,
  X,
  LoaderCircle,
  Search,
  ChevronUp,
  ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ParsedEvent } from '@/types'

type Match = { eventId: number; range: Range }

async function buildMatches(
  query: string,
  events: ParsedEvent[],
  index: string[],
  preMap: Map<number, HTMLPreElement>,
  signal: AbortSignal,
): Promise<Match[]> {
  // Note: positions found in `haystack` (lowercased) are mapped 1:1 onto
  // the original textNode for Range offsets. This assumes
  // `String.prototype.toLowerCase()` is length-preserving, which is true
  // for ASCII (the dominant case for JSON-stringified payloads) but NOT
  // for some Unicode (e.g. Turkish `İ` → `i̇`). If that ever
  // matters, build positions against the un-lowercased text using
  // `localeCompare` or `Intl.Segmenter`.
  const lower = query.toLowerCase()
  const out: Match[] = []
  const CAP = 1000

  for (let i = 0; i < events.length; i++) {
    if (signal.aborted) return out
    if (out.length >= CAP) break

    if (!index[i]?.includes(lower)) continue
    const event = events[i]

    const pre = preMap.get(event.id)
    if (!pre) continue

    // Walk siblings rather than assume firstChild is the text node.
    // Comments / Suspense markers can appear before it.
    let textNode: Text | null = null
    for (let n: Node | null = pre.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === Node.TEXT_NODE) {
        textNode = n as Text
        break
      }
    }
    if (!textNode) continue

    const haystack = textNode.textContent!.toLowerCase()
    let pos = 0
    while ((pos = haystack.indexOf(lower, pos)) !== -1) {
      if (out.length >= CAP) break
      const range = document.createRange()
      range.setStart(textNode, pos)
      range.setEnd(textNode, pos + lower.length)
      out.push({ eventId: event.id, range })
      pos += lower.length
    }

    if (i > 0 && i % 500 === 0) {
      await new Promise((r) => requestAnimationFrame(() => r(undefined)))
    }
  }
  return out
}

function scrollMatchIntoView(range: Range, outer: HTMLElement | null) {
  const text = range.startContainer as Text
  const pre = text.parentElement?.closest('pre') as HTMLElement | null

  // 1. Center the match inside its <pre>'s inner scroll.
  if (pre) {
    const rangeRect = range.getBoundingClientRect()
    const preRect = pre.getBoundingClientRect()
    const delta = rangeRect.top + rangeRect.height / 2 - (preRect.top + preRect.height / 2)
    pre.scrollBy({ top: delta, behavior: 'instant' })
  }

  // 2. Center the (now-positioned) match inside the modal's outer scroll.
  if (outer) {
    const rangeRect = range.getBoundingClientRect()
    const outerRect = outer.getBoundingClientRect()
    const delta = rangeRect.top + rangeRect.height / 2 - (outerRect.top + outerRect.height / 2)
    outer.scrollBy({ top: delta, behavior: 'instant' })
  }
}

// Memoized row. Re-renders only when event/isCopied/onCopy/registerPre
// change. Existing events are stable (append-only), so once mounted a
// row stays mounted across LogsModal re-renders without redoing the
// expensive JSON.stringify / time formatting / ref-callback churn.
type LogsRowProps = {
  event: ParsedEvent
  isCopied: boolean
  hasMatch: boolean
  onCopy: (id: number, payload: Record<string, unknown>) => void
  registerPre: (id: number, el: HTMLPreElement | null) => void
}

const LogsRow = memo(function LogsRow({
  event,
  isCopied,
  hasMatch,
  onCopy,
  registerPre,
}: LogsRowProps) {
  const ePayload = event.payload as Record<string, unknown> | undefined
  const toolName =
    typeof ePayload?.tool_name === 'string' ? (ePayload.tool_name as string) : null

  const setPreRef = useCallback(
    (el: HTMLPreElement | null) => registerPre(event.id, el),
    [registerPre, event.id],
  )

  // JSON.stringify dominates the per-render cost on large sessions.
  // Memoize per event so LogsModal re-renders (typing, etc.) don't
  // re-serialize.
  const payloadJson = useMemo(
    () => JSON.stringify(event.payload, null, 2),
    [event.payload],
  )

  const timeStr = useMemo(
    () =>
      new Date(event.timestamp).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    [event.timestamp],
  )

  return (
    <div
      data-has-match={hasMatch || undefined}
      className={cn(
        // border-l-2 + per-side color (border-l-*) keeps the column
        // reserved without overriding the parent's `divide-y` top
        // border color — using the shorthand `border-*` would inherit
        // yellow onto the divider between rows.
        'px-4 py-2 hover:bg-muted/30 border-l-2 border-l-transparent transition-colors',
        hasMatch && 'border-l-yellow-500/70 bg-yellow-500/[0.06] dark:bg-yellow-400/[0.04]',
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-mono font-medium text-primary">{event.hookName}</span>
        {toolName && (
          <span className="text-xs font-mono text-blue-700 dark:text-blue-400">{toolName}</span>
        )}
        <span className="text-[10px] text-muted-foreground/70 dark:text-muted-foreground/50 tabular-nums ml-auto">
          {timeStr}
        </span>
        <button
          className="text-muted-foreground/70 dark:text-muted-foreground/50 hover:text-foreground transition-colors"
          onClick={() => onCopy(event.id, event.payload as Record<string, unknown>)}
          title="Copy payload"
        >
          {isCopied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
      <pre
        ref={setPreRef}
        className={cn(
          'text-[10px] font-mono leading-relaxed text-muted-foreground',
          'overflow-x-auto max-h-60 overflow-y-auto',
          'rounded bg-muted/40 p-2',
          hasMatch && 'ring-1 ring-yellow-500/40',
        )}
      >
        {payloadJson}
      </pre>
    </div>
  )
})

export function LogsModal() {
  const { selectedSessionId } = useUIStore()
  const { data: events } = useEvents(selectedSessionId)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const [copiedAll, setCopiedAll] = useState(false)
  const [query, setQuery] = useState('')
  const [committedQuery, setCommittedQuery] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isComposingRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [readyEvents, setReadyEvents] = useState<ParsedEvent[] | null>(null)
  const [, startTransition] = useTransition()
  const hasInitiallyLoaded = useRef(false)
  const searchIndex = useMemo(
    () => readyEvents?.map((e) => JSON.stringify(e.payload, null, 2).toLowerCase()) ?? [],
    [readyEvents],
  )
  const preRefs = useRef<Map<number, HTMLPreElement>>(new Map())
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const [matchCount, setMatchCount] = useState(0)
  const [rebuildEpoch, setRebuildEpoch] = useState(0)
  // Set of event ids that contain at least one match. Recomputed in
  // Effect A. Used to tint matched rows so users can spot a match even
  // when its text is hidden inside the <pre>'s horizontal scroll.
  const [matchedEventIds, setMatchedEventIds] = useState<Set<number>>(() => new Set())
  const matchesRef = useRef<Match[]>([])
  const lastBuiltQueryRef = useRef('')
  const scrollOnNextPaintRef = useRef(false)

  // Stable callbacks for the memoized LogsRow. If these were inline or
  // recreated each render, every row would re-render on every keystroke.
  const handleCopy = useCallback((id: number, payload: Record<string, unknown>) => {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }, [])

  const registerPre = useCallback((id: number, el: HTMLPreElement | null) => {
    if (el) preRefs.current.set(id, el)
    else preRefs.current.delete(id)
  }, [])

  // On first open, defer the heavy event list into a transition so
  // the modal shell (with spinner) paints immediately.
  // After initial load, update events silently without showing spinner.
  useEffect(() => {
    if (!open) {
      hasInitiallyLoaded.current = false
      setReadyEvents(null)
      setQuery('')
      setCommittedQuery('')
      clearTimeout(debounceRef.current)
      // Highlights are cleared by Effect A's empty-query branch when
      // committedQuery becomes ''.
      return
    }
    if (open && events) {
      if (!hasInitiallyLoaded.current) {
        // First load: use transition so spinner shows while rendering
        startTransition(() => {
          setReadyEvents(events)
          hasInitiallyLoaded.current = true
        })
      } else {
        // Subsequent updates: apply silently, no spinner
        setReadyEvents(events)
      }
    }
  }, [open, events])

  // Effect A: build match list whenever committedQuery or readyEvents changes.
  useEffect(() => {
    if (!('highlights' in CSS)) return // graceful degrade

    if (!committedQuery || !readyEvents) {
      CSS.highlights.delete('logs-search-all')
      CSS.highlights.delete('logs-search-current')
      matchesRef.current = []
      setMatchCount(0)
      setCurrentMatchIndex(0)
      setRebuildEpoch((e) => e + 1)
      setMatchedEventIds((prev) => (prev.size === 0 ? prev : new Set()))
      lastBuiltQueryRef.current = ''
      return
    }

    const ctrl = new AbortController()
    buildMatches(committedQuery, readyEvents, searchIndex, preRefs.current, ctrl.signal).then(
      (matches) => {
        if (ctrl.signal.aborted) return

        const isNewQuery = committedQuery !== lastBuiltQueryRef.current

        // Order matters: write refs synchronously BEFORE state updates that
        // trigger Effect B. Effect B reads matchesRef.current.
        matchesRef.current = matches
        lastBuiltQueryRef.current = committedQuery

        // Set of event ids that have at least one match — drives the
        // per-row visual indicator. Set identity changes here, but
        // individual booleans passed to memoized rows only flip for
        // rows whose match-presence actually changed.
        setMatchedEventIds(new Set(matches.map((m) => m.eventId)))

        setMatchCount(matches.length)
        setRebuildEpoch((e) => e + 1)
        setCurrentMatchIndex((prev) => {
          if (matches.length === 0) return 0
          if (isNewQuery) {
            scrollOnNextPaintRef.current = true
            return 0
          }
          return Math.min(prev, matches.length - 1)
        })

        if (matches.length > 0) {
          const all = new Highlight()
          for (const m of matches) all.add(m.range)
          all.priority = 0
          CSS.highlights.set('logs-search-all', all)
        } else {
          CSS.highlights.delete('logs-search-all')
          CSS.highlights.delete('logs-search-current')
        }
      },
    )

    return () => {
      ctrl.abort()
      // Don't delete highlights here — would flicker on streaming rebuilds.
    }
  }, [committedQuery, readyEvents, searchIndex])

  // Effect B: paint the current (active) match and scroll on intent.
  useEffect(() => {
    if (!('highlights' in CSS)) return
    const matches = matchesRef.current
    if (matches.length === 0) {
      CSS.highlights.delete('logs-search-current')
      scrollOnNextPaintRef.current = false
      return
    }
    const idx = Math.min(currentMatchIndex, matches.length - 1)
    const current = new Highlight()
    current.add(matches[idx].range)
    current.priority = 1
    CSS.highlights.set('logs-search-current', current)

    if (scrollOnNextPaintRef.current) {
      scrollMatchIntoView(matches[idx].range, scrollRef.current)
      scrollOnNextPaintRef.current = false
    }
  }, [currentMatchIndex, matchCount, rebuildEpoch])

  // Unmount-only safety net: delete CSS.highlights even when the close-effect
  // doesn't run (e.g. parent unmounts the component without going through close).
  useEffect(() => {
    return () => {
      if ('highlights' in CSS) {
        CSS.highlights.delete('logs-search-all')
        CSS.highlights.delete('logs-search-current')
      }
    }
  }, [])

  function scheduleCommit(value: string) {
    clearTimeout(debounceRef.current)
    if (value === '') {
      setCommittedQuery('')
      return
    }
    if (isComposingRef.current) return
    debounceRef.current = setTimeout(() => setCommittedQuery(value), 250)
  }

  const next = useCallback(() => {
    if (matchCount === 0) return
    scrollOnNextPaintRef.current = true
    setCurrentMatchIndex((i) => (i + 1) % matchCount)
  }, [matchCount])

  const prev = useCallback(() => {
    if (matchCount === 0) return
    scrollOnNextPaintRef.current = true
    setCurrentMatchIndex((i) => (i - 1 + matchCount) % matchCount)
  }, [matchCount])

  const nextRef = useRef(next)
  const prevRef = useRef(prev)
  useEffect(() => {
    nextRef.current = next
    prevRef.current = prev
  }, [next, prev])

  // Effect C: document-level Cmd/Ctrl+G listener for next/prev match navigation.
  useEffect(() => {
    if (committedQuery === '' || !open) return
    if (!('highlights' in CSS)) return

    function onDocKeyDown(e: KeyboardEvent) {
      // e.code instead of e.key — Shift+G yields key='G' on macOS.
      if (e.code !== 'KeyG') return
      if (!(e.metaKey || e.ctrlKey)) return

      // Make sure the event came from inside a Radix Dialog. This guards
      // against the modal listener firing for keystrokes in unrelated UI
      // (e.g. another stacked dialog or a detached portal).
      const target = e.target as Element | null
      if (!target?.closest?.('[role="dialog"]')) return

      e.preventDefault()
      if (e.shiftKey) prevRef.current()
      else nextRef.current()
    }
    document.addEventListener('keydown', onDocKeyDown)
    return () => document.removeEventListener('keydown', onDocKeyDown)
  }, [committedQuery, open])

  if (!selectedSessionId) return null

  const loading = open && readyEvents === null

  const handleCopyAll = () => {
    if (!events?.length) return
    const allLogs = events.map((e) => JSON.stringify(e.payload)).join('\n')
    navigator.clipboard.writeText(allLogs)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7" title="View raw event logs">
          <ScrollText className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent
        onEscapeKeyDown={(e) => {
          if (query !== '') {
            e.preventDefault()
            setQuery('')
            setCommittedQuery('')
            clearTimeout(debounceRef.current)
          }
          // else: don't preventDefault, Radix closes as usual.
        }}
        aria-describedby={undefined}
        className="w-[90vw] max-w-5xl h-[85vh] flex flex-col p-0"
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <DialogTitle>Raw Event Logs</DialogTitle>
          <span className="text-xs text-muted-foreground">{events?.length ?? 0} events</span>
          <div className="flex items-center gap-1 ml-auto">
            {/* Search input — first child of the action group. */}
            <div className="relative w-56 mr-1">
              <Search
                className={cn(
                  'absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5',
                  query ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground',
                )}
              />
              <Input
                placeholder="Search payloads..."
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  scheduleCommit(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    clearTimeout(debounceRef.current)
                    if (query !== committedQuery) {
                      // Force-commit. Effect A will reset index + scroll.
                      setCommittedQuery(query)
                    } else if (matchCount > 0) {
                      // Already committed — navigate.
                      if (e.shiftKey) prev()
                      else next()
                    }
                    e.preventDefault()
                    return
                  }
                  // Otherwise just cancel the pending commit so a new keystroke resets
                  // the debounce window. (Esc is handled by Radix's onEscapeKeyDown — see Task 15.)
                  clearTimeout(debounceRef.current)
                }}
                onCompositionStart={() => {
                  isComposingRef.current = true
                }}
                onCompositionEnd={(e) => {
                  isComposingRef.current = false
                  scheduleCommit((e.target as HTMLInputElement).value)
                }}
                className={cn(
                  'h-7 pl-7 text-xs',
                  query &&
                    'border-green-600 dark:border-green-400 ring-1 ring-green-600/30 dark:ring-green-400/30',
                )}
              />
            </div>

            {committedQuery !== '' && (
              <div className="flex items-center gap-0.5 mr-1 text-xs">
                {matchCount === 0 ? (
                  <span className="text-destructive mr-1">0 matches</span>
                ) : (
                  <span className="text-muted-foreground mr-1 tabular-nums">
                    {currentMatchIndex + 1}/{matchCount}
                    {matchCount >= 1000 ? '+' : ''}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={prev}
                  disabled={matchCount === 0}
                  title="Previous match"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={next}
                  disabled={matchCount === 0}
                  title="Next match"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => {
                    setQuery('')
                    setCommittedQuery('')
                    clearTimeout(debounceRef.current)
                  }}
                  title="Clear search"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* Existing buttons — unchanged. */}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={handleCopyAll}
              title="Copy all logs"
              disabled={loading}
            >
              {copiedAll ? (
                <Check className="h-3 w-3 text-green-500" />
              ) : (
                <ClipboardCopy className="h-3 w-3" />
              )}
              {copiedAll ? 'Copied' : 'Copy all'}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => {
                if (!events) return
                const json = JSON.stringify(events, null, 2)
                const blob = new Blob([json], { type: 'application/json' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `logs-${selectedSessionId}.json`
                a.click()
                URL.revokeObjectURL(url)
              }}
              title="Download logs as JSON"
              disabled={loading || !events}
            >
              <CloudDownload className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={scrollToBottom}
              title="Jump to bottom"
              disabled={loading}
            >
              <ArrowDownToLine className="h-3.5 w-3.5" />
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" title="Close">
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </div>
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
              <LoaderCircle className="h-6 w-6 animate-spin" />
              <span className="text-sm">Loading events...</span>
            </div>
          ) : readyEvents && readyEvents.length > 0 ? (
            <div className="divide-y divide-border/30">
              {readyEvents.map((event) => (
                <LogsRow
                  key={event.id}
                  event={event}
                  isCopied={copiedId === event.id}
                  hasMatch={matchedEventIds.has(event.id)}
                  onCopy={handleCopy}
                  registerPre={registerPre}
                />
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              No events
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
