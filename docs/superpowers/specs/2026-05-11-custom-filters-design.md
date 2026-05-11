# Unified Filters — Design Spec

**Status:** Draft
**Date:** 2026-05-11
**Related:** [GitHub issue #12](https://github.com/simple10/agents-observe/issues/12) — Auto-labeling system

## Summary

Replace the current hardcoded filter system (static categories defined in `app/client/src/config/filters.ts`, dynamic tool-name pills auto-derived inside `processEvent`) with a single user-configurable filter table. Every filter — including all the built-in categories that exist today — lives in the database as a row that can be enabled, disabled, duplicated, and edited. Users gain the ability to define their own filters via a regex-based editor in Settings. The shape of `EnrichedEvent.filterTags` changes accordingly.

This addresses the original request in issue #12 while solving a broader architectural goal: removing hardcoded filter logic from agent-class `processEvent` implementations.

## Goals

- Let users define new filters via a Settings UI, no code changes required.
- Expose every existing built-in filter (Prompts, Tools, Agents, Errors, Bash, Read, …) as a row in the same table so users can disable, customize-by-duplication, or reset them.
- Keep filter evaluation cheap: target a single regex test per filter per event, with `JSON.stringify(raw)` only when at least one enabled filter actually needs the stringified payload.
- Keep agent-class `processEvent` functions in full control of the final `event.filters` value — the shared matcher is a helper, not a mandate.

## Non-goals (v1)

- Auto-discovery of unseen tool names (this is a regression from current behavior; addressed via a future "auto-discover unseen tools" feature).
- Per-filter color customization (single violet accent for user filters, default styling for everything else).
- Filter sharing / export-import.
- Server-side evaluation. All matching is client-side; the server only stores filter definitions.

## Data model

### Server schema (SQLite)

```sql
CREATE TABLE filters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,                          -- settings-list label
  pill_name   TEXT NOT NULL,                          -- pill template; may contain {vars}
  display     TEXT NOT NULL CHECK(display IN ('primary','secondary')),
  combinator  TEXT NOT NULL CHECK(combinator IN ('and','or')) DEFAULT 'and',
  patterns    TEXT NOT NULL,                          -- JSON: Array<{target,regex}>
  kind        TEXT NOT NULL CHECK(kind IN ('default','user')),
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
```

No index on `name` (UI sorts in JS; the table is small).

### Shared TypeScript types

```ts
// app/server/src/types.ts (re-exported to client)
export type FilterTarget = 'hook' | 'tool' | 'payload'
export type FilterDisplay = 'primary' | 'secondary'
export type FilterCombinator = 'and' | 'or'
export type FilterKind = 'default' | 'user'

export interface FilterPattern {
  target: FilterTarget
  regex: string
}

export interface Filter {
  id: string
  name: string
  pillName: string
  display: FilterDisplay
  combinator: FilterCombinator
  patterns: FilterPattern[]
  kind: FilterKind
  enabled: boolean
  createdAt: number
  updatedAt: number
}
```

### Compiled form (client-only)

```ts
// app/client/src/lib/filters/types.ts
export interface CompiledFilter {
  id: string
  name: string
  pillName: string
  display: FilterDisplay
  combinator: FilterCombinator
  patterns: { target: FilterTarget; regex: RegExp }[]
}
```

Compilation happens once when filters load or change. Filters with an uncompilable regex are excluded from the compiled list (the editor flags them; the dashboard keeps running).

### EnrichedEvent change

```ts
// app/client/src/agents/types.ts
export interface EnrichedEvent {
  // …existing fields…
  filters: {
    primary: string[]      // replaces filterTags.static (was string | null)
    secondary: string[]    // replaces filterTags.dynamic (was string[])
  }
}
```

The field is renamed from `filterTags` to `filters` for clarity. Both arrays are always present (possibly empty). Multiple primary pills per event are now allowed (previously a single value).

## Matching algorithm

Single function. Pure. Used both during normal event processing and on rule-edit re-pass.

```ts
// app/client/src/lib/filters/matcher.ts
import type { RawEvent } from '@/agents/types'
import type { CompiledFilter } from './types'

const VAR_RE = /\{([a-zA-Z]+)\}/g

function resolveVar(name: string, raw: RawEvent, toolName: string | null): string | null {
  switch (name) {
    case 'hookName':    return raw.hookName ?? null
    case 'toolName':    return toolName ?? null
    case 'bashCommand':
      if (toolName !== 'Bash') return null
      const cmd = (raw.payload as any)?.tool_input?.command
      return typeof cmd === 'string' && cmd !== '' ? cmd : null
    default:            return null
  }
}

function resolvePillName(template: string, raw: RawEvent, toolName: string | null): string | null {
  if (!template.includes('{')) return template
  let nullSeen = false
  const out = template.replace(VAR_RE, (_, key) => {
    const v = resolveVar(key, raw, toolName)
    if (v == null) { nullSeen = true; return '' }
    return v
  })
  if (nullSeen) return null
  const trimmed = out.trim()
  return trimmed === '' ? null : trimmed
}

export function applyFilters(
  raw: RawEvent,
  toolName: string | null,
  compiled: readonly CompiledFilter[],
): { primary: string[]; secondary: string[] } {
  if (compiled.length === 0) return { primary: [], secondary: [] }

  let payloadText: string | null = null
  const getPayload = () => payloadText ?? (payloadText = JSON.stringify(raw))

  const primary: string[] = []
  const secondary: string[] = []

  for (const f of compiled) {
    const wantAll = f.combinator === 'and'
    let matched = wantAll
    for (const p of f.patterns) {
      const target = p.target === 'hook' ? (raw.hookName ?? '')
                  :  p.target === 'tool' ? (toolName ?? '')
                  :  getPayload()
      const hit = p.regex.test(target)
      if (wantAll && !hit)  { matched = false; break }
      if (!wantAll && hit)  { matched = true;  break }
    }
    if (!matched) continue

    const pillName = resolvePillName(f.pillName, raw, toolName)
    if (pillName == null) continue

    ;(f.display === 'primary' ? primary : secondary).push(pillName)
  }
  return { primary, secondary }
}
```

### Performance characteristics

- **Minimal allocation when `compiled.length === 0`** — early return with two empty arrays (callers expect mutable arrays so we don't share a frozen sentinel); no payload stringification, no loop body.
- **One `JSON.stringify(raw)` per event** at most, and only if some enabled filter's pattern uses `target='payload'`. Hook/Tool targets are sub-microsecond string comparisons.
- **Short-circuit per filter:** AND-combined patterns stop on first failure, OR-combined stop on first hit.
- **Variable resolution after patterns match** — pill-name templates are only resolved for events that actually matched, so unmatched events pay no string-replace cost.
- **Initial load of 10K events with ~15 filters:** estimated < 1s total based on JSON.stringify throughput. No targeted optimization needed until profiling demands it.

### Integration with `processEvent`

`processEvent` calls the matcher, assigns the result to `event.filters`, and is free to modify the result before returning:

```ts
function processEvent(raw, ctx): { event: EnrichedEvent } {
  // …existing enrichment…
  enriched.filters = applyFilters(raw, enriched.toolName, ctx.compiledFilters)
  // Custom agent classes can override/augment here.
  return { event: enriched }
}
```

`ProcessingContext` gains one new field:

```ts
interface ProcessingContext {
  // …existing fields…
  compiledFilters: readonly CompiledFilter[]
}
```

It's populated once per processing pass by the event-processing-context provider, which subscribes to the filter store.

### Rule-edit re-pass

When the user adds, edits, deletes, enables, disables, duplicates, or resets a filter, every in-memory enriched event needs its `event.filters` recomputed. The provider:

1. Recompiles filters (one pass over the `Filter[]` array → `CompiledFilter[]`).
2. For each enriched event, rebuilds a minimal `RawEvent` projection (`{ id, agentId, hookName, timestamp, payload }`), calls `applyFilters(...)`, assigns the result to `event.filters`.
3. Notifies subscribers (event bar + event stream).

This re-pass costs ~1 `JSON.stringify` per event when payload-target patterns exist, otherwise just hook/tool comparisons.

## Server: storage, routes, broadcast

### Storage adapter

Add to `app/server/src/storage/sqlite-adapter.ts`:

```ts
listFilters(): Filter[]
createFilter(input: Omit<Filter, 'id'|'createdAt'|'updatedAt'>): Filter
updateFilter(id: string, patch: Partial<Filter>): Filter
deleteFilter(id: string): void
duplicateFilter(id: string): Filter
resetDefaultFilters(): Filter[]    // re-applies seed values, preserves enabled
seedDefaultFilters(): void         // idempotent; called on server start
```

### REST routes

New file `app/server/src/routes/filters.ts`:

```
GET    /api/filters                       → Filter[]
POST   /api/filters                       → Filter            (kind='user' only)
PATCH  /api/filters/:id                   → Filter
DELETE /api/filters/:id                   → 204
POST   /api/filters/:id/duplicate         → Filter            (returns new user filter)
POST   /api/filters/defaults/reset        → Filter[]          (re-seeds defaults)
```

### Validation

- `name`, `pill_name`: required, non-empty, ≤ 100 chars.
- `patterns`: required, at least one entry; each pattern has a valid `target` and a regex that compiles via `new RegExp(...)`.
- `display`, `combinator`, `kind`: enum-checked.
- `kind`: not settable via POST (always `user`); not settable via PATCH (immutable per row).

### Mutation rules

| kind     | PATCH `enabled` | PATCH others | DELETE | Duplicate |
|----------|-----------------|--------------|--------|-----------|
| default  | ✅              | ❌ 403       | ❌ 403 | ✅        |
| user     | ✅              | ✅           | ✅     | ✅        |

### WebSocket broadcast

Extend the existing WebSocket message types so multi-tab and multi-client setups stay in sync:

```ts
type FilterMessage =
  | { type: 'filter:created'; filter: Filter }
  | { type: 'filter:updated'; filter: Filter }
  | { type: 'filter:deleted'; id: string }
  | { type: 'filter:bulk-changed' }   // sent after resetDefaultFilters() or initial seed sync
```

On `filter:bulk-changed`, clients re-fetch the full list. For the per-row events, clients upsert/remove locally without a refetch.

### Seed sync

`seedDefaultFilters()` runs every server start:

- Each default filter has a stable `id` written directly into the seed constant — for example `'default-agents'`, `'default-tools'`, `'default-dynamic-tool-name'`. This id is the row's primary key; renames or pattern changes update the same row, no orphans. User filter ids are server-generated UUIDs.
- For each prebuilt filter constant in `seed-filters.ts`:
  - If no row exists with that `id`, INSERT it (with `enabled = 1`).
  - If a row exists, UPDATE `name`, `pill_name`, `display`, `combinator`, `patterns`. **Never** touch `enabled`.
- Defaults that have been removed from the seed constant are left in place (they appear in the sidebar but are stale; an explicit migration removes them).

### Default filter seed (initial set)

Defined in `app/server/src/storage/seed-filters.ts`:

| name               | pill_name    | display  | combinator | patterns |
|--------------------|--------------|----------|------------|----------|
| Dynamic tool name  | `{toolName}` | secondary| and        | hook = `^(PreToolUse|PostToolUse|PostToolUseFailure|PostToolBatch)$` |
| Prompts            | `Prompts`    | primary  | and        | hook = `^(UserPromptSubmit|UserPromptExpansion)$` |
| Tools              | `Tools`      | primary  | and        | hook = `^(PreToolUse|PostToolUse|PostToolUseFailure|PostToolBatch)$` AND tool = `^(?!Agent$\|TaskCreate$\|TaskUpdate$\|mcp__).+` |
| Agents             | `Agents`     | primary  | or         | hook = `^(SubagentStart|TeammateIdle)$` OR tool = `^Agent$` |
| Tasks              | `Tasks`      | primary  | or         | hook = `^(TaskCreated|TaskCompleted)$` OR tool = `^Task(Create|Update)$` |
| MCP                | `MCP`        | primary  | or         | hook = `^(Elicitation|ElicitationResult)$` OR tool = `^mcp__` |
| Session            | `Session`    | primary  | and        | hook = `^(Setup|SessionStart|SessionEnd)$` |
| Permissions        | `Permissions`| primary  | and        | hook = `^PermissionRequest$` |
| Notifications      | `Notifications` | primary | and       | hook = `^Notification$` |
| Stop               | `Stop`       | primary  | and        | hook = `^(Stop|StopFailure|SubagentStop|stop_hook_summary)$` |
| Compaction         | `Compaction` | primary  | and        | hook = `^(PreCompact|PostCompact)$` |
| Config             | `Config`     | primary  | and        | hook = `^(InstructionsLoaded|ConfigChange|CwdChanged|FileChanged)$` |
| Errors             | `Errors`     | primary  | or         | payload = `"is_error":\s*true` OR payload = `"error":\s*"[^"]+` |

The "Dynamic tool name" filter collapses what was previously ~12 separate tool pills (Bash, Read, …) into one filter via the `{toolName}` variable.

## Client architecture

### New store: `app/client/src/stores/filter-store.ts`

```ts
interface FilterStore {
  filters: Filter[]
  compiled: readonly CompiledFilter[]
  loaded: boolean

  load(): Promise<void>
  create(input): Promise<Filter>
  update(id, patch): Promise<Filter>
  remove(id): Promise<void>
  duplicate(id): Promise<Filter>
  resetDefaults(): Promise<void>

  // Called by the WebSocket message handler
  upsertFromBroadcast(f: Filter): void
  removeFromBroadcast(id: string): void
  bulkChangedFromBroadcast(): Promise<void>   // triggers refetch
}
```

`compiled` is recomputed on every mutation that affects the filter set.

### `event-processing-context` wiring

Reads `compiled` from the filter store and passes it on `ProcessingContext.compiledFilters`. When `compiled` reference changes, runs the rule-edit re-pass against all in-memory enriched events.

### Filter bar (`app/client/src/components/main-panel/event-filter-bar.tsx`)

- Aggregate `event.filters.primary` across visible events → unique sorted set → render row 1.
- Aggregate `event.filters.secondary` → unique sorted set → render row 2.
- Pills that came from `kind='user'` filters get the violet accent + gear-icon prefix; pills from `kind='default'` filters keep the existing visual style. The bar reads from `filter-store.filters` to determine each pill's styling. When the same pill name is produced by both a user filter and a default filter, the **user style wins** so user-customized pills are always visually distinguishable.
- Click toggles `activePrimaryFilters` / `activeSecondaryFilters` in `ui-store`.

### UI store changes

- Rename `activeStaticFilters` → `activePrimaryFilters`.
- Rename `activeToolFilters` → `activeSecondaryFilters`.
- No localStorage migration required — the `sessionFilterStates` Map and the `activeStaticFilters`/`activeToolFilters` arrays are held in-memory only (verified at plan time).

### Event stream (`app/client/src/components/event-stream/event-stream.tsx`)

Extend the filter chain to intersect with `activePrimaryFilters` against `e.filters.primary` and `activeSecondaryFilters` against `e.filters.secondary`. Replace usage of `matchesStaticFilter` and `matchesDynamicFilter` from `app/client/src/config/filters.ts`.

### Settings UI: new "Filters" tab

New file: `app/client/src/components/settings/filters-tab.tsx`. Add tab trigger to `settings-modal.tsx`.

Layout (see mockup):

- **Left column** — two top-level tabs (Primary / Secondary), search input, two sections (User above, Default below), each row showing: name, pattern count badge, enabled checkbox.
- **Right column** — editor pane:
  - For user filters: editable Name, Pill Name, Display (Primary/Secondary), Combinator (AND/OR), ordered list of patterns each with target selector + regex input + remove button, + Add pattern button, Save / Cancel / Delete / Duplicate.
  - For default filters: read-only view of the same fields with Duplicate to customize + Reset buttons.
- **Live preview** — small green box showing "N matches across loaded events" computed by running the in-flight compiled filter against currently loaded enriched events. Debounced 300ms while typing.
- **Invalid regex** — red border + tooltip with the JS error message. Save disabled until valid.
- **New filter creation** — name and pill_name auto-mirror as the user types in name; auto-mirror stops as soon as the user edits pill_name.

### Migration / rollout

1. Add the new `filters` table + seed-filters logic + REST routes server-side. Existing `EnrichedEvent` shape unchanged.
2. Wire the matcher + store + processing-context on the client. `event.filters` field added alongside the still-present `event.filterTags`.
3. Update the filter bar and event stream to read from `event.filters` instead of `event.filterTags`. Acceptance: open an existing session, every pill that appeared before still appears and toggles its events identically. **Exception:** the Errors pill semantics shift from `event.status === 'failed'` (status-derived) to payload-content regex matching for `"is_error":true` or `"error":"…"`. Counts may differ slightly; this is expected and the new behavior is canonical.
4. Remove `getFilterTags`, `STATIC_FILTERS`, `matchesStaticFilter`, `matchesDynamicFilter`, and all auto-tool-derivation logic. Remove `event.filterTags` from the type. Update UI store rename.

This is roughly four small PRs that can each be reviewed and merged independently.

## Testing

- **`matcher.test.ts`** — empty rules return `{ primary: [], secondary: [] }`; AND combinator short-circuits on first fail; OR short-circuits on first hit; payload-target filters force one `JSON.stringify` and reuse it across remaining filters; pill-name variable substitution; null variable resolution skips the filter; flags like `(?i)` honored; invalid regex excluded at compile time.
- **`filter-store.test.ts`** — load, create, update, delete, duplicate, reset, broadcast upsert/remove, broadcast bulk-changed triggers refetch.
- **Server route tests** — happy path + validation; default-filter mutation 403s; duplicate behavior; reset preserves enabled.
- **One e2e in `filters-tab.test.tsx`** — type a regex, see the live "N matches" count change; create a filter and verify it appears in the filter bar.

## Open items (none blocking implementation)

- **Future: auto-discover unseen tools.** A future filter type that, when matched, auto-creates a user filter scoped to that toolName. Out of scope for v1.
- **Future: per-filter color.** Currently all user filter pills share one violet accent. A per-filter color picker is a v2 cosmetic.
- **Future: additional variables.** `{filePath}`, `{webUrl}`, `{webQuery}`, `{skill}`, `{agentType}`. Easy to add incrementally via the single `resolveVar` switch.
