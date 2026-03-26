import { useMemo } from 'react';
import { useUIStore } from '@/stores/ui-store';
import { useEvents } from '@/hooks/use-events';
import { useSessions } from '@/hooks/use-sessions';
import { cn } from '@/lib/utils';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
// Static filters always shown first
const STATIC_FILTERS = [
  { label: 'All', toolName: null },
  { label: 'Prompts', toolName: '__prompts__' },
  { label: 'Tools', toolName: '__tools__' },
  { label: 'Agents', toolName: 'Agent' },
];

// Normalize MCP tool names: mcp__chrome-devtools__click → mcp__chrome-devtools
function normalizeMcpName(name: string): string {
  const match = name.match(/^(mcp__[^_]+(?:_[^_]+)*?)__/);
  return match ? match[1] : name;
}

export function EventFilterBar() {
  const { activeEventTypes, setActiveEventTypes, searchQuery, setSearchQuery,
    selectedProjectId, selectedSessionId } = useUIStore();
  const { data: sessions } = useSessions(selectedProjectId);
  const effectiveSessionId = selectedSessionId || sessions?.[0]?.id || null;
  const { data: events } = useEvents(effectiveSessionId);

  // Build dynamic tool filters from current events
  const dynamicFilters = useMemo(() => {
    if (!events) return [];

    const toolNames = new Set<string>();
    for (const e of events) {
      if ((e.subtype === 'PreToolUse' || e.subtype === 'PostToolUse') && e.toolName) {
        const name = e.toolName;
        // Skip Agent (already in static filters)
        if (name === 'Agent') continue;
        // Normalize MCP tools
        if (name.startsWith('mcp__')) {
          toolNames.add(normalizeMcpName(name));
        } else {
          toolNames.add(name);
        }
      }
    }

    return Array.from(toolNames).sort().map((name) => ({
      label: name,
      toolName: name,
    }));
  }, [events]);

  const activeFilter = activeEventTypes.length === 0 ? null : activeEventTypes.join(',');

  function handleFilter(filter: typeof STATIC_FILTERS[0]) {
    if (filter.toolName === null) {
      // All
      setActiveEventTypes([]);
    } else if (filter.toolName === '__prompts__') {
      setActiveEventTypes(['UserPromptSubmit']);
    } else if (filter.toolName === '__tools__') {
      setActiveEventTypes(['PreToolUse', 'PostToolUse']);
    } else {
      // Specific tool name filter
      setActiveEventTypes([`tool:${filter.toolName}`]);
    }
  }

  function isActive(filter: typeof STATIC_FILTERS[0]): boolean {
    if (filter.toolName === null) return activeEventTypes.length === 0;
    if (filter.toolName === '__prompts__') return activeFilter === 'UserPromptSubmit';
    if (filter.toolName === '__tools__') return activeFilter === 'PreToolUse,PostToolUse';
    return activeFilter === `tool:${filter.toolName}`;
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border">
      <div className="flex items-center gap-1 flex-wrap">
        {STATIC_FILTERS.map((filter) => (
          <button
            key={filter.label}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              isActive(filter)
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent'
            )}
            onClick={() => handleFilter(filter)}
          >
            {filter.label}
          </button>
        ))}

        {dynamicFilters.length > 0 && (
          <span className="w-px h-4 bg-border mx-0.5" />
        )}

        {dynamicFilters.map((filter) => (
          <button
            key={filter.label}
            className={cn(
              'rounded-full px-2.5 py-0.5 text-xs transition-colors',
              isActive(filter)
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-secondary-foreground hover:bg-accent'
            )}
            onClick={() => handleFilter(filter)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="flex-1" />

      <div className="relative w-48">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Search events..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="h-7 pl-7 text-xs"
        />
      </div>
    </div>
  );
}
