# Three-Layer Contract Refactor — Design

**Date:** 2026-04-25
**Status:** Draft (ready for plan)
**Supersedes:** 2026-04-24-server-simplification-design.md

## Goal

Lock down clean, minimal contracts between the three layers of the system so that:

1. Adding a new agent class never requires touching server code.
2. The server has zero implicit behavior — every action is the result of an explicit envelope signal.
3. Database fields and API responses contain only what is genuinely required to function. Display- and convenience-derived data lives in the client.

This refactor is in service of agents-observe being reused across multiple Mission Control projects. The cost of getting layer separation wrong scales with the number of downstream consumers, so we pay the refactor tax once here.

## The Three Layers

### Layer 1 — Hook libs (`hooks/scripts/lib/agents/*.mjs`)

Per-agent-class libs that read raw hook payloads, build the envelope, and POST to the server. Their job is **payload normalization into the envelope only**. They never mutate the raw payload.

A `default.mjs` lib is the canonical implementation. Any agent whose payload uses the standard shape (`session_id`, `transcript_path`, `cwd`, `hook_event_name`) needs no custom code — they get an entry that calls `default.buildHookEvent` with their `agentClass` constant. Custom libs only exist for agents whose payloads diverge.

### Layer 2 — Server (`app/server/`)

The server stores events, attributes them to sessions/agents/projects, and broadcasts notifications. It is **agent-class-agnostic**: it never inspects payload shape, never branches on hook names. It only acts on:

- **Identity fields** at the envelope top level — required for routing.
- **Creation hints** under `envelope._meta` — used only when creating a new row.
- **Behavior flags** under `envelope.flags` — direct instructions, log-only, never persisted.

That's the whole contract. A hook lib author can read this contract and predict server behavior with no surprises.

### Layer 3 — Client (`app/client/src/agents/<class>/`)

Per-agent-class registrations that own everything user-facing: how events are summarized, threaded, grouped, displayed; how subagent hierarchies are reconstructed; how status is derived. The client receives raw payloads and parses them itself. Anything class-specific lives here and only here.

Layer 3 also patches mutable state back to the server via REST (e.g. agent name/description discovered in PostToolUse payloads, manual project assignments, manual session moves). The server treats these as authoritative writes; it does not validate them against payload heuristics.

## Layer 1 Contract — The Envelope

```ts
type Envelope = {
  // Identity (required)
  agentClass: string             // Picks Layer 3 registration on the client
  sessionId: string              // Required; rejected if absent
  agentId: string                // Required; defaults to sessionId in hook lib if payload has no agent_id
  hookName: string               // Identity / filter field

  // Optional event-level data
  cwd?: string                   // Per-event cwd (varies across subagents/worktrees)
  timestamp?: number             // Defaults to ingest time if absent

  // Raw payload — never mutated
  payload: object

  // Creation hints — server reads these only when creating a new row
  _meta?: {
    session?: {
      slug?: string
      transcriptPath?: string
      startCwd?: string          // For sibling-project matching
      metadata?: object          // Populates sessions.metadata blob
    }
    project?: {
      id?: number                // Exact match, obeyed
      slug?: string              // Find-or-create by slug, obeyed
    }
    agent?: {
      name?: string
      description?: string
      type?: string
      // Note: parentId intentionally omitted — Layer 3 derives hierarchy from events
    }
  }

  // Behavior flags — server reacts, then discards. Not persisted.
  flags?: {
    startsNotification?: boolean
    clearsNotification?: boolean
    stopsSession?: boolean
    resolveProject?: boolean
  }
}
```

### Why `_meta` (with leading underscore)

`_meta` is the bag of *instructional* envelope data the server inspects on first-write of a row. The leading underscore signals "internal / set by the hook lib for the server." It reserves a future `metadata` key for actual additional payload metadata if hook libs ever need to attach extra info that isn't part of the raw payload.

Storage policy: the server persists `events._meta` for traceability ("what did the hook lib say about this event when it ingested?") but does not return it on default API responses. Opt-in via `?fields=_meta` or similar.

### Why `flags` is log-only

Flags are signals that drive state transitions, not state themselves:

- `startsNotification` → server sets `sessions.pending_notification_ts`
- `clearsNotification` → server clears it
- `stopsSession` → server sets `sessions.stopped_at`
- `resolveProject` → server runs project resolution (see below)

After consumption the flag has done its job; the resulting state lives on the appropriate row. Storing the flag adds no information. Logged on receipt for debugging; not persisted.

### Default hook lib pattern

`default.mjs` exports `buildHookEvent(config, log, payload)` and a few helpers (`buildEnv`, `isNotificationEvent`, etc.) that other libs can compose:

```js
// codex.mjs
import * as defaultLib from './default.mjs'

export function buildHookEvent(config, log, payload) {
  const env = defaultLib.buildHookEvent(config, log, payload)
  env.agentClass = 'codex'
  // Codex-specific overrides go here
  return env
}
```

A new agent class with a conforming payload needs ~5 lines: import default, override `agentClass`, export.

## Layer 2 Contract — Server Behavior

### What the server does

For every POST `/api/events`:

1. **Validate identity.** Reject if `agentClass`, `sessionId`, `agentId`, or `hookName` is missing.
2. **Upsert session row.** If new: use `_meta.session.*` for slug, transcript_path, metadata. Else: leave existing fields untouched (manual UI edits stick).
3. **Resolve project** if session has no `project_id` yet (algorithm below).
4. **Upsert agent row.** If new: use `_meta.agent.*` for name, description, type. The `agent_class` comes from envelope `agentClass`.
5. **Insert event row** with the provided fields. `payload` stored as-is.
6. **Apply flags:**
   - `startsNotification` → set `sessions.pending_notification_ts = timestamp`, increment `pending_notification_count`, set `last_notification_ts`.
   - `clearsNotification` → clear `pending_notification_ts`, reset count.
   - `stopsSession` → set `sessions.stopped_at = timestamp`.
   - `resolveProject` → run resolution if session has no project (see algorithm).
7. **Broadcast.** Per-session WS event broadcast (subscribed clients) + global activity ping (all clients).

### What the server does NOT do

- Inspect the payload contents (with one narrow exception: `events.cwd` extraction if hook lib didn't provide it at the envelope level — and even this is a transitional convenience worth questioning).
- Branch on `hookName` values.
- Derive event status, type, subtype, or category.
- Auto-resolve projects without an explicit flag.
- Compute denormalized counters (`event_count`, `agent_count`).
- Walk transcripts (the `getSessionInfo` callback is removed; hook libs prefetch).
- Build agent hierarchies.
- Generate event summaries.

### Project resolution algorithm

```
on event for session S:
  if S.project_id is not null:
    skip (sticky after first assignment)
  elif _meta.project.id is set:
    assign that id (validated to exist)
  elif _meta.project.slug is set:
    find-or-create-by-slug(slug)  // retry on UNIQUE collision
  elif flags.resolveProject is true:
    candidates = sessions WHERE
      (cwd matches event.cwd) OR
      (transcript_path basedir matches new session's transcript basedir)
      ORDER BY last_activity DESC LIMIT 1
    if candidate found and candidate.project_id is not null:
      assign candidate.project_id
    else:
      create new project with basedir-derived slug
  else:
    leave S.project_id as NULL  // frontend renders in "Unassigned"
```

Sessions with `project_id IS NULL` render in a frontend-managed "Unassigned" group. There is no "unknown" project row.

**Slug-collision handling:** find-or-create-by-slug must handle UNIQUE constraint violations on race by re-querying and joining the now-existing row. It must NOT auto-suffix (`-2`) — that creates split projects from concurrent inserts.

**Sibling-match tiebreaker:** most recent `last_activity` wins.

## Layer 3 Contract — Client

The client receives raw `payload` plus minimal envelope identity fields. It owns:

- Event summaries (per-agent-class registration).
- Event grouping (`groupId`, `turnId` derivation).
- Status derivation (PreToolUse → running, etc.).
- Subagent hierarchy reconstruction by walking events.
- Threading (UserPromptSubmit → Stop boundaries).
- Tool-name extraction and filtering.
- Display-time patching of agent metadata back to the server when richer info shows up in events (PostToolUse for Agent tool, etc.).

The client maintains an in-memory UI store keyed by `agent_id` for derived agent state (cwd, parent, etc.). When this state stabilizes (e.g. after seeing a definitive PostToolUse Agent event), the client may PATCH `/api/agents/:id` to persist canonical fields (`name`, `description`, `agent_type`).

## Database Schema

### `events`

```sql
id              integer  PK
session_id      text     NOT NULL  REFERENCES sessions(id)
agent_id        text     NOT NULL  REFERENCES agents(id)
hook_name       text     NOT NULL
payload         json     NOT NULL
timestamp       integer  NOT NULL
cwd             text     NULL
_meta           json     NULL
created_at      integer  NOT NULL
```

Indexes: `(session_id, timestamp)`, `(agent_id, timestamp)`, `(session_id, hook_name)`.

Removed from current schema: `type`, `subtype`, `tool_name`, `composite type+subtype index`.

### `sessions`

```sql
id                          text     PK
project_id                  integer  NULL  REFERENCES projects(id)
slug                        text     NULL
started_at                  integer  NOT NULL
stopped_at                  integer  NULL
transcript_path             text     NULL
last_activity               integer  NOT NULL
pending_notification_ts     integer  NULL
pending_notification_count  integer  NOT NULL DEFAULT 0
last_notification_ts        integer  NULL
metadata                    json     NULL
created_at                  integer  NOT NULL
updated_at                  integer  NOT NULL
```

Removed: `status` (derive from `stopped_at`), `event_count`, `agent_count` (compute via GROUP BY).

`project_id` is nullable; sessions with NULL render in "Unassigned" client-side.

### `agents`

```sql
id           text     PK
agent_class  text     NOT NULL
name         text     NULL
description  text     NULL
agent_type   text     NULL
created_at   integer  NOT NULL
updated_at   integer  NOT NULL
```

Removed: `session_id` (agents are not 1:1 with sessions in all classes), `parent_agent_id` (Layer 3 derives from events), `transcript_path` (write-only in current schema), `metadata` (unused; can come back if needed).

### `projects`

```sql
id          integer  PK
slug        text     NOT NULL UNIQUE
name        text     NOT NULL
created_at  integer  NOT NULL
updated_at  integer  NOT NULL
```

Removed: `cwd`, `transcript_path` (sessions are source of truth for project resolution), `metadata` (unused).

### `agents_sessions` — deferred

Not added in this refactor. The `agent_classes[]` aggregate query becomes:

```sql
SELECT DISTINCT a.agent_class
FROM events e JOIN agents a ON e.agent_id = a.id
WHERE e.session_id = ?
```

If profiling shows this is hot, add `agents_sessions(agent_id, session_id, agent_class)` with `INSERT OR IGNORE` on every event. Not before.

## Wire Protocols

### REST `/api/sessions/:id/events`

Default response (per event):

```json
{
  "id": 12345,
  "timestamp": 1777056008484,
  "agent_id": "abc...",
  "hook_name": "PostToolUse",
  "payload": { ... }
}
```

Opt-in via `?fields=cwd,_meta,created_at` for additional fields.

### WebSocket — per-session subscribed broadcast

```json
{ "type": "event",
  "data": { "id", "timestamp", "agent_id", "hook_name", "payload" } }
```

`session_id` omitted — subscription scope makes it implicit.

### WebSocket — global activity broadcast

```json
{ "type": "activity",
  "data": { "sessionId", "eventId", "ts" } }
```

Unchanged from current implementation.

### REST `/api/agents/:id` (PATCH)

Layer 3's persistence path for derived agent metadata. Accepts:

```json
{ "name": "...", "description": "...", "agent_type": "..." }
```

Server silently ignores attempts to change `id` or `agent_class`. Other fields validated as strings. This replaces the currently-dead `updateAgentMetadata` endpoint.

## Notification Semantics

Server-side state lives on `sessions`:
- `pending_notification_ts` — non-null means a notification is currently waiting
- `pending_notification_count` — how many start signals have fired since last clear
- `last_notification_ts` — most recent start signal ever (for sort-by-recent-attention)

Hook libs decide what counts as a notification per agent class; envelope flags carry the signal. Server has no special knowledge of which hook events should notify — it only obeys `flags.*Notification`.

## Removals (concrete list)

### Server endpoints

- `GET /api/events/:id/thread` — dead
- `GET /api/agents/:id/events` — dead
- `POST /api/callbacks/session-info/:id` — replaced by hook-lib prefetch into `_meta`

### Server logic

- `getThreadForEvent` in storage adapter
- `deriveEventStatus` in routes
- All `subtype === 'X'` branches in `routes/events.ts`
- `parser.ts` subagent-extraction (PreToolUse/PostToolUse/SubagentStop branches) — moves to Layer 3
- "Unknown" singleton project shim
- `event_count` / `agent_count` denormalization on session insert/delete

### Database columns

- `events.type`, `events.subtype`, `events.tool_name`
- `sessions.status`, `sessions.event_count`, `sessions.agent_count`
- `agents.session_id`, `agents.parent_agent_id`, `agents.transcript_path`, `agents.metadata`
- `projects.cwd`, `projects.transcript_path`, `projects.metadata`

### Hook lib code

- `deriveTypeSubtype` from all three libs
- `getSessionInfo` callback receiver path (the lib still has the function for prefetch use, but the round-trip with the server goes away)
- `unknown.mjs` renames to `default.mjs`; per-class libs delegate to it

### Client code

The wide one. Every site that reads `event.subtype`, `event.type`, `event.tool_name`, or `event.status` from API responses moves to deriving from `event.hookName` + `event.payload` via the agent-class registration. Tests need parallel updates.

## Migration Considerations

This spec is deliberately silent on phasing — the actual implementation plan should sequence work to keep `main` green at each step. High-level: phases that drop dead code can ship independently before the wire-protocol changes; the wire-protocol changes need to be coordinated with the client refactor; the column drops need a SQLite table-rebuild migration.

A separate plan doc (`docs/plans/YYYY-MM-DD-three-layer-contract-impl.md`) will spell out phasing, testing strategy, and risk-ordered rollout.

## Open questions deferred to plan time

- **Bikeshed: `_meta` vs `_envelope` vs `creationHints` for the envelope sub-bag.** Picking `_meta` in this spec; not worth re-litigating without strong reason.
- **`?fields=` parameter syntax.** REST convention is `?fields=a,b,c`. Worth cross-checking against existing API conventions in the repo before locking.
- **Backwards compatibility window for old clients.** If the wire shape changes mid-refactor, do we double-publish for a release? Probably not — single repo, single client; ship together.
- **Activity-ping payload during refactor.** Currently includes `eventId` — worth re-confirming nothing depends on this. Spec keeps it for future "click pulse → jump to event" affordance.
- **Frontend rendering of NULL-project sessions.** "Unassigned" bucket in sidebar; new UI element. Sketching that lives outside this server-focused spec.

## Summary in one paragraph

The server becomes a pure event-attribution and state-transition machine driven by an explicit envelope contract. Hook libs do all payload-shape normalization in their own layer; the client does all display- and hierarchy-derivation in its layer. The server's behavior is fully predictable from the envelope alone. New agent classes whose payloads conform to the standard shape need only an `agentClass` constant; non-conforming agents need a thin lib that translates into the standard envelope. Database fields and API responses are pruned to what genuinely must persist or cross the wire. Everything else lives in the client.
