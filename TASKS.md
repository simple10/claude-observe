# TASKS

## QUEUED TASKS

(empty)

## COMPLETED TASKS

(keep)

---

## FUTURE TASKS

Don't implement these yet. They're here for future reference.

- [ ] Implement timeline replay feature; see [spec-timeline-rewind.md](docs/plans/_queued/spec-timeline-rewind.md)
- [ ] Track token & context window usage per session and agent
  - On Stop hook, use two-way pattern: hook reads transcript JSONL, sums `usage` fields from all assistant messages, posts totals to `/api/sessions/:id/usage` callback
  - Subagent usage already available in PostToolUse:Agent `tool_response` (totalTokens, totalDurationMs, usage breakdown) — just need to surface in UI
  - Store session-level totals: total input/output tokens, cache read/creation, total duration
  - Show in sidebar (per session) and scope bar (per agent)
  - New `getSessionUsage` command for the two-way hook pattern
