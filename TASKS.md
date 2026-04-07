# TASKS

## QUEUED TASKS

- [ ] Show both Stop and SubagentStop hooks when the Stop filter is used - currently, SubagentStop is only shown for the Agent filter but we need to show all Stop-type events with the Stop filter

## COMPLETED TASKS

- [x] Add transcript_path to agents table
- [x] Enhance events stream expanded summaries (description + Read file.content)

---

## FUTURE TASKS

Don't implement these yet. They're here for future reference.

- [ ] Add env var to disable auto server shutdown
  - Disable auto shutdown when using `just start` and `just dev`
  - Add /observe config to change env vars including the auto shutdown? - good test of how plugins deal with env vars
- [ ] Implement timeline replay feature; see [spec-timeline-rewind.md](docs/plans/_queued/spec-timeline-rewind.md)
- [ ] Track token & context window usage per session and agent
  - On Stop hook, use two-way pattern: hook reads transcript JSONL, sums `usage` fields from all assistant messages, posts totals to `/api/sessions/:id/usage` callback
  - Subagent usage already available in PostToolUse:Agent `tool_response` (totalTokens, totalDurationMs, usage breakdown) — just need to surface in UI
  - Store session-level totals: total input/output tokens, cache read/creation, total duration
  - Show in sidebar (per session) and scope bar (per agent)
  - New `getSessionUsage` command for the two-way hook pattern
