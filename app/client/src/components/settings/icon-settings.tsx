import { useState, useMemo } from 'react'
import type { LucideIcon } from 'lucide-react'
import { DynamicIcon, resolveIconName } from '@/lib/dynamic-icon'
import { eventIcons, eventColors, defaultEventIcon } from '@/config/event-icons'
import { useIconCustomizations, COLOR_PRESETS } from '@/hooks/use-icon-customizations'
import { IconPicker } from './icon-picker'
import { ColorPicker } from './color-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

// Determine default color key for each event type by matching its CSS classes
// against our COLOR_PRESETS.
function resolveDefaultColorKey(iconColor: string): string | undefined {
  for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
    if (preset.iconColor === iconColor) return key
  }
  return undefined
}

/** Resolve the PascalCase name of a LucideIcon component */
function getIconComponentName(icon: LucideIcon): string {
  return (icon as { displayName?: string }).displayName || icon.name || 'Pin'
}

// Curated list of logical event keys grouped by category
interface EventEntry {
  key: string // logical key (matches resolveEventKey output, e.g., "Bash", "SessionStart")
  label: string // human-readable label
  category: string // grouping header
}

const CURATED_EVENTS: EventEntry[] = [
  // Session
  { key: 'SessionStart', label: 'Session Start', category: 'Session' },
  { key: 'SessionEnd', label: 'Session End', category: 'Session' },
  { key: 'Stop', label: 'Stop', category: 'Session' },
  { key: 'StopFailure', label: 'Stop Failure', category: 'Session' },

  // User Input
  { key: 'UserPromptSubmit', label: 'User Prompt', category: 'User Input' },
  { key: 'UserPromptSubmitResponse', label: 'Prompt Response', category: 'User Input' },

  // Tools
  { key: 'Bash', label: 'Bash', category: 'Tools' },
  { key: 'Read', label: 'Read', category: 'Tools' },
  { key: 'Write', label: 'Write', category: 'Tools' },
  { key: 'Edit', label: 'Edit', category: 'Tools' },
  { key: 'Glob', label: 'Glob', category: 'Tools' },
  { key: 'Grep', label: 'Grep', category: 'Tools' },
  { key: 'WebSearch', label: 'Web Search', category: 'Tools' },
  { key: 'WebFetch', label: 'Web Fetch', category: 'Tools' },
  { key: 'Agent', label: 'Agent', category: 'Tools' },

  // Agents
  { key: 'SubagentStart', label: 'Subagent Start', category: 'Agents' },
  { key: 'SubagentStop', label: 'Subagent Stop', category: 'Agents' },
  { key: 'TeammateIdle', label: 'Teammate Idle', category: 'Agents' },

  // Tasks
  { key: 'TaskCreated', label: 'Task Created', category: 'Tasks' },
  { key: 'TaskCompleted', label: 'Task Completed', category: 'Tasks' },

  // System
  { key: 'PermissionRequest', label: 'Permission Request', category: 'System' },
  { key: 'Notification', label: 'Notification', category: 'System' },
  { key: 'InstructionsLoaded', label: 'Instructions Loaded', category: 'System' },
  { key: 'ConfigChange', label: 'Config Change', category: 'System' },
  { key: 'CwdChanged', label: 'CWD Changed', category: 'System' },
  { key: 'FileChanged', label: 'File Changed', category: 'System' },

  // Compaction
  { key: 'PreCompact', label: 'Pre-Compact', category: 'Compaction' },
  { key: 'PostCompact', label: 'Post-Compact', category: 'Compaction' },

  // MCP
  { key: '_MCP', label: 'MCP Tool', category: 'MCP' },
  { key: 'Elicitation', label: 'Elicitation', category: 'MCP' },
  { key: 'ElicitationResult', label: 'Elicitation Result', category: 'MCP' },

  // Worktrees
  { key: 'WorktreeCreate', label: 'Worktree Create', category: 'Worktrees' },
  { key: 'WorktreeRemove', label: 'Worktree Remove', category: 'Worktrees' },
]

const DEFAULT_EVENT_COLOR: [string, string] = [
  'text-muted-foreground',
  'bg-muted-foreground dark:bg-muted-foreground',
]

// Build resolved event list with defaults from event-icons.ts
interface ResolvedEventEntry extends EventEntry {
  defaultIconName: string
  defaultColorKey: string | undefined
  defaultIconColorClass: string
  defaultDotColorClass: string
}

const EVENT_LIST: ResolvedEventEntry[] = CURATED_EVENTS.map((entry) => {
  const icon = eventIcons[entry.key] || defaultEventIcon
  const [iconColor, dotColor] = eventColors[entry.key] || DEFAULT_EVENT_COLOR
  return {
    ...entry,
    defaultIconName: getIconComponentName(icon),
    defaultColorKey: resolveDefaultColorKey(iconColor),
    defaultIconColorClass: iconColor,
    defaultDotColorClass: dotColor,
  }
})

export function IconSettings() {
  const { customizations, setCustomization, resetCustomization, resetAll } = useIconCustomizations()
  const [filter, setFilter] = useState('')

  const hasAnyCustomizations = Object.keys(customizations).length > 0

  const filteredEvents = useMemo(() => {
    if (!filter) return EVENT_LIST
    const lower = filter.toLowerCase()
    return EVENT_LIST.filter(
      (e) =>
        e.label.toLowerCase().includes(lower) ||
        e.key.toLowerCase().includes(lower) ||
        e.category.toLowerCase().includes(lower),
    )
  }, [filter])

  // Group filtered entries by category, preserving order
  const grouped = useMemo(() => {
    const groups: { category: string; entries: ResolvedEventEntry[] }[] = []
    let currentCategory = ''
    for (const entry of filteredEvents) {
      if (entry.category !== currentCategory) {
        currentCategory = entry.category
        groups.push({ category: currentCategory, entries: [] })
      }
      groups[groups.length - 1].entries.push(entry)
    }
    return groups
  }, [filteredEvents])

  return (
    <div className="flex flex-col gap-3 h-full max-h-full">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter event types..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="h-8 text-sm"
        />
        {hasAnyCustomizations && (
          <Button
            variant="ghost"
            size="xs"
            onClick={resetAll}
            className="shrink-0 text-muted-foreground"
            title="Reset all customizations"
          >
            <RotateCcw className="h-3 w-3" />
            Reset all
          </Button>
        )}
      </div>

      <ScrollArea className="-mx-1" style={{ height: 'calc(80vh - 220px)' }}>
        <div className="space-y-0.5 px-1">
          {grouped.map((group) => (
            <div key={group.category}>
              <div className="px-2 pt-3 pb-1 first:pt-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.category}
                </span>
              </div>
              {group.entries.map((entry) => (
                <EventRow
                  key={entry.key}
                  entry={entry}
                  customization={customizations[entry.key]}
                  onChangeIcon={(iconName) => setCustomization(entry.key, { iconName })}
                  onChangeColor={(colorName, customHex) =>
                    setCustomization(entry.key, { colorName, customHex })
                  }
                  onReset={() => resetCustomization(entry.key)}
                />
              ))}
            </div>
          ))}
          {filteredEvents.length === 0 && (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No event types match your filter.
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

interface EventRowProps {
  entry: ResolvedEventEntry
  customization: { iconName?: string; colorName?: string; customHex?: string } | undefined
  onChangeIcon: (iconName: string) => void
  onChangeColor: (colorName: string, customHex?: string) => void
  onReset: () => void
}

function EventRow({ entry, customization, onChangeIcon, onChangeColor, onReset }: EventRowProps) {
  const hasCustom = !!customization
  const activeIconName = customization?.iconName || entry.defaultIconName
  const activeColorKey = customization?.colorName || entry.defaultColorKey
  const activeCustomHex = customization?.customHex

  // Resolve whether to use dynamic or default icon for preview
  const useDynamic = !!resolveIconName(activeIconName)
  const FallbackIcon = defaultEventIcon

  // Resolve active color class or custom hex
  const isCustomColor = activeColorKey === 'custom' && activeCustomHex
  const activeIconColorClass = isCustomColor
    ? ''
    : activeColorKey && COLOR_PRESETS[activeColorKey]
      ? COLOR_PRESETS[activeColorKey].iconColor
      : entry.defaultIconColorClass

  // Default swatch for color picker
  const defaultSwatch = entry.defaultColorKey
    ? COLOR_PRESETS[entry.defaultColorKey]?.swatch
    : '#6b7280'

  return (
    <div
      className={cn(
        'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50',
        hasCustom && 'bg-accent/30',
      )}
    >
      {/* Preview icon */}
      {useDynamic ? (
        <DynamicIcon
          name={activeIconName}
          className={cn('h-4 w-4 shrink-0', !isCustomColor && activeIconColorClass)}
          style={isCustomColor ? { color: activeCustomHex } : undefined}
        />
      ) : (
        <FallbackIcon
          className={cn('h-4 w-4 shrink-0', !isCustomColor && activeIconColorClass)}
          style={isCustomColor ? { color: activeCustomHex } : undefined}
        />
      )}

      {/* Event name: label + key */}
      <div className="flex-1 min-w-0">
        <span className="truncate text-xs">{entry.label}</span>
        {entry.label !== entry.key && (
          <span className="ml-1.5 truncate font-mono text-[10px] text-muted-foreground/60">
            {entry.key}
          </span>
        )}
      </div>

      {/* Reset button to the left of icon/color pickers */}
      {hasCustom && (
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onReset}
          className="h-5 w-5 shrink-0 text-muted-foreground"
          title="Reset to default"
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      )}

      {/* Icon picker */}
      <IconPicker
        currentIconName={activeIconName}
        iconColorClass={isCustomColor ? '' : activeIconColorClass}
        iconStyle={isCustomColor ? { color: activeCustomHex } : undefined}
        onSelect={onChangeIcon}
      />

      {/* Color picker */}
      <ColorPicker
        currentColor={activeColorKey}
        customHex={activeCustomHex}
        onSelect={onChangeColor}
        defaultSwatch={defaultSwatch}
      />
    </div>
  )
}
