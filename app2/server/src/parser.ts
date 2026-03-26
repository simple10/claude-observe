// app2/server/src/parser.ts

export interface ParsedRawEvent {
  projectName: string;
  sessionId: string;
  slug: string | null;
  type: string;
  subtype: string | null;
  toolName: string | null;
  summary: string | null;
  timestamp: number;
  subAgentId: string | null;
  subAgentName: string | null;
  metadata: Record<string, unknown>;
  raw: Record<string, unknown>;
}

export function parseRawEvent(raw: Record<string, unknown>): ParsedRawEvent {
  const projectName = (raw.project_name as string) || 'unknown';
  const sessionId = (raw.sessionId as string) || 'unknown';
  const slug = (raw.slug as string) || null;
  const type = (raw.type as string) || 'unknown';
  const timestamp = parseTimestamp(raw.timestamp);

  let subtype: string | null = null;
  let toolName: string | null = null;
  let summary: string | null = null;
  let subAgentId: string | null = null;
  let subAgentName: string | null = null;

  // Extract subtype from system events
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
          const toolUse = content.find(
            (c: any) => c.type === 'tool_use'
          ) as Record<string, unknown> | undefined;
          if (toolUse) {
            toolName = (toolUse.name as string) || null;
            const input = toolUse.input as Record<string, unknown> | undefined;
            const desc = input?.description as string | undefined;
            summary = toolName + (desc ? ` -- ${truncate(desc, 80)}` : '');
          }
        }
      }
    }
  }

  // Assistant messages: extract tool_use info
  if (type === 'assistant' && message) {
    const content = message.content;
    if (Array.isArray(content)) {
      const toolUse = content.find(
        (c: any) => c.type === 'tool_use'
      ) as Record<string, unknown> | undefined;
      if (toolUse) {
        toolName = (toolUse.name as string) || null;
        const input = toolUse.input as Record<string, unknown> | undefined;
        const desc = input?.description as string | undefined;
        const prompt = input?.prompt as string | undefined;
        summary = toolName || '';
        if (desc) summary += ` -- ${truncate(desc, 80)}`;
        else if (prompt) summary += ` -- ${truncate(prompt, 80)}`;

        if (toolName === 'Agent' && desc) {
          subAgentName = desc;
        }
      }
    } else if (typeof content === 'string') {
      summary = truncate(content, 100);
    }
    if (!summary && typeof message.content === 'string') {
      summary = truncate(message.content as string, 100);
    }
  }

  // User messages: extract prompt text or tool_result
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

  // toolUseResult -- agent completion
  if (toolUseResult) {
    subAgentId = (toolUseResult.agentId as string) || subAgentId;
    const status = toolUseResult.status as string;
    const duration = toolUseResult.totalDurationMs as number;
    if (status) {
      summary = `Agent ${status}`;
      if (duration) summary += ` (${(duration / 1000).toFixed(1)}s)`;
    }
  }

  // Build metadata from top-level fields
  const metadata: Record<string, unknown> = {};
  for (const key of ['version', 'gitBranch', 'cwd', 'entrypoint', 'permissionMode', 'userType']) {
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
  if (typeof ts === 'number') return ts;
  if (typeof ts === 'string') {
    const parsed = new Date(ts).getTime();
    return isNaN(parsed) ? Date.now() : parsed;
  }
  return Date.now();
}

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}
