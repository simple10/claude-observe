# Unified Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded filter system (static categories + auto-derived tool pills) with a user-configurable filter table seeded with all current built-in filters. Add a Filters editor in Settings.

**Architecture:** New `filters` table on the server holds both `default` (seeded) and `user` filters. A pure-function matcher `applyFilters(raw, toolName, compiled)` runs once per event inside each agent-class `processEvent` and returns `{ primary, secondary }`. The `EnrichedEvent.filterTags` field is renamed to `event.filters` and both arrays become `string[]`. Multiple filters can match the same event; pill name supports `{vars}` like `{toolName}` so one "Dynamic tool name" filter replaces ~12 per-tool prebuilts.

**Tech Stack:** TypeScript, Hono (server), better-sqlite3, Zustand (client), React, Vitest.

**Reference:** Design spec at `docs/superpowers/specs/2026-05-11-custom-filters-design.md`.

---

## File structure

### Server — new

- `app/server/src/storage/seed-filters.ts` — constant array of default filter definitions
- `app/server/src/routes/filters.ts` — REST routes
- `app/server/src/routes/filters.test.ts` — route tests

### Server — modified

- `app/server/src/types.ts` — add `Filter`, `FilterPattern`, etc.
- `app/server/src/storage/types.ts` — add method signatures to `EventStore`
- `app/server/src/storage/sqlite-adapter.ts` — table creation + CRUD methods + seed call
- `app/server/src/storage/sqlite-adapter.test.ts` — CRUD tests
- `app/server/src/app.ts` — register `filtersRouter`

### Client — new

- `app/client/src/lib/filters/types.ts` — `CompiledFilter`, helpers
- `app/client/src/lib/filters/matcher.ts` — `applyFilters`
- `app/client/src/lib/filters/matcher.test.ts`
- `app/client/src/lib/filters/compile.ts` — `compileFilters`
- `app/client/src/lib/filters/compile.test.ts`
- `app/client/src/stores/filter-store.ts` — Zustand store
- `app/client/src/stores/filter-store.test.ts`
- `app/client/src/components/settings/filters-tab.tsx` — editor UI
- `app/client/src/components/settings/filters-tab.test.tsx`

### Client — modified

- `app/client/src/types/index.ts` — add `Filter`/`FilterPattern` types; extend `WSMessage`
- `app/client/src/lib/api-client.ts` — add filter API methods
- `app/client/src/agents/types.ts` — rename `filterTags` → `filters`; add `compiledFilters` to `ProcessingContext`
- `app/client/src/agents/event-store.ts` — pass `compiledFilters` in ctx; detect rule changes
- `app/client/src/agents/event-processing-context.tsx` — subscribe to filter store
- `app/client/src/agents/claude-code/process-event.ts` — call `applyFilters` instead of `getFilterTags`
- `app/client/src/agents/default/index.tsx` — same (codex re-exports this — no separate codex edit needed)
- `app/client/src/components/main-panel/event-filter-bar.tsx` — read `event.filters`
- `app/client/src/components/event-stream/event-stream.tsx` — filter against `event.filters`
- `app/client/src/components/settings/settings-modal.tsx` — add Filters tab
- `app/client/src/stores/ui-store.ts` — rename `activeStaticFilters` → `activePrimaryFilters`, `activeToolFilters` → `activeSecondaryFilters`; one-time localStorage migration
- `app/client/src/hooks/use-websocket.ts` — handle `filter:*` messages

### Client — deleted (Phase 4 cleanup)

- `app/client/src/config/filters.ts` (replaced by the seeded defaults + lib/filters)

---

## Phase 1 — Server foundation

End state: server exposes filter CRUD + seed-on-startup. Existing client untouched.

### Task 1.1: Add shared Filter types to server `types.ts`

**Files:**
- Modify: `app/server/src/types.ts`

- [ ] **Step 1: Append type exports**

Add to the end of `app/server/src/types.ts`:

```ts
// === Filter types ===

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

export interface FilterRow {
  id: string
  name: string
  pill_name: string
  display: string
  combinator: string
  patterns: string // JSON
  kind: string
  enabled: number // 0/1
  created_at: number
  updated_at: number
}
```

- [ ] **Step 2: Commit**

```bash
git add app/server/src/types.ts
git commit -m "feat: add Filter types to server"
```

---

### Task 1.2: Add filter method signatures to `EventStore`

**Files:**
- Modify: `app/server/src/storage/types.ts`

- [ ] **Step 1: Import Filter type and add methods**

At the top of `app/server/src/storage/types.ts`:

```ts
import type { Filter } from '../types'
```

Append to the `EventStore` interface (before the closing `}`):

```ts
  // === Filters ===
  listFilters(): Promise<Filter[]>
  getFilterById(id: string): Promise<Filter | null>
  createFilter(input: {
    name: string
    pillName: string
    display: 'primary' | 'secondary'
    combinator: 'and' | 'or'
    patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
  }): Promise<Filter>
  updateFilter(
    id: string,
    patch: Partial<{
      name: string
      pillName: string
      display: 'primary' | 'secondary'
      combinator: 'and' | 'or'
      patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
      enabled: boolean
    }>,
  ): Promise<Filter>
  deleteFilter(id: string): Promise<void>
  duplicateFilter(id: string): Promise<Filter>
  resetDefaultFilters(): Promise<Filter[]>
  /** Idempotent. Inserts missing defaults; updates name/pill_name/display/combinator/patterns of existing rows; never touches enabled. */
  seedDefaultFilters(): Promise<void>
```

- [ ] **Step 2: Commit**

```bash
git add app/server/src/storage/types.ts
git commit -m "feat: declare filter methods on EventStore"
```

---

### Task 1.3: Create the seed-filters constant

**Files:**
- Create: `app/server/src/storage/seed-filters.ts`

- [ ] **Step 1: Write the constant**

Create `app/server/src/storage/seed-filters.ts`:

```ts
// Seed definitions for default filters. The `id` field is the stable
// primary key — never change an existing one or you'll create an
// orphan row. To rename or restructure a default filter, edit the
// fields in place and bump it via the next server start; the seed
// sync will UPDATE the row by id and preserve the user's enabled state.

import type { FilterPattern, FilterDisplay, FilterCombinator } from '../types'

export interface SeedFilter {
  id: string
  name: string
  pillName: string
  display: FilterDisplay
  combinator: FilterCombinator
  patterns: FilterPattern[]
}

export const SEED_FILTERS: SeedFilter[] = [
  {
    id: 'default-dynamic-tool-name',
    name: 'Dynamic tool name',
    pillName: '{toolName}',
    display: 'secondary',
    combinator: 'and',
    patterns: [
      { target: 'hook', regex: '^(PreToolUse|PostToolUse|PostToolUseFailure|PostToolBatch)$' },
    ],
  },
  {
    id: 'default-prompts',
    name: 'Prompts',
    pillName: 'Prompts',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^(UserPromptSubmit|UserPromptExpansion)$' }],
  },
  {
    id: 'default-tools',
    name: 'Tools',
    pillName: 'Tools',
    display: 'primary',
    combinator: 'and',
    patterns: [
      { target: 'hook', regex: '^(PreToolUse|PostToolUse|PostToolUseFailure|PostToolBatch)$' },
      { target: 'tool', regex: '^(?!Agent$|TaskCreate$|TaskUpdate$|mcp__).+' },
    ],
  },
  {
    id: 'default-agents',
    name: 'Agents',
    pillName: 'Agents',
    display: 'primary',
    combinator: 'or',
    patterns: [
      { target: 'hook', regex: '^(SubagentStart|TeammateIdle)$' },
      { target: 'tool', regex: '^Agent$' },
    ],
  },
  {
    id: 'default-tasks',
    name: 'Tasks',
    pillName: 'Tasks',
    display: 'primary',
    combinator: 'or',
    patterns: [
      { target: 'hook', regex: '^(TaskCreated|TaskCompleted)$' },
      { target: 'tool', regex: '^Task(Create|Update)$' },
    ],
  },
  {
    id: 'default-mcp',
    name: 'MCP',
    pillName: 'MCP',
    display: 'primary',
    combinator: 'or',
    patterns: [
      { target: 'hook', regex: '^(Elicitation|ElicitationResult)$' },
      { target: 'tool', regex: '^mcp__' },
    ],
  },
  {
    id: 'default-session',
    name: 'Session',
    pillName: 'Session',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^(Setup|SessionStart|SessionEnd)$' }],
  },
  {
    id: 'default-permissions',
    name: 'Permissions',
    pillName: 'Permissions',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^PermissionRequest$' }],
  },
  {
    id: 'default-notifications',
    name: 'Notifications',
    pillName: 'Notifications',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^Notification$' }],
  },
  {
    id: 'default-stop',
    name: 'Stop',
    pillName: 'Stop',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^(Stop|StopFailure|SubagentStop|stop_hook_summary)$' }],
  },
  {
    id: 'default-compaction',
    name: 'Compaction',
    pillName: 'Compaction',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '^(PreCompact|PostCompact)$' }],
  },
  {
    id: 'default-config',
    name: 'Config',
    pillName: 'Config',
    display: 'primary',
    combinator: 'and',
    patterns: [
      { target: 'hook', regex: '^(InstructionsLoaded|ConfigChange|CwdChanged|FileChanged)$' },
    ],
  },
  {
    id: 'default-errors',
    name: 'Errors',
    pillName: 'Errors',
    display: 'primary',
    combinator: 'or',
    patterns: [
      { target: 'payload', regex: '"is_error":\\s*true' },
      { target: 'payload', regex: '"error":\\s*"[^"]+' },
    ],
  },
]
```

- [ ] **Step 2: Commit**

```bash
git add app/server/src/storage/seed-filters.ts
git commit -m "feat: define default filter seed"
```

---

### Task 1.4: Add filter helpers + schema in `SqliteAdapter`

**Files:**
- Modify: `app/server/src/storage/sqlite-adapter.ts`

- [ ] **Step 1: Add table creation**

Insert the new `CREATE TABLE filters` block in `app/server/src/storage/sqlite-adapter.ts` **immediately before** the `// Create indexes` comment (currently at line 367 — confirm with `grep -n "// Create indexes" app/server/src/storage/sqlite-adapter.ts`).

```ts
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS filters (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        pill_name   TEXT NOT NULL,
        display     TEXT NOT NULL CHECK(display IN ('primary','secondary')),
        combinator  TEXT NOT NULL CHECK(combinator IN ('and','or')) DEFAULT 'and',
        patterns    TEXT NOT NULL,
        kind        TEXT NOT NULL CHECK(kind IN ('default','user')),
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      )
    `)
```

- [ ] **Step 2: Add row-to-Filter mapping helper**

Inside the `SqliteAdapter` class (private method, near the bottom, before the closing `}`):

```ts
  private rowToFilter(row: FilterRow): Filter {
    return {
      id: row.id,
      name: row.name,
      pillName: row.pill_name,
      display: row.display as 'primary' | 'secondary',
      combinator: row.combinator as 'and' | 'or',
      patterns: JSON.parse(row.patterns),
      kind: row.kind as 'default' | 'user',
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }
```

Also add two new imports at the top of `app/server/src/storage/sqlite-adapter.ts` (after the existing imports, in their own block):

```ts
import type { Filter, FilterRow, FilterPattern } from '../types'
import { randomUUID } from 'node:crypto'
```

- [ ] **Step 3: Run the build to make sure compilation passes**

```bash
just check 2>&1 | head -50
```

Expected: TypeScript compiles. (Unused-import warnings on the new symbols are fine for now — they'll get used in the next task.)

- [ ] **Step 4: Commit**

```bash
git add app/server/src/storage/sqlite-adapter.ts
git commit -m "feat: add filters table to SqliteAdapter"
```

---

### Task 1.5: Implement `listFilters` + `getFilterById` (TDD)

**Files:**
- Modify: `app/server/src/storage/sqlite-adapter.ts`
- Modify: `app/server/src/storage/sqlite-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `app/server/src/storage/sqlite-adapter.test.ts`:

```ts
describe('filters', () => {
  test('listFilters returns empty array when none exist', async () => {
    const adapter = new SqliteAdapter(':memory:')
    const filters = await adapter.listFilters()
    expect(filters).toEqual([])
  })

  test('getFilterById returns null for missing id', async () => {
    const adapter = new SqliteAdapter(':memory:')
    expect(await adapter.getFilterById('nope')).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app/server && npm test -- sqlite-adapter
```

Expected: FAIL — `listFilters is not a function` / similar.

- [ ] **Step 3: Implement the methods**

Add to `SqliteAdapter` class (anywhere among the other async methods):

```ts
  async listFilters(): Promise<Filter[]> {
    const rows = this.db
      .prepare('SELECT * FROM filters ORDER BY kind, name')
      .all() as FilterRow[]
    return rows.map((r) => this.rowToFilter(r))
  }

  async getFilterById(id: string): Promise<Filter | null> {
    const row = this.db.prepare('SELECT * FROM filters WHERE id = ?').get(id) as
      | FilterRow
      | undefined
    return row ? this.rowToFilter(row) : null
  }
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd app/server && npm test -- sqlite-adapter
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/storage/sqlite-adapter.ts app/server/src/storage/sqlite-adapter.test.ts
git commit -m "feat: list and get filters by id"
```

---

### Task 1.6: Implement `createFilter` + `deleteFilter` (TDD)

**Files:**
- Modify: `app/server/src/storage/sqlite-adapter.ts`
- Modify: `app/server/src/storage/sqlite-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the `describe('filters', ...)` block:

```ts
  test('createFilter inserts a user-kind row with a generated UUID', async () => {
    const adapter = new SqliteAdapter(':memory:')
    const f = await adapter.createFilter({
      name: 'task_completed',
      pillName: 'task_completed',
      display: 'primary',
      combinator: 'and',
      patterns: [{ target: 'hook', regex: '^Stop$' }],
    })
    expect(f.kind).toBe('user')
    expect(f.enabled).toBe(true)
    expect(f.id).toMatch(/^[0-9a-f-]{36}$/) // UUID
    expect((await adapter.listFilters()).length).toBe(1)
  })

  test('deleteFilter removes the row', async () => {
    const adapter = new SqliteAdapter(':memory:')
    const f = await adapter.createFilter({
      name: 'x',
      pillName: 'x',
      display: 'primary',
      combinator: 'and',
      patterns: [{ target: 'hook', regex: '.' }],
    })
    await adapter.deleteFilter(f.id)
    expect(await adapter.listFilters()).toEqual([])
  })
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd app/server && npm test -- sqlite-adapter
```

Expected: FAIL — `createFilter is not a function`.

- [ ] **Step 3: Implement the methods**

```ts
  async createFilter(input: {
    name: string
    pillName: string
    display: 'primary' | 'secondary'
    combinator: 'and' | 'or'
    patterns: FilterPattern[]
  }): Promise<Filter> {
    const id = randomUUID()
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO filters (id, name, pill_name, display, combinator, patterns, kind, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 1, ?, ?)`,
      )
      .run(
        id,
        input.name,
        input.pillName,
        input.display,
        input.combinator,
        JSON.stringify(input.patterns),
        now,
        now,
      )
    return (await this.getFilterById(id)) as Filter
  }

  async deleteFilter(id: string): Promise<void> {
    this.db.prepare('DELETE FROM filters WHERE id = ?').run(id)
  }
```

- [ ] **Step 4: Run the tests**

```bash
cd app/server && npm test -- sqlite-adapter
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/storage/sqlite-adapter.ts app/server/src/storage/sqlite-adapter.test.ts
git commit -m "feat: create and delete filters"
```

---

### Task 1.7: Implement `updateFilter` + `duplicateFilter` (TDD)

**Files:**
- Modify: `app/server/src/storage/sqlite-adapter.ts`
- Modify: `app/server/src/storage/sqlite-adapter.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
  test('updateFilter patches selected fields', async () => {
    const adapter = new SqliteAdapter(':memory:')
    const f = await adapter.createFilter({
      name: 'x',
      pillName: 'x',
      display: 'primary',
      combinator: 'and',
      patterns: [{ target: 'hook', regex: '.' }],
    })
    const updated = await adapter.updateFilter(f.id, { name: 'renamed', enabled: false })
    expect(updated.name).toBe('renamed')
    expect(updated.enabled).toBe(false)
    expect(updated.pillName).toBe('x') // untouched
  })

  test('duplicateFilter creates an independent user copy with "(copy)" suffix', async () => {
    const adapter = new SqliteAdapter(':memory:')
    const orig = await adapter.createFilter({
      name: 'orig',
      pillName: 'orig',
      display: 'primary',
      combinator: 'and',
      patterns: [{ target: 'hook', regex: '.' }],
    })
    const dup = await adapter.duplicateFilter(orig.id)
    expect(dup.id).not.toBe(orig.id)
    expect(dup.name).toBe('orig (copy)')
    expect(dup.pillName).toBe('orig')
    expect(dup.kind).toBe('user')
  })
```

- [ ] **Step 2: Run the tests to verify failure**

```bash
cd app/server && npm test -- sqlite-adapter
```

Expected: FAIL.

- [ ] **Step 3: Implement the methods**

```ts
  async updateFilter(
    id: string,
    patch: Partial<{
      name: string
      pillName: string
      display: 'primary' | 'secondary'
      combinator: 'and' | 'or'
      patterns: FilterPattern[]
      enabled: boolean
    }>,
  ): Promise<Filter> {
    const existing = await this.getFilterById(id)
    if (!existing) throw new Error(`filter ${id} not found`)
    const merged = {
      name: patch.name ?? existing.name,
      pillName: patch.pillName ?? existing.pillName,
      display: patch.display ?? existing.display,
      combinator: patch.combinator ?? existing.combinator,
      patterns: patch.patterns ?? existing.patterns,
      enabled: patch.enabled ?? existing.enabled,
    }
    this.db
      .prepare(
        `UPDATE filters
         SET name = ?, pill_name = ?, display = ?, combinator = ?, patterns = ?, enabled = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        merged.name,
        merged.pillName,
        merged.display,
        merged.combinator,
        JSON.stringify(merged.patterns),
        merged.enabled ? 1 : 0,
        Date.now(),
        id,
      )
    return (await this.getFilterById(id)) as Filter
  }

  async duplicateFilter(id: string): Promise<Filter> {
    const orig = await this.getFilterById(id)
    if (!orig) throw new Error(`filter ${id} not found`)
    return await this.createFilter({
      name: `${orig.name} (copy)`,
      pillName: orig.pillName,
      display: orig.display,
      combinator: orig.combinator,
      patterns: orig.patterns,
    })
  }
```

- [ ] **Step 4: Run the tests**

```bash
cd app/server && npm test -- sqlite-adapter
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/storage/sqlite-adapter.ts app/server/src/storage/sqlite-adapter.test.ts
git commit -m "feat: update and duplicate filters"
```

---

### Task 1.8: Implement `seedDefaultFilters` + `resetDefaultFilters` (TDD)

**Files:**
- Modify: `app/server/src/storage/sqlite-adapter.ts`
- Modify: `app/server/src/storage/sqlite-adapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
  test('seedDefaultFilters inserts all seeds and preserves enabled on subsequent runs', async () => {
    const adapter = new SqliteAdapter(':memory:')
    await adapter.seedDefaultFilters()
    const first = await adapter.listFilters()
    expect(first.length).toBeGreaterThan(5)
    expect(first.every((f) => f.kind === 'default' && f.enabled === true)).toBe(true)

    // Disable one
    const target = first[0]
    await adapter.updateFilter(target.id, { enabled: false })

    // Re-run seed — should NOT re-enable
    await adapter.seedDefaultFilters()
    const second = await adapter.getFilterById(target.id)
    expect(second?.enabled).toBe(false)
  })

  test('resetDefaultFilters reapplies seed content but preserves enabled', async () => {
    const adapter = new SqliteAdapter(':memory:')
    await adapter.seedDefaultFilters()
    const before = (await adapter.listFilters())[0]
    await adapter.updateFilter(before.id, { name: 'mutated', enabled: false })

    await adapter.resetDefaultFilters()
    const after = await adapter.getFilterById(before.id)
    expect(after?.name).not.toBe('mutated') // seed name restored
    expect(after?.enabled).toBe(false) // enabled preserved
  })
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd app/server && npm test -- sqlite-adapter
```

Expected: FAIL.

- [ ] **Step 3: Add the import for SEED_FILTERS**

At the top of `sqlite-adapter.ts` (with other imports):

```ts
import { SEED_FILTERS } from './seed-filters'
```

- [ ] **Step 4: Implement the methods**

```ts
  async seedDefaultFilters(): Promise<void> {
    const insert = this.db.prepare(
      `INSERT INTO filters (id, name, pill_name, display, combinator, patterns, kind, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'default', 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         pill_name = excluded.pill_name,
         display = excluded.display,
         combinator = excluded.combinator,
         patterns = excluded.patterns,
         updated_at = excluded.updated_at`,
      // NB: `enabled` and `created_at` deliberately omitted from the UPDATE
      // so user toggles survive seed sync and the original created_at sticks.
    )
    const now = Date.now()
    const tx = this.db.transaction(() => {
      for (const s of SEED_FILTERS) {
        insert.run(
          s.id,
          s.name,
          s.pillName,
          s.display,
          s.combinator,
          JSON.stringify(s.patterns),
          now, // created_at — only used on insert; UPDATE ignores
          now,
        )
      }
    })
    tx()
  }

  async resetDefaultFilters(): Promise<Filter[]> {
    // Re-runs the same idempotent upsert as seed.
    await this.seedDefaultFilters()
    return (await this.listFilters()).filter((f) => f.kind === 'default')
  }
```

- [ ] **Step 5: Run tests**

```bash
cd app/server && npm test -- sqlite-adapter
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/server/src/storage/sqlite-adapter.ts app/server/src/storage/sqlite-adapter.test.ts
git commit -m "feat: seed and reset default filters"
```

---

### Task 1.9: Run seed on server start

**Files:**
- Modify: `app/server/src/storage/sqlite-adapter.ts`

- [ ] **Step 1: Add the `runSeedDefaults` private method and route `seedDefaultFilters` through it**

Inside the `SqliteAdapter` class (anywhere among the other methods), add:

```ts
  private runSeedDefaults(): void {
    const insert = this.db.prepare(
      `INSERT INTO filters (id, name, pill_name, display, combinator, patterns, kind, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'default', 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         pill_name = excluded.pill_name,
         display = excluded.display,
         combinator = excluded.combinator,
         patterns = excluded.patterns,
         updated_at = excluded.updated_at`,
    )
    const now = Date.now()
    const tx = this.db.transaction(() => {
      for (const s of SEED_FILTERS) {
        insert.run(
          s.id, s.name, s.pillName, s.display, s.combinator,
          JSON.stringify(s.patterns), now, now,
        )
      }
    })
    tx()
  }
```

Then replace the existing `seedDefaultFilters()` body that Task 1.8 added with a one-liner:

```ts
  async seedDefaultFilters(): Promise<void> {
    this.runSeedDefaults()
  }
```

- [ ] **Step 2: Call `runSeedDefaults` at the end of the constructor**

In the `SqliteAdapter` constructor, add `this.runSeedDefaults()` as the **very last statement before the closing `}`** of the constructor (after every `CREATE TABLE`, every migration block, and every `CREATE INDEX` statement). The constructor ends around line 390 — confirm with `grep -n "^  }" app/server/src/storage/sqlite-adapter.ts | head -3`.

```ts
    // …at the very end of the constructor body…
    this.runSeedDefaults()
```

- [ ] **Step 3: Run tests**

```bash
cd app/server && npm test -- sqlite-adapter
```

Expected: PASS — all earlier seed/reset tests still pass.

- [ ] **Step 4: Commit**

```bash
git add app/server/src/storage/sqlite-adapter.ts
git commit -m "feat: seed default filters on server start"
```

---

### Task 1.10: Build filters REST routes (TDD)

**Files:**
- Create: `app/server/src/routes/filters.ts`
- Create: `app/server/src/routes/filters.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/server/src/routes/filters.test.ts`:

```ts
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
    broadcastToAll: (msg: object) => void
  }
}

describe('filter routes', () => {
  let app: Hono<Env>
  const broadcasts: object[] = []
  const mockStore = {
    listFilters: vi.fn(),
    getFilterById: vi.fn(),
    createFilter: vi.fn(),
    updateFilter: vi.fn(),
    deleteFilter: vi.fn(),
    duplicateFilter: vi.fn(),
    resetDefaultFilters: vi.fn(),
  }

  beforeEach(async () => {
    vi.resetModules()
    broadcasts.length = 0
    Object.values(mockStore).forEach((fn) => fn.mockReset())

    vi.doMock('../config', () => ({ config: { logLevel: 'error' } }))
    const { default: filtersRouter } = await import('./filters')
    app = new Hono<Env>()
    app.use('*', async (c, next) => {
      c.set('store', mockStore as unknown as EventStore)
      c.set('broadcastToAll', (msg) => broadcasts.push(msg))
      await next()
    })
    app.route('/api', filtersRouter)
  })

  test('GET /api/filters returns the list', async () => {
    mockStore.listFilters.mockResolvedValue([])
    const res = await app.request('/api/filters')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })

  test('POST /api/filters with valid body creates a user filter', async () => {
    mockStore.createFilter.mockResolvedValue({ id: 'f1', kind: 'user' })
    const res = await app.request('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x',
        pillName: 'x',
        display: 'primary',
        combinator: 'and',
        patterns: [{ target: 'hook', regex: '.' }],
      }),
    })
    expect(res.status).toBe(201)
    expect(mockStore.createFilter).toHaveBeenCalled()
    expect(broadcasts).toContainEqual({ type: 'filter:created', filter: { id: 'f1', kind: 'user' } })
  })

  test('POST /api/filters rejects empty name', async () => {
    const res = await app.request('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '',
        pillName: 'x',
        display: 'primary',
        combinator: 'and',
        patterns: [{ target: 'hook', regex: '.' }],
      }),
    })
    expect(res.status).toBe(400)
  })

  test('POST /api/filters rejects invalid regex', async () => {
    const res = await app.request('/api/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'x',
        pillName: 'x',
        display: 'primary',
        combinator: 'and',
        patterns: [{ target: 'hook', regex: '(' }],
      }),
    })
    expect(res.status).toBe(400)
  })

  test('PATCH /api/filters/:id on default rejects non-enabled fields', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'd1', kind: 'default', enabled: true })
    const res = await app.request('/api/filters/d1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'changed' }),
    })
    expect(res.status).toBe(403)
  })

  test('PATCH /api/filters/:id on default accepts enabled toggle', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'd1', kind: 'default', enabled: true })
    mockStore.updateFilter.mockResolvedValue({ id: 'd1', enabled: false, kind: 'default' })
    const res = await app.request('/api/filters/d1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
  })

  test('DELETE /api/filters/:id on default returns 403', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'd1', kind: 'default' })
    const res = await app.request('/api/filters/d1', { method: 'DELETE' })
    expect(res.status).toBe(403)
  })

  test('DELETE /api/filters/:id on user returns 204', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'u1', kind: 'user' })
    mockStore.deleteFilter.mockResolvedValue(undefined)
    const res = await app.request('/api/filters/u1', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(broadcasts).toContainEqual({ type: 'filter:deleted', id: 'u1' })
  })

  test('POST /api/filters/:id/duplicate creates user copy', async () => {
    mockStore.getFilterById.mockResolvedValue({ id: 'd1', kind: 'default' })
    mockStore.duplicateFilter.mockResolvedValue({ id: 'u2', kind: 'user' })
    const res = await app.request('/api/filters/d1/duplicate', { method: 'POST' })
    expect(res.status).toBe(201)
    expect(broadcasts).toContainEqual({ type: 'filter:created', filter: { id: 'u2', kind: 'user' } })
  })

  test('POST /api/filters/defaults/reset broadcasts bulk change', async () => {
    mockStore.resetDefaultFilters.mockResolvedValue([])
    const res = await app.request('/api/filters/defaults/reset', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(broadcasts).toContainEqual({ type: 'filter:bulk-changed' })
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

```bash
cd app/server && npm test -- routes/filters
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the route module**

Create `app/server/src/routes/filters.ts`:

```ts
import { Hono } from 'hono'
import type { EventStore } from '../storage/types'
import type { Filter } from '../types'
import { apiError } from '../errors'

type Env = {
  Variables: {
    store: EventStore
    broadcastToAll: (msg: object) => void
  }
}

const router = new Hono<Env>()

const MAX_NAME = 100
const ALLOWED_TARGETS = new Set(['hook', 'tool', 'payload'])
const ALLOWED_DISPLAY = new Set(['primary', 'secondary'])
const ALLOWED_COMBINATOR = new Set(['and', 'or'])

interface ValidatedInput {
  name: string
  pillName: string
  display: 'primary' | 'secondary'
  combinator: 'and' | 'or'
  patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
}

function validateInput(body: any): { ok: true; value: ValidatedInput } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'Invalid body' }
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name) return { ok: false, reason: 'name must not be empty' }
  if (name.length > MAX_NAME) return { ok: false, reason: `name must be ${MAX_NAME} chars or fewer` }
  const pillName = typeof body.pillName === 'string' ? body.pillName.trim() : ''
  if (!pillName) return { ok: false, reason: 'pillName must not be empty' }
  if (pillName.length > MAX_NAME) return { ok: false, reason: `pillName must be ${MAX_NAME} chars or fewer` }
  if (!ALLOWED_DISPLAY.has(body.display)) return { ok: false, reason: 'display must be primary or secondary' }
  if (!ALLOWED_COMBINATOR.has(body.combinator)) return { ok: false, reason: 'combinator must be and or or' }
  if (!Array.isArray(body.patterns) || body.patterns.length === 0)
    return { ok: false, reason: 'patterns must be a non-empty array' }
  for (const p of body.patterns) {
    if (!p || !ALLOWED_TARGETS.has(p.target))
      return { ok: false, reason: 'each pattern target must be hook, tool, or payload' }
    if (typeof p.regex !== 'string' || p.regex === '')
      return { ok: false, reason: 'each pattern regex must be a non-empty string' }
    try {
      new RegExp(p.regex)
    } catch (e) {
      return { ok: false, reason: `invalid regex: ${(e as Error).message}` }
    }
  }
  return { ok: true, value: { name, pillName, display: body.display, combinator: body.combinator, patterns: body.patterns } }
}

router.get('/filters', async (c) => {
  const store = c.get('store')
  return c.json(await store.listFilters())
})

router.post('/filters', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  let body: any
  try {
    body = await c.req.json()
  } catch {
    return apiError(c, 400, 'Invalid JSON body')
  }
  const v = validateInput(body)
  if (!v.ok) return apiError(c, 400, v.reason)
  const filter = await store.createFilter(v.value)
  broadcast({ type: 'filter:created', filter })
  return c.json(filter, 201)
})

router.patch('/filters/:id', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  const id = c.req.param('id')
  const existing = await store.getFilterById(id)
  if (!existing) return apiError(c, 404, 'filter not found')

  let body: any
  try {
    body = await c.req.json()
  } catch {
    return apiError(c, 400, 'Invalid JSON body')
  }
  if (!body || typeof body !== 'object') return apiError(c, 400, 'Invalid body')

  const patch: Record<string, unknown> = {}
  if (existing.kind === 'default') {
    // Default filters only allow toggling enabled.
    const otherKeys = Object.keys(body).filter((k) => k !== 'enabled')
    if (otherKeys.length > 0) {
      return apiError(c, 403, `default filters allow only 'enabled' to be patched`)
    }
    if (typeof body.enabled !== 'boolean') return apiError(c, 400, 'enabled must be boolean')
    patch.enabled = body.enabled
  } else {
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim() === '')
        return apiError(c, 400, 'name must not be empty')
      patch.name = body.name.trim()
    }
    if (body.pillName !== undefined) {
      if (typeof body.pillName !== 'string' || body.pillName.trim() === '')
        return apiError(c, 400, 'pillName must not be empty')
      patch.pillName = body.pillName.trim()
    }
    if (body.display !== undefined) {
      if (!ALLOWED_DISPLAY.has(body.display)) return apiError(c, 400, 'invalid display')
      patch.display = body.display
    }
    if (body.combinator !== undefined) {
      if (!ALLOWED_COMBINATOR.has(body.combinator)) return apiError(c, 400, 'invalid combinator')
      patch.combinator = body.combinator
    }
    if (body.patterns !== undefined) {
      const stub = { ...existing, ...body }
      const v = validateInput(stub)
      if (!v.ok) return apiError(c, 400, v.reason)
      patch.patterns = v.value.patterns
    }
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') return apiError(c, 400, 'enabled must be boolean')
      patch.enabled = body.enabled
    }
    if (body.kind !== undefined) return apiError(c, 400, 'kind is immutable')
  }

  const filter = await store.updateFilter(id, patch as any)
  broadcast({ type: 'filter:updated', filter })
  return c.json(filter)
})

router.delete('/filters/:id', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  const id = c.req.param('id')
  const existing = await store.getFilterById(id)
  if (!existing) return apiError(c, 404, 'filter not found')
  if (existing.kind === 'default') return apiError(c, 403, 'default filters cannot be deleted')
  await store.deleteFilter(id)
  broadcast({ type: 'filter:deleted', id })
  return c.body(null, 204)
})

router.post('/filters/:id/duplicate', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  const id = c.req.param('id')
  const existing = await store.getFilterById(id)
  if (!existing) return apiError(c, 404, 'filter not found')
  const filter = await store.duplicateFilter(id)
  broadcast({ type: 'filter:created', filter })
  return c.json(filter, 201)
})

router.post('/filters/defaults/reset', async (c) => {
  const store = c.get('store')
  const broadcast = c.get('broadcastToAll')
  const filters = await store.resetDefaultFilters()
  broadcast({ type: 'filter:bulk-changed' })
  return c.json(filters)
})

export default router
```

- [ ] **Step 4: Run the test**

```bash
cd app/server && npm test -- routes/filters
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/server/src/routes/filters.ts app/server/src/routes/filters.test.ts
git commit -m "feat: REST routes for filters"
```

---

### Task 1.11: Register filters router in `app.ts`

**Files:**
- Modify: `app/server/src/app.ts`

- [ ] **Step 1: Add import + route**

In `app/server/src/app.ts`, after the existing `import …Router` lines (around line 19), add:

```ts
import filtersRouter from './routes/filters'
```

After the last `app.route('/api', xRouter)` line (~line 58), add:

```ts
  app.route('/api', filtersRouter)
```

- [ ] **Step 2: Run server tests**

```bash
cd app/server && npm test
```

Expected: PASS (all existing + new).

- [ ] **Step 3: Commit**

```bash
git add app/server/src/app.ts
git commit -m "feat: register filters router"
```

---

## Phase 2 — Client matcher

End state: pure-function matcher implemented and tested in `lib/filters`. Not yet wired into the agent pipeline.

### Task 2.1: Create client filter types

**Files:**
- Create: `app/client/src/lib/filters/types.ts`

- [ ] **Step 1: Write the types**

```ts
// Defined inline so the matcher module compiles in isolation,
// before Task 3.1 adds the same union types to @/types. Task 3.1
// will re-export these from @/types so the shapes stay aligned.

export type FilterTarget = 'hook' | 'tool' | 'payload'
export type FilterDisplay = 'primary' | 'secondary'
export type FilterCombinator = 'and' | 'or'
export type FilterKind = 'default' | 'user'

export interface CompiledPattern {
  target: FilterTarget
  regex: RegExp
}

export interface CompiledFilter {
  id: string
  name: string
  pillName: string
  display: FilterDisplay
  combinator: FilterCombinator
  patterns: CompiledPattern[]
}
```

- [ ] **Step 2: Commit**

```bash
git add app/client/src/lib/filters/types.ts
git commit -m "feat: client filter types"
```

---

### Task 2.2: Implement `applyFilters` (TDD)

**Files:**
- Create: `app/client/src/lib/filters/matcher.ts`
- Create: `app/client/src/lib/filters/matcher.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/client/src/lib/filters/matcher.test.ts`:

```ts
import { describe, test, expect, vi } from 'vitest'
import { applyFilters } from './matcher'
import type { CompiledFilter } from './types'

function compile(opts: {
  name: string
  pillName?: string
  display?: 'primary' | 'secondary'
  combinator?: 'and' | 'or'
  patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
}): CompiledFilter {
  return {
    id: opts.name,
    name: opts.name,
    pillName: opts.pillName ?? opts.name,
    display: opts.display ?? 'primary',
    combinator: opts.combinator ?? 'and',
    patterns: opts.patterns.map((p) => ({ target: p.target, regex: new RegExp(p.regex) })),
  }
}

const baseRaw = {
  id: 1,
  agentId: 'a',
  hookName: 'PostToolUse',
  timestamp: 0,
  payload: { tool_input: { command: 'ls' } },
}

describe('applyFilters', () => {
  test('returns empty when no compiled filters', () => {
    expect(applyFilters(baseRaw, 'Bash', [])).toEqual({ primary: [], secondary: [] })
  })

  test('hook-target match emits a primary pill', () => {
    const f = compile({ name: 'Hook', patterns: [{ target: 'hook', regex: '^PostToolUse$' }] })
    expect(applyFilters(baseRaw, 'Bash', [f])).toEqual({ primary: ['Hook'], secondary: [] })
  })

  test('AND combinator requires all patterns', () => {
    const f = compile({
      name: 'AndCase',
      combinator: 'and',
      patterns: [
        { target: 'hook', regex: '^PostToolUse$' },
        { target: 'tool', regex: '^Read$' },
      ],
    })
    // toolName=Bash; second pattern fails
    expect(applyFilters(baseRaw, 'Bash', [f]).primary).toEqual([])
    expect(applyFilters(baseRaw, 'Read', [f]).primary).toEqual(['AndCase'])
  })

  test('OR combinator passes on first match', () => {
    const f = compile({
      name: 'OrCase',
      combinator: 'or',
      patterns: [
        { target: 'hook', regex: '^Nope$' },
        { target: 'tool', regex: '^Bash$' },
      ],
    })
    expect(applyFilters(baseRaw, 'Bash', [f]).primary).toEqual(['OrCase'])
  })

  test('payload-target triggers JSON.stringify once and is reused', () => {
    const f1 = compile({ name: 'Cmd', patterns: [{ target: 'payload', regex: 'ls' }] })
    const f2 = compile({ name: 'Cmd2', patterns: [{ target: 'payload', regex: 'tool_input' }] })
    const out = applyFilters(baseRaw, 'Bash', [f1, f2])
    expect(out.primary.sort()).toEqual(['Cmd', 'Cmd2'])
  })

  test('payload-target is skipped when no rule needs it', () => {
    const spy = vi.spyOn(JSON, 'stringify')
    const f = compile({ name: 'Hook', patterns: [{ target: 'hook', regex: '.' }] })
    const before = spy.mock.calls.length
    applyFilters(baseRaw, 'Bash', [f])
    const after = spy.mock.calls.length
    expect(after).toBe(before)
    spy.mockRestore()
  })

  test('pillName template {toolName} resolves per event', () => {
    const f = compile({
      name: 'AnyTool',
      pillName: '{toolName}',
      display: 'secondary',
      patterns: [{ target: 'hook', regex: '^PostToolUse$' }],
    })
    expect(applyFilters(baseRaw, 'Bash', [f])).toEqual({ primary: [], secondary: ['Bash'] })
    expect(applyFilters(baseRaw, 'Read', [f])).toEqual({ primary: [], secondary: ['Read'] })
  })

  test('filter is skipped when pillName variable is null', () => {
    const f = compile({
      name: 'BashOnly',
      pillName: '{bashCommand}',
      patterns: [{ target: 'hook', regex: '^PostToolUse$' }],
    })
    expect(applyFilters({ ...baseRaw, payload: {} }, 'Read', [f]).primary).toEqual([])
  })

  test('bashCommand variable resolves only when toolName is Bash', () => {
    const f = compile({
      name: 'Cmd',
      pillName: '{bashCommand}',
      display: 'secondary',
      patterns: [{ target: 'tool', regex: '^Bash$' }],
    })
    expect(applyFilters(baseRaw, 'Bash', [f])).toEqual({ primary: [], secondary: ['ls'] })
  })

  test('literal pillName (no template) always resolves', () => {
    const f = compile({ name: 'Always', patterns: [{ target: 'hook', regex: '.' }] })
    expect(applyFilters(baseRaw, null, [f]).primary).toEqual(['Always'])
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

```bash
cd app/client && npm test -- lib/filters/matcher
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the matcher**

Create `app/client/src/lib/filters/matcher.ts`:

```ts
import type { RawEvent } from '@/agents/types'
import type { CompiledFilter } from './types'

const VAR_RE = /\{([a-zA-Z]+)\}/g

function resolveVar(name: string, raw: RawEvent, toolName: string | null): string | null {
  switch (name) {
    case 'hookName':
      return raw.hookName ?? null
    case 'toolName':
      return toolName ?? null
    case 'bashCommand': {
      if (toolName !== 'Bash') return null
      const cmd = (raw.payload as Record<string, any>)?.tool_input?.command
      return typeof cmd === 'string' && cmd !== '' ? cmd : null
    }
    default:
      return null
  }
}

function resolvePillName(
  template: string,
  raw: RawEvent,
  toolName: string | null,
): string | null {
  if (!template.includes('{')) return template
  let nullSeen = false
  const out = template.replace(VAR_RE, (_, key) => {
    const v = resolveVar(key, raw, toolName)
    if (v == null) {
      nullSeen = true
      return ''
    }
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
      const target =
        p.target === 'hook'
          ? (raw.hookName ?? '')
          : p.target === 'tool'
            ? (toolName ?? '')
            : getPayload()
      const hit = p.regex.test(target)
      if (wantAll && !hit) {
        matched = false
        break
      }
      if (!wantAll && hit) {
        matched = true
        break
      }
    }
    if (!matched) continue

    const pillName = resolvePillName(f.pillName, raw, toolName)
    if (pillName == null) continue

    ;(f.display === 'primary' ? primary : secondary).push(pillName)
  }
  return { primary, secondary }
}
```

- [ ] **Step 4: Run the test**

```bash
cd app/client && npm test -- lib/filters/matcher
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/lib/filters/matcher.ts app/client/src/lib/filters/matcher.test.ts
git commit -m "feat: applyFilters matcher with pill-name templating"
```

---

### Task 2.3: Implement `compileFilters` (TDD)

**Files:**
- Create: `app/client/src/lib/filters/compile.ts`
- Create: `app/client/src/lib/filters/compile.test.ts`

- [ ] **Step 1: Write the failing test**

Create `app/client/src/lib/filters/compile.test.ts`:

```ts
import { describe, test, expect } from 'vitest'
import { compileFilters } from './compile'
import type { Filter } from '@/types'

function f(opts: Partial<Filter>): Filter {
  return {
    id: 'id',
    name: 'name',
    pillName: 'pill',
    display: 'primary',
    combinator: 'and',
    patterns: [{ target: 'hook', regex: '.' }],
    kind: 'user',
    enabled: true,
    createdAt: 0,
    updatedAt: 0,
    ...opts,
  }
}

describe('compileFilters', () => {
  test('skips disabled filters', () => {
    const out = compileFilters([f({ enabled: false })])
    expect(out).toEqual([])
  })

  test('compiles regexes from string patterns', () => {
    const out = compileFilters([f({ patterns: [{ target: 'hook', regex: '^x$' }] })])
    expect(out.length).toBe(1)
    expect(out[0].patterns[0].regex).toBeInstanceOf(RegExp)
    expect(out[0].patterns[0].regex.test('x')).toBe(true)
  })

  test('skips filters with an invalid regex', () => {
    const out = compileFilters([f({ patterns: [{ target: 'hook', regex: '(' }] })])
    expect(out).toEqual([])
  })

  test('preserves order of input filters', () => {
    const a = f({ id: 'a', name: 'a' })
    const b = f({ id: 'b', name: 'b' })
    const out = compileFilters([a, b])
    expect(out.map((c) => c.id)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

```bash
cd app/client && npm test -- lib/filters/compile
```

Expected: FAIL.

- [ ] **Step 3: Implement compileFilters**

Create `app/client/src/lib/filters/compile.ts`:

```ts
import type { Filter } from '@/types'
import type { CompiledFilter, CompiledPattern } from './types'

export function compileFilters(filters: readonly Filter[]): CompiledFilter[] {
  const out: CompiledFilter[] = []
  for (const f of filters) {
    if (!f.enabled) continue
    const patterns: CompiledPattern[] = []
    let ok = true
    for (const p of f.patterns) {
      try {
        patterns.push({ target: p.target, regex: new RegExp(p.regex) })
      } catch {
        ok = false
        break
      }
    }
    if (!ok) continue
    out.push({
      id: f.id,
      name: f.name,
      pillName: f.pillName,
      display: f.display,
      combinator: f.combinator,
      patterns,
    })
  }
  return out
}
```

- [ ] **Step 4: Run the test**

```bash
cd app/client && npm test -- lib/filters/compile
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/lib/filters/compile.ts app/client/src/lib/filters/compile.test.ts
git commit -m "feat: compileFilters helper"
```

---

## Phase 3 — Client store and API

End state: client has a `filter-store` that loads filters from the server, listens for WS broadcasts, and exposes mutations. Not yet wired into the event pipeline.

### Task 3.1: Add shared types + WS messages to client `types/index.ts`

**Files:**
- Modify: `app/client/src/types/index.ts`

- [ ] **Step 1: Append types**

Append (just before the final blank line). Re-exports the unions from `lib/filters/types.ts` (defined in Task 2.1) so the two modules can't drift apart:

```ts

// === Filters (mirror server shape) ===

export type {
  FilterTarget,
  FilterDisplay,
  FilterCombinator,
  FilterKind,
} from '@/lib/filters/types'
import type {
  FilterTarget,
  FilterDisplay,
  FilterCombinator,
  FilterKind,
} from '@/lib/filters/types'

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

- [ ] **Step 2: Extend `WSMessage` union**

Edit the existing `WSMessage` declaration (around line 151) to add 4 new cases:

```ts
export type WSMessage =
  | { type: 'event'; data: WSEventBroadcast }
  | { type: 'session_update'; data: Session }
  | { type: 'project_update'; data: { id: number; name: string } }
  | { type: 'notification'; data: { sessionId: string; projectId: number; ts: number } }
  | { type: 'notification_clear'; data: { sessionId: string; ts: number } }
  | {
      type: 'activity'
      data: { sessionId: string; projectId: number | null; eventId: number; ts: number }
    }
  | { type: 'filter:created'; filter: Filter }
  | { type: 'filter:updated'; filter: Filter }
  | { type: 'filter:deleted'; id: string }
  | { type: 'filter:bulk-changed' }
```

- [ ] **Step 3: Run client tests to make sure nothing broke**

```bash
cd app/client && npm test 2>&1 | tail -20
```

Expected: PASS (matcher tests still pass since types now align).

- [ ] **Step 4: Commit**

```bash
git add app/client/src/types/index.ts
git commit -m "feat: client Filter + WS filter message types"
```

---

### Task 3.2: Add filter API methods to api-client

**Files:**
- Modify: `app/client/src/lib/api-client.ts`

- [ ] **Step 1: Add the import**

Add `Filter` to the existing `@/types` import block at the top of the file:

```ts
import type {
  Project,
  Session,
  RecentSession,
  ServerAgent,
  ParsedEvent,
  NotificationPayload,
  Filter,
} from '@/types'
```

- [ ] **Step 2: Append filter methods inside the `api` object**

The existing `bulkDeleteSessions: …` entry (around line 193) currently ends with `})` (no trailing comma) followed by the closing `}` of the `api` object on the next line. Add a trailing comma after the `})` so the new entries can be appended cleanly, then insert the new entries before the closing `}`:

```ts
  // ↑ existing bulkDeleteSessions: …}),
  listFilters: () => fetchJson<Filter[]>('/filters'),
  createFilter: (input: {
    name: string
    pillName: string
    display: 'primary' | 'secondary'
    combinator: 'and' | 'or'
    patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
  }) =>
    fetchJson<Filter>('/filters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }),
  updateFilter: (
    id: string,
    patch: Partial<{
      name: string
      pillName: string
      display: 'primary' | 'secondary'
      combinator: 'and' | 'or'
      patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
      enabled: boolean
    }>,
  ) =>
    fetchJson<Filter>(`/filters/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  deleteFilter: (id: string) =>
    fetchVoid(`/filters/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  duplicateFilter: (id: string) =>
    fetchJson<Filter>(`/filters/${encodeURIComponent(id)}/duplicate`, { method: 'POST' }),
  resetDefaultFilters: () =>
    fetchJson<Filter[]>(`/filters/defaults/reset`, { method: 'POST' }),
```

- [ ] **Step 3: Confirm tests pass**

```bash
cd app/client && npm test 2>&1 | tail -5
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/lib/api-client.ts
git commit -m "feat: filter API methods on api-client"
```

---

### Task 3.3: Create filter Zustand store (TDD)

**Files:**
- Create: `app/client/src/stores/filter-store.ts`
- Create: `app/client/src/stores/filter-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
    useFilterStore.setState({ filters: [], compiled: [], loaded: false })
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
```

- [ ] **Step 2: Run the test to verify failure**

```bash
cd app/client && npm test -- stores/filter-store
```

Expected: FAIL.

- [ ] **Step 3: Implement the store**

```ts
import { create } from 'zustand'
import type { Filter } from '@/types'
import type { CompiledFilter } from '@/lib/filters/types'
import { compileFilters } from '@/lib/filters/compile'
import { api } from '@/lib/api-client'

interface FilterStore {
  filters: Filter[]
  compiled: readonly CompiledFilter[]
  loaded: boolean

  load: () => Promise<void>
  create: (input: {
    name: string
    pillName: string
    display: 'primary' | 'secondary'
    combinator: 'and' | 'or'
    patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
  }) => Promise<Filter>
  update: (
    id: string,
    patch: Partial<{
      name: string
      pillName: string
      display: 'primary' | 'secondary'
      combinator: 'and' | 'or'
      patterns: { target: 'hook' | 'tool' | 'payload'; regex: string }[]
      enabled: boolean
    }>,
  ) => Promise<Filter>
  remove: (id: string) => Promise<void>
  duplicate: (id: string) => Promise<Filter>
  resetDefaults: () => Promise<void>

  upsertFromBroadcast: (f: Filter) => void
  removeFromBroadcast: (id: string) => void
  bulkChangedFromBroadcast: () => Promise<void>
}

function setFilters(state: { filters: Filter[] }, next: Filter[]) {
  return { filters: next, compiled: compileFilters(next) }
}

export const useFilterStore = create<FilterStore>((set, get) => ({
  filters: [],
  compiled: [],
  loaded: false,

  load: async () => {
    const filters = await api.listFilters()
    set({ ...setFilters({ filters: [] }, filters), loaded: true })
  },

  create: async (input) => {
    const f = await api.createFilter(input)
    // Server broadcast will land via WS; but apply locally now for snappy UX.
    set((s) => setFilters(s, [...s.filters, f]))
    return f
  },

  update: async (id, patch) => {
    const f = await api.updateFilter(id, patch)
    set((s) => setFilters(s, s.filters.map((x) => (x.id === id ? f : x))))
    return f
  },

  remove: async (id) => {
    await api.deleteFilter(id)
    set((s) => setFilters(s, s.filters.filter((x) => x.id !== id)))
  },

  duplicate: async (id) => {
    const f = await api.duplicateFilter(id)
    set((s) => setFilters(s, [...s.filters, f]))
    return f
  },

  resetDefaults: async () => {
    const fresh = await api.resetDefaultFilters()
    // Replace defaults; keep users as-is.
    set((s) => {
      const merged = [...s.filters.filter((x) => x.kind === 'user'), ...fresh]
      return setFilters(s, merged)
    })
  },

  upsertFromBroadcast: (f) => {
    set((s) => {
      const idx = s.filters.findIndex((x) => x.id === f.id)
      const next =
        idx === -1
          ? [...s.filters, f]
          : s.filters.map((x, i) => (i === idx ? f : x))
      return setFilters(s, next)
    })
  },

  removeFromBroadcast: (id) => {
    set((s) => setFilters(s, s.filters.filter((x) => x.id !== id)))
  },

  bulkChangedFromBroadcast: async () => {
    await get().load()
  },
}))
```

- [ ] **Step 4: Run the test**

```bash
cd app/client && npm test -- stores/filter-store
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/stores/filter-store.ts app/client/src/stores/filter-store.test.ts
git commit -m "feat: filter-store with broadcast handlers"
```

---

### Task 3.4: Wire WS filter messages into use-websocket

**Files:**
- Modify: `app/client/src/hooks/use-websocket.ts`

- [ ] **Step 1: Import the filter store**

At the top of `use-websocket.ts`, add:

```ts
import { useFilterStore } from '@/stores/filter-store'
```

- [ ] **Step 2: Handle filter messages in `handleMessage`**

Find the existing `else if (msg.type === 'activity')` clause (line ~183) and append after it (before the closing `}` of `handleMessage`):

```ts
      } else if (msg.type === 'filter:created') {
        useFilterStore.getState().upsertFromBroadcast(msg.filter)
      } else if (msg.type === 'filter:updated') {
        useFilterStore.getState().upsertFromBroadcast(msg.filter)
      } else if (msg.type === 'filter:deleted') {
        useFilterStore.getState().removeFromBroadcast(msg.id)
      } else if (msg.type === 'filter:bulk-changed') {
        void useFilterStore.getState().bulkChangedFromBroadcast()
```

- [ ] **Step 3: Load filters once on connect**

In the same file, find the existing `useEffect(() => { … connectWs() }, [handleMessage])` block. Just before the `connectWs()` invocation, add:

```ts
    // Kick off initial filter load — independent of WS connection.
    void useFilterStore.getState().load()
```

- [ ] **Step 4: Run all client tests**

```bash
cd app/client && npm test 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/hooks/use-websocket.ts
git commit -m "feat: wire filter WS messages and initial load"
```

---

## Phase 4 — Wire matcher into the agent pipeline

End state: `processEvent` populates `event.filters` via `applyFilters`. Existing `event.filterTags` consumers continue working until Phase 5.

### Task 4.1: Add `filters` field and `compiledFilters` ctx to `agents/types.ts`

**Files:**
- Modify: `app/client/src/agents/types.ts`

- [ ] **Step 1: Add the field next to filterTags**

Find the `EnrichedEvent` interface (line 16). The existing `filterTags` block has inline comments — preserve them exactly. **Add** the new `filters` field directly below `filterTags` (don't delete `filterTags` yet — Phase 5/6 does that). Use the `Edit` tool with old_string matching the existing block including comments:

```ts
  filterTags: {
    static: string | null // category: 'Prompts', 'Tools', 'Agents', etc. (null if hidden)
    dynamic: string[] // specific filters: ['Bash'], ['Read'], etc.
  }
  /** Pill names (deduped) for primary and secondary filter rows. */
  filters: {
    primary: string[]
    secondary: string[]
  }
```

- [ ] **Step 2: Add `compiledFilters` to `ProcessingContext`**

Inside the `ProcessingContext` interface (line 57), add (alongside `dedupEnabled`):

```ts
  /** User + default filters compiled into RegExp form, ready for applyFilters. */
  compiledFilters: readonly import('@/lib/filters/types').CompiledFilter[]
```

Or — preferably — import the type at the top of the file:

```ts
import type { CompiledFilter } from '@/lib/filters/types'
```

…and declare the field as `compiledFilters: readonly CompiledFilter[]`.

- [ ] **Step 3: Build (will fail in agent classes; that's expected)**

```bash
cd app/client && npx tsc --noEmit 2>&1 | head -20
```

Expected: errors in `default/index.tsx`, `claude-code/process-event.ts`, `codex/...`, and `event-store.ts` — they don't yet set `filters` or use `compiledFilters`. Fixed in the next tasks.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/agents/types.ts
git commit -m "feat: add filters field and compiledFilters ctx"
```

---

### Task 4.2: Wire `compiledFilters` into `EventStore` (detect rule changes as a full-reprocess trigger)

**Files:**
- Modify: `app/client/src/agents/event-store.ts`

- [ ] **Step 1: Add the `compiledFilters` field and tracking**

In `app/client/src/agents/event-store.ts`, find the existing private-field block near the top of the class (currently lines 10-23):

```ts
  private events: EnrichedEvent[] = []
  private eventById = new Map<number, EnrichedEvent>()
  private groupIndex = new Map<string, EnrichedEvent[]>()
  private turnIndex = new Map<string, EnrichedEvent[]>()
  private agentIndex = new Map<string, EnrichedEvent[]>()
  private currentTurns = new Map<string, string>()
  private pendingGroups = new Map<string, string>()
  private pendingAgentMeta = new Map<string, { name: string | null; description: string | null }>()
  private pendingUpdates: Array<{ eventId: number; changes: Partial<EnrichedEvent> }> = []
  private dedupEnabled = true
```

Add two new private fields immediately below `private dedupEnabled = true`:

```ts
  private compiledFilters: readonly import('@/lib/filters/types').CompiledFilter[] = []
  private lastCompiledFilters: readonly import('@/lib/filters/types').CompiledFilter[] = []
```

And find the existing `private lastProcessedCount = 0` / `private lastDedupEnabled = true` lines (currently 44-45) — leave them as is.

- [ ] **Step 2: Replace the `process()` method**

Replace the entire existing `process(rawEvents, dedupEnabled)` method (currently lines 51-82) with this new version. The change adds a `compiledFilters` parameter, treats any change in its reference as a full-reprocess trigger, and stashes it on `this.compiledFilters` so `createProcessingContext()` can pass it through:

```ts
  /**
   * Process raw events. Automatically detects whether to do a full
   * reprocess or incremental append based on what changed.
   */
  process(
    rawEvents: RawEvent[],
    dedupEnabled: boolean,
    compiledFilters: readonly import('@/lib/filters/types').CompiledFilter[],
  ): EnrichedEvent[] {
    // Full reprocess needed if any of: dedup toggled, compiled filter
    // set changed reference, events were replaced (not appended).
    const needsFullReprocess =
      dedupEnabled !== this.lastDedupEnabled ||
      compiledFilters !== this.lastCompiledFilters ||
      rawEvents.length < this.lastProcessedCount ||
      (this.lastProcessedCount > 0 &&
        rawEvents.length > 0 &&
        rawEvents[0]?.id !== this.events[0]?.id)

    if (needsFullReprocess) {
      this.clear()
      this.dedupEnabled = dedupEnabled
      this.compiledFilters = compiledFilters
      this.lastDedupEnabled = dedupEnabled
      this.lastCompiledFilters = compiledFilters
      for (const raw of rawEvents) {
        this.processOne(raw)
      }
      this.lastProcessedCount = rawEvents.length
      return this.events
    }

    // Incremental: only process newly appended events
    this.dedupEnabled = dedupEnabled
    this.compiledFilters = compiledFilters
    const newEvents = rawEvents.slice(this.lastProcessedCount)
    if (newEvents.length === 0) return this.events
    for (const raw of newEvents) {
      this.processOne(raw)
    }
    this.lastProcessedCount = rawEvents.length
    this.events = [...this.events]
    return this.events
  }
```

- [ ] **Step 3: Add `compiledFilters` to `createProcessingContext`**

Find `createProcessingContext()` (currently around line 142). Add the new field at the top of the returned object (right after `dedupEnabled`):

```ts
  private createProcessingContext(): ProcessingContext {
    return {
      dedupEnabled: this.dedupEnabled,
      compiledFilters: this.compiledFilters,
      getAgent: (agentId) => this.agentMap.get(agentId),
      // …all existing fields below remain unchanged…
```

Leave every other field of `createProcessingContext` exactly as is.

- [ ] **Step 4: Build**

```bash
cd app/client && npx tsc --noEmit 2>&1 | tail -20
```

Expected: errors only in the three `processEvent` implementations (Tasks 4.4–4.5 fix those) and `event-processing-context.tsx` (Task 4.3 fixes that). event-store itself compiles.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/agents/event-store.ts
git commit -m "feat: thread compiledFilters through process() and processing context"
```

---

### Task 4.3: Update event-processing-context to feed the filter store

**Files:**
- Modify: `app/client/src/agents/event-processing-context.tsx`

- [ ] **Step 1: Add filter store subscription and pass compiled into `process`**

Replace the entire body of `app/client/src/agents/event-processing-context.tsx` with this version. The only differences from the current file are: (a) a new `useFilterStore` subscription, (b) `compiledFilters` passed into `store.process(...)`, and (c) `compiledFilters` added to the useMemo deps. No `useEffect`/`reapplyFilters` is needed — `EventStore.process()` (Task 4.2) detects compiledFilters changes and re-runs full enrichment.

```tsx
// Shared event processing context.
// Ensures a single EventStore processes events once, shared by
// event-stream, activity-timeline, and any other consumers.

import { createContext, useContext, useMemo, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useFilterStore } from '@/stores/filter-store'
import { EventStore } from './event-store'
import type { EnrichedEvent, FrameworkDataApi } from './types'
import type { ParsedEvent, Agent } from '@/types'

interface EventProcessingValue {
  events: EnrichedEvent[]
  dataApi: FrameworkDataApi
}

const EventProcessingContext = createContext<EventProcessingValue>({
  events: [],
  dataApi: {
    getAgent: () => undefined,
    getGroupedEvents: () => [],
    getTurnEvents: () => [],
    getAgentEvents: () => [],
  },
})

export function EventProcessingProvider({
  rawEvents,
  agents,
  children,
}: {
  rawEvents: ParsedEvent[] | undefined
  agents: Agent[]
  children: React.ReactNode
}) {
  const storeRef = useRef<EventStore>(new EventStore())
  const dedupEnabled = useUIStore((s) => s.dedupEnabled)
  const compiledFilters = useFilterStore((s) => s.compiled)

  const value = useMemo(() => {
    const store = storeRef.current
    store.setAgents(agents)

    if (!rawEvents || rawEvents.length === 0) {
      return {
        events: [] as EnrichedEvent[],
        dataApi: store.createDataApi(),
      }
    }

    const enriched = store.process(rawEvents, dedupEnabled, compiledFilters)

    return {
      events: enriched,
      dataApi: store.createDataApi(),
    }
  }, [rawEvents, agents, dedupEnabled, compiledFilters])

  return <EventProcessingContext.Provider value={value}>{children}</EventProcessingContext.Provider>
}

export function useProcessedEvents(): EventProcessingValue {
  return useContext(EventProcessingContext)
}
```

- [ ] **Step 2: Build**

```bash
cd app/client && npx tsc --noEmit 2>&1 | head -10
```

Expected: agent-class errors still remain (filters field not yet set there); event-processing-context compiles.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/agents/event-processing-context.tsx
git commit -m "feat: feed compiledFilters from store into EventStore"
```

---

### Task 4.4: Update `claude-code/process-event.ts` to populate `event.filters`

**Files:**
- Modify: `app/client/src/agents/claude-code/process-event.ts`

- [ ] **Step 1: Import applyFilters**

Add at the top of the file:

```ts
import { applyFilters } from '@/lib/filters/matcher'
```

- [ ] **Step 2: Populate `filters` on the enriched event**

Find the `enriched: ClaudeCodeEnrichedEvent = {` block (~line 398). It contains a single `filterTags: getFilterTags(hookName, toolName, displayEventStream),` line. **Insert a new line** directly below it (do NOT replace the existing one — both coexist until Phase 6):

```ts
    filterTags: getFilterTags(hookName, toolName, displayEventStream),
    filters: applyFilters(raw, toolName, ctx.compiledFilters),
```

Use the `Edit` tool with `old_string` set to the single existing `filterTags: getFilterTags(...)` line, and `new_string` set to both lines (the existing + the new). This avoids rewriting the surrounding literal.

- [ ] **Step 3: Build**

```bash
cd app/client && npx tsc --noEmit 2>&1 | head -10
```

Expected: errors only in `default/index.tsx` and `codex/process-event.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/agents/claude-code/process-event.ts
git commit -m "feat: populate event.filters in claude-code processEvent"
```

---

### Task 4.5: Update `default/index.tsx` (codex inherits this automatically)

**Files:**
- Modify: `app/client/src/agents/default/index.tsx`

Note: `app/client/src/agents/codex/index.tsx` re-exports `processEvent` from `../default/index` (see codex `index.tsx:7`). No separate codex edit is required.

- [ ] **Step 1: Patch the default agent**

In `app/client/src/agents/default/index.tsx`, add the import at the top of the file (alongside the existing agent imports):

```ts
import { applyFilters } from '@/lib/filters/matcher'
```

Find the existing single line `filterTags: { static: null, dynamic: toolName ? [toolName] : [] },` (around line 49). Replace it with the same line followed by a new `filters` line — use `Edit` with `old_string` matching just that one line:

```ts
    filterTags: { static: null, dynamic: toolName ? [toolName] : [] },
    filters: applyFilters(raw, toolName, ctx.compiledFilters),
```

- [ ] **Step 2: Build**

```bash
cd app/client && npx tsc --noEmit 2>&1 | tail -5
```

Expected: 0 errors.

- [ ] **Step 3: Run all client tests**

```bash
cd app/client && npm test 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/agents/default/index.tsx
git commit -m "feat: populate event.filters in default agent processEvent"
```

---

## Phase 5 — Swap filter bar + event stream over to `event.filters`

End state: filter bar renders pills from `event.filters`; event stream filters by `event.filters`. The deprecated `event.filterTags` field remains briefly until Phase 6 cleanup.

### Task 5.1: Update `event-filter-bar.tsx`

**Files:**
- Modify: `app/client/src/components/main-panel/event-filter-bar.tsx`

This task rewrites the bar to render pill names from `event.filters` (now multi-valued), pulls kind metadata from `filter-store`, and removes the `STATIC_CATEGORIES`/`activeCategories`/`dynamicNames` dead code. Pills only render when at least one matching event exists, so the old `hasMatches` dimming branch is no longer reachable and is deleted.

- [ ] **Step 1: Add the filter-store import at the top of the file**

```tsx
import { useFilterStore } from '@/stores/filter-store'
```

- [ ] **Step 2: Replace the `activeCategories` and `dynamicNames` memos with `primaryNames`, `secondaryNames`, and `pillKindByName`**

Delete the existing `activeCategories` memo (currently lines ~73-81) **and** the existing `dynamicNames` memo (currently lines ~84-92) in their entirety. Replace them with:

```tsx
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
```

- [ ] **Step 3: Delete the `STATIC_CATEGORIES` constant**

Near the top of the file (currently lines ~10-23) there's a `const STATIC_CATEGORIES = [...]` array. Delete it entirely.

- [ ] **Step 4: Replace the row-1 (primary) pill JSX**

Find the JSX block that currently renders the row-1 pills — it iterates `STATIC_CATEGORIES.map((category) => …)` (currently lines ~151-172). Replace the entire `{STATIC_CATEGORIES.map(...)}` block (including the inner button) with:

```tsx
          {primaryNames.map((category) => {
            const isActive = activeStaticFilters.includes(category)
            const isUser = pillKindByName.get(category) === 'user'
            return (
              <button
                key={category}
                data-filter-pill=""
                data-filter-row="0"
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                  isActive
                    ? isUser
                      ? 'bg-violet-500 text-white border-violet-500'
                      : 'bg-primary text-primary-foreground border-primary'
                    : isUser
                      ? 'bg-secondary text-secondary-foreground border-violet-500/40 hover:bg-accent'
                      : 'bg-secondary text-secondary-foreground border-primary/40 hover:bg-accent',
                )}
                onClick={() => toggleStaticFilter(category)}
              >
                {category}
              </button>
            )
          })}
```

(Note: `activeStaticFilters` / `toggleStaticFilter` are renamed to `activePrimaryFilters` / `togglePrimaryFilter` in Phase 6. Keep them as-is here.)

- [ ] **Step 5: Replace the row-2 (secondary) pill JSX**

Find the JSX block that currently renders row-2 — it iterates `dynamicNames.map(...)` (currently lines ~213-228). Replace the entire `{dynamicNames.map(...)}` block (including the inner button) with:

```tsx
          {secondaryNames.map((name) => {
            const isActive = activeToolFilters.includes(name)
            const isUser = pillKindByName.get(name) === 'user'
            return (
              <button
                key={name}
                data-filter-pill=""
                data-filter-row="1"
                className={cn(
                  'rounded-full px-2.5 py-0.5 text-xs transition-colors border',
                  isUser
                    ? isActive
                      ? 'border-violet-500 bg-violet-500/15 text-violet-700 dark:text-violet-400'
                      : 'border-border text-muted-foreground hover:border-violet-500/50 hover:text-foreground'
                    : isActive
                      ? 'border-blue-500 bg-blue-500/15 text-blue-700 dark:text-blue-400'
                      : 'border-border text-muted-foreground hover:border-blue-500/50 hover:text-foreground',
                )}
                onClick={() => toggleToolFilter(name)}
              >
                {name}
              </button>
            )
          })}
```

Also update the outer `{dynamicNames.length > 0 && (...)}` conditional to `{secondaryNames.length > 0 && (...)}`.

- [ ] **Step 6: Run tests + typecheck**

```bash
cd app/client && npx tsc --noEmit 2>&1 | tail -10 && npm test 2>&1 | tail -10
```

Expected: 0 type errors, PASS.

- [ ] **Step 7: Commit**

```bash
git add app/client/src/components/main-panel/event-filter-bar.tsx
git commit -m "feat: filter bar reads pill names from event.filters with user/default styling"
```

---

### Task 5.2: Update `event-stream.tsx` to filter by `event.filters`

**Files:**
- Modify: `app/client/src/components/event-stream/event-stream.tsx`

- [ ] **Step 1: Replace static-filter logic**

Find the block (around line 95):

```tsx
    if (deferredStaticFilters.length > 0) {
      const activeFilters = STATIC_FILTERS.filter((f) => deferredStaticFilters.includes(f.label))
      filtered = filtered.filter((e) => activeFilters.some((f) => matchesStaticFilter(e, f)))
    }
```

Replace with:

```tsx
    if (deferredStaticFilters.length > 0) {
      filtered = filtered.filter((e) =>
        deferredStaticFilters.some((name) => e.filters.primary.includes(name)),
      )
    }
```

- [ ] **Step 2: Replace dynamic-filter logic**

Find the next block (around line 101):

```tsx
    if (deferredToolFilters.length > 0) {
      filtered = filtered.filter((e) =>
        deferredToolFilters.some((f) => e.filterTags.dynamic.includes(f)),
      )
    }
```

Replace with:

```tsx
    if (deferredToolFilters.length > 0) {
      filtered = filtered.filter((e) =>
        deferredToolFilters.some((name) => e.filters.secondary.includes(name)),
      )
    }
```

- [ ] **Step 3: Remove the now-unused imports**

Delete `STATIC_FILTERS` and `matchesStaticFilter` from the import at the top of the file.

- [ ] **Step 4: Run tests**

```bash
cd app/client && npm test 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Visual parity check (manual, non-blocking)**

```bash
just dev
```

Open an existing session in the browser. Toggle Prompts / Tools / a tool pill. Verify the same set of events appears as before this change.

**Expected difference for Errors:** the old static "Errors" filter matched any event with `status === 'failed'`. The new "Errors" default matches events whose stringified payload contains `"is_error":true` or `"error":"…"`. For the vast majority of events the counts match; if any drift, that's expected and the new behavior is canonical (Errors is now payload-driven, not status-driven). No need to block on this difference.

- [ ] **Step 6: Commit**

```bash
git add app/client/src/components/event-stream/event-stream.tsx
git commit -m "feat: event-stream filters by event.filters"
```

---

## Phase 6 — UI store rename + cleanup

End state: dead code removed, `event.filterTags` gone, `activePrimaryFilters` / `activeSecondaryFilters` is the new vocabulary.

### Task 6.1: Rename `activeStaticFilters` and `activeToolFilters` in UI store

**Files:**
- Modify: `app/client/src/stores/ui-store.ts`
- Modify: `app/client/src/stores/ui-store.test.ts`

- [ ] **Step 1: Rename across the store file**

In `app/client/src/stores/ui-store.ts`:

- Replace `activeStaticFilters` with `activePrimaryFilters` (every occurrence).
- Replace `activeToolFilters` with `activeSecondaryFilters` (every occurrence).
- Replace `toggleStaticFilter` with `togglePrimaryFilter`.
- Replace `toggleToolFilter` with `toggleSecondaryFilter`.
- Update comments accordingly.

Use Edit with `replace_all: true` for each rename.

- [ ] **Step 2: (No localStorage migration needed)**

The current `sessionFilterStates` map lives in memory only — confirmed by `grep -n "sessionFilterStates\|localStorage" app/client/src/stores/ui-store.ts`. No migration required.

- [ ] **Step 3: Rename in callers**

```bash
cd app/client && grep -rln "activeStaticFilters\|activeToolFilters\|toggleStaticFilter\|toggleToolFilter" src
```

For each file in the output, run the same 4 `Edit` calls with `replace_all: true`:

- `activeStaticFilters` → `activePrimaryFilters`
- `activeToolFilters` → `activeSecondaryFilters`
- `toggleStaticFilter` → `togglePrimaryFilter`
- `toggleToolFilter` → `toggleSecondaryFilter`

Expected files to touch: `event-filter-bar.tsx`, `event-stream.tsx`, `ui-store.test.ts`, and any others surfaced by the grep. The test file is part of the typecheck and test run in Step 4, so any miss will surface there.

- [ ] **Step 4: Build + test**

```bash
cd app/client && npx tsc --noEmit 2>&1 | head -10 && npm test 2>&1 | tail -10
```

Expected: 0 type errors, all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add app/client/src
git commit -m "refactor: rename activeStaticFilters → activePrimaryFilters and activeToolFilters → activeSecondaryFilters"
```

---

### Task 6.2: Remove `filterTags` from EnrichedEvent and the agent classes

**Files:**
- Modify: `app/client/src/agents/types.ts`
- Modify: `app/client/src/agents/claude-code/process-event.ts`
- Modify: `app/client/src/agents/default/index.tsx`

(Codex inherits `processEvent` from default — no separate codex edit needed.)

- [ ] **Step 1: Drop the field from the type**

In `app/client/src/agents/types.ts`, delete the entire `filterTags` block from `EnrichedEvent`, including the inline comments:

```ts
  filterTags: {
    static: string | null // category: 'Prompts', 'Tools', 'Agents', etc. (null if hidden)
    dynamic: string[] // specific filters: ['Bash'], ['Read'], etc.
  }
```

Keep `filters`.

- [ ] **Step 2: Drop assignments in each processEvent**

In `app/client/src/agents/claude-code/process-event.ts`, remove the `filterTags: getFilterTags(hookName, toolName, displayEventStream),` line from the enriched object literal. Keep `filters: applyFilters(...)`.

Also delete the now-unused `getFilterTags` helper function (currently lines ~82-140 — find via `grep -n "function getFilterTags" app/client/src/agents/claude-code/process-event.ts`). The `LABELS` map and `pickIconId` helpers remain.

In `app/client/src/agents/default/index.tsx`, remove the `filterTags: { static: null, dynamic: toolName ? [toolName] : [] },` line. Keep `filters: applyFilters(...)`.

- [ ] **Step 3: Build**

```bash
cd app/client && npx tsc --noEmit 2>&1 | head -20
```

Expected: 0 errors. (If `filterTags` was referenced anywhere we missed, fix those references — they should all be already pointed at `filters` from Phase 5.)

- [ ] **Step 4: Test**

```bash
cd app/client && npm test 2>&1 | tail -10
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/client/src/agents
git commit -m "refactor: drop filterTags field and getFilterTags helper"
```

---

### Task 6.3: Delete `config/filters.ts` and the `STATIC_FILTERS` config

**Files:**
- Delete: `app/client/src/config/filters.ts`

- [ ] **Step 1: Confirm no references remain**

```bash
cd app/client && grep -rln "STATIC_FILTERS\|matchesStaticFilter\|matchesDynamicFilter\|getDynamicFilterNames" src
```

Expected: empty.

- [ ] **Step 2: Delete the file**

```bash
rm app/client/src/config/filters.ts
```

- [ ] **Step 3: Build + test**

```bash
cd app/client && npx tsc --noEmit 2>&1 | head -10 && npm test 2>&1 | tail -10
```

Expected: 0 errors, PASS.

- [ ] **Step 4: Commit**

```bash
git add app/client/src
git commit -m "refactor: remove old STATIC_FILTERS config and helpers"
```

---

## Phase 7 — Settings UI

End state: users can manage filters via Settings → Filters tab, including live N-matches preview, duplicate, and reset.

### Task 7.1: Add the Filters tab trigger and content to `settings-modal.tsx`

**Files:**
- Modify: `app/client/src/components/settings/settings-modal.tsx`

- [ ] **Step 1: Add the tab trigger**

Inside the `<TabsList>` block (~line 72-79), insert after `Display` (or wherever feels natural — order is up to you):

```tsx
              <TabsTrigger value="filters">Filters</TabsTrigger>
```

- [ ] **Step 2: Add the tab content**

Inside the `<Tabs>` block, after the last `<TabsContent>`, add:

```tsx
          <TabsContent value="filters" className="flex-1 min-h-0 flex flex-col">
            <FiltersTab />
          </TabsContent>
```

And import at the top:

```tsx
import { FiltersTab } from './filters-tab'
```

(`filters-tab` will be created in the next task — file won't compile yet.)

- [ ] **Step 3: No type changes needed**

`settingsTab` is typed as `string` in `ui-store.ts` (see lines ~138 and ~140), not a union, so no type update is required to accept `'filters'`.

- [ ] **Step 4: Commit (tab will fail until next task completes)**

```bash
git add app/client/src/components/settings/settings-modal.tsx
git commit -m "feat: add Filters tab placeholder to Settings"
```

---

### Task 7.2: Build `filters-tab.tsx` — sidebar list and editor scaffolding

**Files:**
- Create: `app/client/src/components/settings/filters-tab.tsx`

- [ ] **Step 1: Implement the scaffold**

```tsx
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
```

- [ ] **Step 2: Build**

```bash
cd app/client && npx tsc --noEmit 2>&1 | head -10
```

Expected: 0 errors.

- [ ] **Step 3: Smoke check in browser (non-blocking — skip under a headless agent)**

```bash
just dev
```

Open Settings → Filters. Verify the sidebar lists Default filters with checkboxes; toggling sends a PATCH; switching Primary/Secondary changes the visible list.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/settings/filters-tab.tsx
git commit -m "feat: Filters tab sidebar scaffolding"
```

---

### Task 7.3: Build the user-filter editor pane

**Files:**
- Modify: `app/client/src/components/settings/filters-tab.tsx`

- [ ] **Step 1: Replace `FilterEditor` with the full editor**

```tsx
function FilterEditor({ filter }: { filter: Filter }) {
  const { update, remove, duplicate } = useFilterStore()
  const isUser = filter.kind === 'user'

  // Local form state — initialized from the filter, syncs back on save.
  const [name, setName] = useState(filter.name)
  const [pillName, setPillName] = useState(filter.pillName)
  const [display, setDisplay] = useState(filter.display)
  const [combinator, setCombinator] = useState(filter.combinator)
  const [patterns, setPatterns] = useState(filter.patterns)
  // Re-initialize when a different filter is selected.
  useEffect(() => {
    setName(filter.name)
    setPillName(filter.pillName)
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
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isUser} />
        </div>
        <div>
          <label className="text-xs uppercase text-muted-foreground">Pill name</label>
          <Input
            value={pillName}
            onChange={(e) => setPillName(e.target.value)}
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
                setPatterns(patterns.map((pp, ii) => (ii === i ? { ...pp, regex: e.target.value } : pp)))
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
```

- [ ] **Step 2: Build + test**

```bash
cd app/client && npx tsc --noEmit && npm test 2>&1 | tail -10
```

Expected: 0 errors, PASS.

- [ ] **Step 3: Manual smoke (non-blocking — skip under a headless agent)**

`just dev`, open Settings → Filters, select a default → verify fields are read-only with the "DEFAULT · READ-ONLY" badge; click Duplicate → new user filter selected, all fields editable; change the regex → Save persists → broadcast triggers a re-pass and pills update in the bar.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/settings/filters-tab.tsx
git commit -m "feat: filter editor pane with user/default modes"
```

---

### Task 7.4: Add "+ New filter" and live preview

**Files:**
- Modify: `app/client/src/components/settings/filters-tab.tsx`

- [ ] **Step 1: Wire the New filter button**

Replace the TODO in the `+ New filter` button's onClick:

```tsx
            onClick={async () => {
              const f = await useFilterStore.getState().create({
                name: 'New filter',
                pillName: 'New filter',
                display: displayTab,
                combinator: 'and',
                patterns: [{ target: 'hook', regex: '.+' }],
              })
              setSelectedId(f.id)
            }}
```

- [ ] **Step 2: Add live N-matches preview to the editor**

Inside `FilterEditor`, after the patterns list, add:

```tsx
      <LivePreview
        pillName={pillName}
        display={display}
        combinator={combinator}
        patterns={patterns}
      />
```

**Important context for the implementer:** `SettingsModal` is rendered inside `sidebar.tsx` (line ~167), which sits OUTSIDE `EventProcessingProvider` (rendered in `main-panel.tsx` line ~49). Reading from `useProcessedEvents()` here would return an empty default — so the preview must pull raw events from the React Query cache instead. That has the side benefit of working with or without the main panel being mounted.

Add to the top-of-file imports in `filters-tab.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/stores/ui-store'
import { applyFilters } from '@/lib/filters/matcher'
import type { CompiledFilter } from '@/lib/filters/types'
import type { ParsedEvent } from '@/types'
```

Define `LivePreview` at module scope (below `FilterEditor` is fine):

```tsx
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
```

- [ ] **Step 3: Manual smoke (non-blocking — skip under a headless agent)**

`just dev` → Settings → Filters → New filter. Type a regex into a pattern; the count should update 300ms after typing stops. Save → pill appears in the bar.

- [ ] **Step 4: Commit**

```bash
git add app/client/src/components/settings/filters-tab.tsx
git commit -m "feat: new filter button and live N-matches preview"
```

---

### Task 7.5: Auto-mirror filter name → pill name on Create

**Files:**
- Modify: `app/client/src/components/settings/filters-tab.tsx`

- [ ] **Step 1: Add auto-mirror tracking state**

In `FilterEditor`, **add** a new `pillNameAutoMirror` useState beside the existing `name` and `pillName` useStates (do NOT replace `pillName`). The block becomes:

```tsx
  const [name, setName] = useState(filter.name)
  const [pillName, setPillName] = useState(filter.pillName)
  const [pillNameAutoMirror, setPillNameAutoMirror] = useState(
    filter.name === filter.pillName,
  )
```

In the name input's onChange:

```tsx
            onChange={(e) => {
              const v = e.target.value
              setName(v)
              if (pillNameAutoMirror) setPillName(v)
            }}
```

In the pillName input's onChange:

```tsx
            onChange={(e) => {
              setPillName(e.target.value)
              setPillNameAutoMirror(false)
            }}
```

When switching filters (`useEffect([filter.id])`):

```tsx
    setPillNameAutoMirror(filter.name === filter.pillName)
```

- [ ] **Step 2: Manual smoke (non-blocking — skip under a headless agent)**

`just dev` → Filters → New filter. Type into Name → Pill name mirrors. Then edit Pill name → mirroring stops.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/settings/filters-tab.tsx
git commit -m "feat: auto-mirror filter name to pill name until user edits pill name"
```

---

### Task 7.6: Add an end-to-end smoke test for filters-tab

**Files:**
- Create: `app/client/src/components/settings/filters-tab.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { FiltersTab } from './filters-tab'
import { useFilterStore } from '@/stores/filter-store'

vi.mock('@/lib/api-client', () => ({
  api: {
    listFilters: vi.fn().mockResolvedValue([]),
    createFilter: vi.fn(async (input) => ({
      id: 'new',
      ...input,
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

// Stub the processing context provider for the LivePreview component.
vi.mock('@/agents/event-processing-context', () => ({
  useProcessedEvents: () => ({ events: [] }),
}))

describe('FiltersTab', () => {
  beforeEach(() => {
    useFilterStore.setState({ filters: [], compiled: [], loaded: false })
  })

  test('clicking + New filter creates a user filter and selects it', async () => {
    render(<FiltersTab />)
    // Wait for load() to complete (mocked empty list).
    await act(async () => {})

    fireEvent.click(screen.getByText('+ New filter'))
    await act(async () => {})

    expect(screen.getByText('New filter')).toBeInTheDocument()
    expect(screen.getByText('USER')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run the test**

```bash
cd app/client && npm test -- settings/filters-tab
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/client/src/components/settings/filters-tab.test.tsx
git commit -m "test: FiltersTab smoke test for new-filter flow"
```

---

## Phase 8 — Final verification

### Task 8.1: Run the full test suite

- [ ] **Step 1: Run `just check`**

```bash
just check
```

Expected: all tests PASS, no formatter changes.

- [ ] **Step 2: Manual end-to-end smoke (non-blocking — skip if running under a headless agent)**

```bash
just dev
```

In the browser:
1. Open Settings → Filters. Default filters list with checkboxes. Toggle "Errors" off — Errors pill disappears from the bar.
2. Toggle Errors back on. Pill returns.
3. Click "Duplicate" on the "Tools" default → a "Tools (copy)" user filter appears in the sidebar, selected. Rename, change a pattern's regex. Save.
4. Toggle the duplicated filter on the bar — events match.
5. Click "+ New filter". Default name "New filter". Type a custom pillName template with `{toolName}`. Type a regex that matches `PostToolUse`. Save. The bar shows one pill per distinct toolName matched.
6. Click "↻ Reset all" under Default. Confirms via tests + no regressions.
7. Open a second browser tab on the same dashboard. Change a filter in tab 1 → tab 2 updates within ~100ms (WS broadcast).

If any step fails, file an issue or fix inline before declaring complete.

- [ ] **Step 3: Final commit (if any incidental changes)**

```bash
git status
# If clean, no commit needed; otherwise:
git commit -m "chore: post-verification fixups"
```

---

## Self-review checklist (run after completing all tasks)

1. **Spec coverage** — Confirm every section of `docs/superpowers/specs/2026-05-11-custom-filters-design.md` has at least one task implementing it:
   - Data model (server schema + types) → Tasks 1.1–1.3
   - Matching algorithm → Tasks 2.1–2.3
   - Lazy stringify performance → Task 2.2 test
   - Variable substitution → Task 2.2 test
   - Server CRUD + broadcast → Tasks 1.4–1.11
   - Mutation rules (default 403s) → Task 1.10 test
   - Duplicate flow → Tasks 1.7, 1.10, 7.3
   - Reset defaults → Tasks 1.8, 7.2
   - Seed-on-start → Task 1.9
   - Client store + WS handling → Tasks 3.1–3.4
   - Pipeline integration → Tasks 4.1–4.5
   - Filter bar + event stream parity → Tasks 5.1–5.2
   - UI store rename → Task 6.1
   - Settings UI editor → Tasks 7.1–7.6
   - Old code removal → Tasks 6.2, 6.3

2. **Placeholder scan** — No TBDs, no "add validation", no "similar to Task N" without full code repetition.

3. **Type consistency** — `Filter`, `FilterPattern`, `CompiledFilter` are defined once and re-exported everywhere they're needed; method signatures on the server (`createFilter` input) and api-client (`api.createFilter` input) match.

4. **Behavior change called out** — The "unseen tool names no longer auto-pill" caveat is documented in the spec and the verification step exercises the seeded `Dynamic tool name` default that covers known tools.

If any gap surfaces, add a task inline. Don't bother re-reviewing afterwards.
