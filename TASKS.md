# TASKS

## QUEUED TASKS

- [ ] Add support for setting session slug to session_title whenever session_title is in the payload and slug is empty
  - Might be best as UI only?

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
