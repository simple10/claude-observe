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
  /** Optional per-filter config bag (color, etc.). Defaults to {}. */
  config?: Record<string, unknown>
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
    // "Tool hooks, with a tool name that isn't Agent / TaskCreate /
    // TaskUpdate / mcp__*". Expressed as: tool hook + non-empty
    // tool name + negated match against the excluded set. The
    // negated pattern was previously a `(?!...)` lookahead; lookahead
    // isn't supported by RE2 (planned backend), so we use the
    // explicit `negate` flag instead.
    patterns: [
      { target: 'hook', regex: '^(PreToolUse|PostToolUse|PostToolUseFailure|PostToolBatch)$' },
      { target: 'tool', regex: '^.+' },
      { target: 'tool', regex: '^(Agent$|TaskCreate$|TaskUpdate$|mcp__)', negate: true },
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
