// app/server/src/parser.ts

export interface ParsedRawEvent {
  projectName: string
  sessionId: string
  slug: string | null
  type: string
  subtype: string | null
  toolName: string | null
  summary: string | null
  timestamp: number
  subAgentId: string | null
  subAgentName: string | null
  metadata: Record<string, unknown>
  raw: Record<string, unknown>
}

export function parseRawEvent(raw: Record<string, unknown>): ParsedRawEvent {
  const projectName = (raw.project_name as string) || 'unknown';
  // Hook format uses session_id (snake_case), transcript uses sessionId (camelCase)
  const sessionId = (raw.session_id as string) || (raw.sessionId as string) || 'unknown';
  const slug = (raw.slug as string) || null;
  const timestamp = parseTimestamp(raw.timestamp);

  let type: string;
  let subtype: string | null = null;
  let toolName: string | null = null;
  let summary: string | null = null;
  let subAgentId: string | null = null;
  let subAgentName: string | null = null;

  // Detect format: hook events have hook_event_name, transcript events have type
  const hookEventName = raw.hook_event_name as string | undefined;

  if (hookEventName) {
    // === HOOK FORMAT ===
    // Flat structure: { session_id, hook_event_name, tool_name, tool_input, prompt, ... }
    const hookToolName = raw.tool_name as string | undefined;
    const toolInput = raw.tool_input as Record<string, unknown> | undefined;
    const prompt = raw.prompt as string | undefined;

    // Map hook_event_name to type/subtype
    switch (hookEventName) {
      case 'SessionStart':
        type = 'session';
        subtype = 'SessionStart';
        const source = raw.source as string | undefined;
        summary = source ? `Session ${source}` : 'New session';
        break;
      case 'UserPromptSubmit':
        type = 'user';
        subtype = 'UserPromptSubmit';
        if (prompt) summary = `"${truncate(prompt, 80)}"`;
        break;
      case 'PreToolUse':
        type = 'tool';
        subtype = 'PreToolUse';
        toolName = hookToolName || null;
        summary = toolName ? extractToolSummary(toolName, toolInput) : null;
        if (toolName === 'Agent') {
          subAgentName = toolInput?.description as string | undefined || null;
        }
        break;
      case 'PostToolUse':
        type = 'tool';
        subtype = 'PostToolUse';
        toolName = hookToolName || null;
        summary = toolName ? extractToolSummary(toolName, toolInput) : null;
        break;
      case 'Stop':
        type = 'system';
        subtype = 'Stop';
        summary = 'Session stopped';
        break;
      case 'SubagentStop':
        type = 'system';
        subtype = 'SubagentStop';
        summary = 'Subagent stopped';
        break;
      case 'Notification':
        type = 'system';
        subtype = 'Notification';
        summary = (raw.message as string) || null;
        break;
      default:
        type = 'system';
        subtype = hookEventName;
        break;
    }
  } else {
    // === TRANSCRIPT JSONL FORMAT ===
    // Nested structure: { sessionId, type, slug, message, data, ... }
    type = (raw.type as string) || 'unknown';

    if (raw.subtype) {
      subtype = raw.subtype as string;
    }

    const data = raw.data as Record<string, unknown> | undefined;
    const message = raw.message as Record<string, unknown> | undefined;
    const toolUseResult = raw.toolUseResult as Record<string, unknown> | undefined;

    // Progress events: hook_progress or agent_progress
    if (type === 'progress' && data) {
      const dataType = data.type as string;

      if (dataType === 'hook_progress') {
        subtype = (data.hookEvent as string) || null;
        const hookName = data.hookName as string;
        if (hookName && hookName.includes(':')) {
          toolName = hookName.split(':').slice(1).join(':');
        }
      }

      if (dataType === 'agent_progress') {
        subtype = 'agent_progress';
        subAgentId = (data.agentId as string) || null;
        if (data.prompt) {
          summary = truncate(data.prompt as string, 100);
        }
        const nestedMsg = data.message as Record<string, unknown> | undefined;
        if (nestedMsg?.message) {
          const innerMsg = nestedMsg.message as Record<string, unknown>;
          const content = innerMsg.content;
          if (Array.isArray(content)) {
            const toolUse = content.find((c: any) => c.type === 'tool_use') as
              | Record<string, unknown>
              | undefined;
            if (toolUse) {
              toolName = (toolUse.name as string) || null;
              const input = toolUse.input as Record<string, unknown> | undefined;
              const desc = input?.description as string | undefined;
              summary = toolName + (desc ? ` — ${truncate(desc, 80)}` : '');
            }
          }
        }
      }
    }

    // Assistant messages
    if (type === 'assistant' && message) {
      const content = message.content;
      if (Array.isArray(content)) {
        const toolUse = content.find((c: any) => c.type === 'tool_use') as
          | Record<string, unknown>
          | undefined;
        if (toolUse) {
          toolName = (toolUse.name as string) || null;
          const input = toolUse.input as Record<string, unknown> | undefined;
          const desc = input?.description as string | undefined;
          const prompt = input?.prompt as string | undefined;
          summary = toolName || '';
          if (desc) summary += ` — ${truncate(desc, 80)}`;
          else if (prompt) summary += ` — ${truncate(prompt, 80)}`;
          if (toolName === 'Agent' && desc) {
            subAgentName = desc;
          }
        }
      } else if (typeof content === 'string') {
        summary = truncate(content, 100);
      }
    }

    // User messages
    if (type === 'user' && message) {
      const content = message.content;
      if (typeof content === 'string') {
        summary = `"${truncate(content, 80)}"`;
      } else if (Array.isArray(content)) {
        const textBlock = content.find((c: any) => c.type === 'text') as Record<string, unknown> | undefined;
        const toolResult = content.find((c: any) => c.type === 'tool_result') as Record<string, unknown> | undefined;
        if (textBlock?.text) {
          summary = `"${truncate(textBlock.text as string, 80)}"`;
        } else if (toolResult) {
          summary = 'Tool result';
        }
      }
    }

    // toolUseResult — agent completion
    if (toolUseResult) {
      subAgentId = (toolUseResult.agentId as string) || subAgentId;
      const status = toolUseResult.status as string;
      const duration = toolUseResult.totalDurationMs as number;
      if (status) {
        summary = `Agent ${status}`;
        if (duration) summary += ` (${(duration / 1000).toFixed(1)}s)`;
      }
    }
  }

  // Build metadata from top-level fields
  const metadata: Record<string, unknown> = {};
  for (const key of ['version', 'gitBranch', 'cwd', 'entrypoint', 'permissionMode', 'userType', 'permission_mode']) {
    if (raw[key] !== undefined) metadata[key] = raw[key];
  }

  return {
    projectName,
    sessionId,
    slug,
    type,
    subtype,
    toolName,
    summary,
    timestamp,
    subAgentId,
    subAgentName,
    metadata,
    raw,
  };
}

function parseTimestamp(ts: unknown): number {
  if (typeof ts === 'number') return ts
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime()
    return isNaN(parsed) ? Date.now() : parsed
  }
  return Date.now()
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 3) + '...'
}

// Extract a useful one-line summary from tool_input based on tool type
function extractToolSummary(
  toolName: string,
  toolInput: Record<string, unknown> | undefined
): string {
  if (!toolInput) return toolName

  switch (toolName) {
    case 'Bash': {
      const desc = toolInput.description as string | undefined
      const cmd = toolInput.command as string | undefined
      return desc || (cmd ? truncate(cmd, 80) : toolName)
    }
    case 'Read':
    case 'Write':
    case 'Edit': {
      const fp = toolInput.file_path as string | undefined
      return fp ? shortPath(fp) : toolName
    }
    case 'Grep': {
      const pattern = toolInput.pattern as string | undefined
      const path = toolInput.path as string | undefined
      if (pattern && path) return `/${pattern}/ in ${shortPath(path)}`
      if (pattern) return `/${pattern}/`
      return toolName
    }
    case 'Glob': {
      const pattern = toolInput.pattern as string | undefined
      return pattern || toolName
    }
    case 'Agent': {
      const desc = toolInput.description as string | undefined
      return desc ? truncate(desc, 80) : toolName
    }
    default: {
      const desc = toolInput.description as string | undefined
      if (desc) return truncate(desc, 80)
      const cmd = toolInput.command as string | undefined
      if (cmd) return truncate(cmd, 80)
      return toolName
    }
  }
}

// Shorten a file path to just the last 2-3 segments
function shortPath(fp: string): string {
  const parts = fp.split('/')
  if (parts.length <= 3) return fp
  return '.../' + parts.slice(-3).join('/')
}
