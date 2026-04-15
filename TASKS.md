# TASKS

## QUEUED TASKS

(empty)

## COMPLETED TASKS

- [x] Tweak pinned sessions UI: right-align events pill, hide cwd (tooltip/click only)
- [x] Remove project highlighting from sidebar (folder chevron is enough)
- [x] Add session edit modal (sidebar pencil + scope-bar pencil open modal with details, rename, delete, move, clear logs)
- [x] Replace ScopeBar delete button with edit icon (opens session edit modal)
- [x] Add transcript_path to agents table
- [x] Enhance events stream expanded summaries (description + Read file.content)
- [x] Show SubagentStop with the Stop filter
- [x] Add AGENTS_OBSERVE_SHUTDOWN_DELAY_MS env var, refactor isDev to config
- [x] Audit editable data auto-update (pinned sessions, breadcrumb, project names)
- [x] Guard against orphaned sessions (FK auto-repair + startup orphan repair)

---

## FUTURE TASKS

Don't implement these yet. They're here for future reference.

- [ ] Add /observe config to change env vars including the auto shutdown? - good test of how plugins deal with env vars
- [ ] Track token & context window usage per session and agent
  - On Stop hook, use two-way pattern: hook reads transcript JSONL, sums `usage` fields from all assistant messages, posts totals to `/api/sessions/:id/usage` callback
  - Subagent usage already available in PostToolUse:Agent `tool_response` (totalTokens, totalDurationMs, usage breakdown) — just need to surface in UI
  - Store session-level totals: total input/output tokens, cache read/creation, total duration
  - Show in sidebar (per session) and scope bar (per agent)
  - New `getSessionUsage` command for the two-way hook pattern
