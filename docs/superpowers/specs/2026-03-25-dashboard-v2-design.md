# Dashboard V2: React 19 + shadcn Rewrite

**Date:** 2026-03-25
**Status:** Draft
**Location:** `app2/` (client, server, hooks — self-contained, preserving original code)

---

## Overview

Complete rewrite of the Multi-Agent Observability Dashboard. Migrating from Vue 3 to React 19 + shadcn/ui with a fundamentally improved navigation hierarchy, simplified hooks architecture, and a new server data model designed around agent hierarchy.

The dashboard is a **read-only observability tool** — it displays real-time and historical data from Claude Code agent sessions. It does not control agents.

---

## Architecture

### System Layers

```
Claude Code Hooks → Server (Bun + SQLite) → Client (React 19)
     (dumb pipe)      (smart parser)          (clean consumer)
```

### Directory Structure

```
app2/
  client/          # React 19 + shadcn + Vite + TypeScript
  server/          # Bun + SQLite, new data model
  hooks/           # Single Node.js script, forwards raw JSONL
```

---

## 1. Hooks

### Philosophy

Hooks are a dumb pipe. They receive the JSONL event from Claude Code via stdin and POST the entire raw payload to the server. No parsing, no summarization, no transformation.

### Implementation

Single file: `app2/hooks/send_event.mjs`

- Reads JSONL from stdin
- Adds `project_name` field from `CLAUDE_OBSERVE_PROJECT_NAME` env var (required — the raw JSONL has no project concept)
- POSTs to `http://localhost:${CLAUDE_OBSERVE_PORT || 4001}/api/events`
- Uses only Node.js built-ins (`http` module)
- No external dependencies
- Same script used for every hook type

### Environment Variables

- `CLAUDE_OBSERVE_PROJECT_NAME` (required) — project name, e.g., "my-project"
- `CLAUDE_OBSERVE_PORT` (optional, default 4001) — server port

### Hook Configuration

```json
{
  "hooks": {
    "PreToolUse": [{ "command": "node app2/hooks/send_event.mjs" }],
    "PostToolUse": [{ "command": "node app2/hooks/send_event.mjs" }],
    "Stop": [{ "command": "node app2/hooks/send_event.mjs" }],
    "UserPromptSubmit": [{ "command": "node app2/hooks/send_event.mjs" }],
    "SessionStart": [{ "command": "node app2/hooks/send_event.mjs" }]
  }
}
```

---

## 2. Server

### Tech Stack

- **Runtime:** Bun
- **Database:** SQLite (bun:sqlite, WAL mode)
- **WebSocket:** Native Bun WebSocket support
- **HTTP:** Bun.serve() (no Express)

### Database Schema

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,           -- project_name value
  name TEXT NOT NULL,            -- display name (= project_name initially)
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,           -- sessionId from JSONL
  project_id TEXT NOT NULL,      -- FK to projects.id
  slug TEXT,                     -- human-readable name (e.g., "twinkly-dragon")
  status TEXT DEFAULT 'active',  -- "active" | "stopped"
  started_at INTEGER NOT NULL,
  stopped_at INTEGER,
  metadata JSON,                 -- version, entrypoint, cwd, git_branch, etc.
  FOREIGN KEY (project_id) REFERENCES projects(id)
);

CREATE TABLE agents (
  id TEXT PRIMARY KEY,           -- agentId from JSONL (for subagents) or sessionId (for root)
  session_id TEXT NOT NULL,      -- FK to sessions.id
  parent_agent_id TEXT,          -- null for root agents, agent.id of parent for subagents
  slug TEXT,                     -- human-readable name if available
  name TEXT,                     -- description from Agent tool input
  status TEXT DEFAULT 'active',  -- "active" | "stopped"
  started_at INTEGER NOT NULL,
  stopped_at INTEGER,
  FOREIGN KEY (session_id) REFERENCES sessions(id),
  FOREIGN KEY (parent_agent_id) REFERENCES agents(id)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id TEXT NOT NULL,        -- FK to agents.id
  session_id TEXT NOT NULL,      -- FK to sessions.id (denormalized for query performance)
  type TEXT NOT NULL,            -- "user" | "assistant" | "progress" | "system"
  subtype TEXT,                  -- e.g., "SessionStart", "PreToolUse", "Stop"
  tool_name TEXT,                -- extracted when applicable (e.g., "Bash", "Agent", "Read")
  summary TEXT,                  -- extracted/generated one-line summary
  timestamp INTEGER NOT NULL,
  payload JSON NOT NULL,         -- full raw JSONL line
  FOREIGN KEY (agent_id) REFERENCES agents(id),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Indexes
CREATE INDEX idx_events_session ON events(session_id, timestamp);
CREATE INDEX idx_events_agent ON events(agent_id, timestamp);
CREATE INDEX idx_events_type ON events(type, subtype);
CREATE INDEX idx_agents_session ON agents(session_id);
CREATE INDEX idx_agents_parent ON agents(parent_agent_id);
CREATE INDEX idx_sessions_project ON sessions(project_id);
```

### Server Responsibilities

**JSONL Parsing:** When a raw JSONL event arrives at `POST /api/events`, the server:

1. Extracts `sessionId`, `slug`, `type`, `timestamp` from the top level
2. Extracts `project_name` field (added by hook from env var) → maps to project
3. Auto-creates project if new
4. Auto-creates session if new `sessionId`
5. For `type: "progress"` with `data.type: "agent_progress"` — extracts `data.agentId` to create/update subagent records and link to parent
6. Extracts `tool_name` from assistant messages (tool_use content blocks)
7. Generates `summary` from payload (tool name + description, prompt text, etc.)
8. Stores the parsed event and broadcasts via WebSocket

**Parent-Child Linking:** When the server sees an Agent tool use followed by `agent_progress` events containing a `data.agentId`, it creates an agent record with `parent_agent_id` pointing to the calling agent. The `toolUseResult` on completion confirms the link and provides stats.

### API Endpoints

```
POST   /api/events                          -- Receive raw JSONL from hooks
GET    /api/projects                        -- List all projects
GET    /api/projects/:id/sessions           -- Sessions for a project (ordered by recency)
GET    /api/sessions/:id                    -- Session detail with agent tree
GET    /api/sessions/:id/agents             -- Agents for a session (with hierarchy)
GET    /api/sessions/:id/events             -- Events for a session (with filters)
  ?agent_id=<id>                            -- Filter by specific agent(s)
  ?type=<type>                              -- Filter by event type
  ?subtype=<subtype>                        -- Filter by event subtype
  ?search=<regex>                           -- Search event content
  ?limit=<n>&offset=<n>                     -- Pagination
GET    /api/agents/:id/events               -- Events for a specific agent
DELETE /api/data                            -- Clear all data

WebSocket:
  /api/events/stream                        -- Real-time event broadcast
  ?session_id=<id>                          -- Optional: filter to specific session
```

### WebSocket Protocol

```typescript
// Server → Client: new event
{ type: "event", data: ParsedEvent }

// Server → Client: agent status change
{ type: "agent_update", data: { id: string, status: string } }

// Server → Client: new session detected
{ type: "session_update", data: Session }
```

---

## 3. Client

### Tech Stack

- **Framework:** React 19 + TypeScript
- **Build:** Vite
- **UI Components:** shadcn/ui (Radix primitives)
- **Styling:** Tailwind CSS v4
- **Server State:** TanStack Query (fetching, caching, WebSocket sync)
- **UI State:** Zustand (sidebar, filters, selections)
- **Theming:** shadcn light/dark mode only

### Component Architecture

```
App
├── ThemeProvider (shadcn light/dark)
├── Sidebar (collapsible ↔ icon rail, drag-to-resize)
│   ├── SidebarHeader (logo, collapse toggle)
│   ├── ProjectList
│   │   └── ProjectItem (expandable, agent count badge)
│   │       └── AgentTree
│   │           ├── AgentItem (status dot, slug, event count)
│   │           └── AgentItem (subagent, indented with →)
│   └── SidebarFooter (theme toggle, connection status)
├── MainPanel
│   ├── ScopeBar
│   │   ├── ProjectBreadcrumb (current project name)
│   │   ├── SessionSelector (dropdown, defaults to most recent)
│   │   └── AgentChips (active agent filters, dismissible ×)
│   ├── EventFilterBar (pill toggles + search input)
│   ├── ActivityTimeline (drag-resizable height)
│   │   └── AgentLane (one per visible agent, scrolling icons)
│   └── EventStream (virtualized scroll list)
│       └── EventRow (compact, inline-expandable)
│           └── EventDetail (payload, tool output, chat history)
```

### Navigation Hierarchy

```
Project (sidebar)
  → Session (dropdown in scope bar, defaults to most recent)
    → Agents (sidebar tree, auto-populated from session)
      → Subagents (nested under parent in sidebar)
```

**Selection behavior:**
- Click project in sidebar → session dropdown shows sessions for that project, defaults to most recent → sidebar agent tree shows all agents for that session → main area shows all agents
- Click specific agent(s) in sidebar → main area narrows to those agents
- Remove agent chip (×) in scope bar → hides that agent's events
- Switch session via dropdown → everything updates (agent tree, timeline, events)
- "All sessions" option in dropdown → shows agents/events across all sessions for the project

### Scope Bar Layout

```
[my-project] / [Session: twinkly-dragon — 2m ago ▾] | [twinkly-dragon ×] [→ ls-sub ×] [sleepy-fox ×]
```

Session label uses the root agent's slug + relative time for human readability.

### Event Stream

**Compact rows** — each event is a single line:

```
[EventType]  [ToolName — summary]                    [timestamp]
```

**Multi-agent labels** — when multiple agents are in scope, each row gets a small, semi-transparent agent name above the event type, color-matched to the agent's border color:

```
twinkly-dragon                    (small, 60% opacity, green)
[SessionStart]  New session                          [22:24:17]
```

Subagent events prefixed with `→` in the label. Background subtly shifts for subagent rows.

**Single-agent view** — no agent label (cleaner, less noise).

**Inline expansion** — clicking a row expands it in-place to show:
- Full payload JSON (collapsible, with copy button)
- Tool input/output details
- Chat history (if present on the event, rendered inline)

### Activity Timeline

**Separate swim lanes per agent.** Each agent (and subagent) gets its own horizontal lane with emoji icons representing events, scrolling left as time progresses.

- Agent name label on the left of each lane
- Subagent lanes slightly indented and smaller
- Click any icon → auto-scrolls event stream to that event (briefly highlighted)
- Hover → tooltip with event type + summary
- Time range buttons: 1m / 5m / 10m
- **Drag-resizable height** — user can adjust how much vertical space the timeline takes
- Lanes auto-appear/disappear based on agent scope

**Future optimization:** Collapsible to single-lane mode with color dots above icons instead of separate lanes.

### Emoji/Icon Configuration

Standalone config file for easy modification:

```typescript
// src/config/event-icons.ts
export const eventIcons: Record<string, string> = {
  "SessionStart": "🚀",
  "Stop": "🔴",
  "UserPromptSubmit": "💬",
  "UserPromptSubmitResponse": "🗣️",
  "PreToolUse": "🔧",
  "PreToolUse:Bash": "⚡",
  "PreToolUse:Read": "📖",
  "PreToolUse:Write": "✏️",
  "PreToolUse:Edit": "📝",
  "PreToolUse:Agent": "🤖",
  "PreToolUse:Glob": "🔍",
  "PreToolUse:Grep": "🔎",
  "PostToolUse": "✅",
  "progress": "⏳",
  "system": "⚙️",
};

// Lookup with fallback: check "Type:ToolName" first, then "Type", then default
export function getEventIcon(subtype: string, toolName?: string): string {
  if (toolName && eventIcons[`${subtype}:${toolName}`]) {
    return eventIcons[`${subtype}:${toolName}`];
  }
  return eventIcons[subtype] ?? "📌";
}
```

### State Management

**TanStack Query** (server state):
- `useProjects()` — fetch project list
- `useSessions(projectId)` — fetch sessions for a project
- `useAgents(sessionId)` — fetch agent tree for a session
- `useEvents(sessionId, filters)` — fetch events with filtering
- WebSocket subscription invalidates relevant queries on new data

**Zustand** (UI state):
```typescript
interface UIState {
  // Sidebar
  sidebarCollapsed: boolean;
  sidebarWidth: number;

  // Selection
  selectedProjectId: string | null;
  selectedSessionId: string | null;  // null = most recent
  selectedAgentIds: string[];        // empty = all agents in session

  // Filters
  activeEventTypes: string[];        // empty = all types
  searchQuery: string;

  // Timeline
  timelineHeight: number;
  timeRange: "1m" | "5m" | "10m";

  // Event stream
  expandedEventIds: Set<number>;
  scrollToEventId: number | null;    // set by timeline click, consumed by EventStream
}
```

### Theming

shadcn/ui built-in light/dark mode only. Toggle in sidebar footer. Preference persisted to localStorage.

---

## 4. What's Not Included (Dropped from V1)

| Feature | Reason |
|---------|--------|
| Theme system (14 themes + custom builder + sharing) | Replaced by shadcn light/dark |
| HITL response UI | Dashboard is read-only; HITL responses belong in the terminal |
| Chat transcript modal | Chat history shown inline in event expansion instead |
| Old swim lane comparison view | Replaced by timeline lanes + multi-agent event stream |
| Toast notifications for agent joins | Sidebar agent tree shows arrivals naturally |
| Canvas bar chart (LivePulseChart) | Replaced by emoji icon timeline with swim lanes |

---

## 5. Future Enhancements (Not in V1 scope)

- **Timeline single-lane mode:** Collapse swim lanes to single lane with color dots above icons
- **HITL response UI:** Add ability to respond to agent permission/question requests from the dashboard
- **Rich chat transcript viewer:** Dedicated panel or modal for browsing full conversation history
- **Agent teams support:** Group related agents (coordinator + workers) with team-level views
- **Session comparison:** Side-by-side comparison of two sessions
- **Event bookmarking:** Mark interesting events for later review
- **Export:** Export session data as JSON/CSV
