import { useState, useMemo } from 'react'
import type { LucideIcon } from 'lucide-react'
import { DynamicIcon, resolveIconName } from '@/lib/dynamic-icon'
import { EVENT_ICON_REGISTRY, type EventIconEntry } from '@/lib/event-icon-registry'
import { useIconCustomizations, COLOR_PRESETS } from '@/hooks/use-icon-customizations'
import { IconPicker } from './icon-picker'
import { ColorPicker } from './color-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Map a Tailwind iconColor class back to the COLOR_PRESETS preset key,
 *  if any. Used to render the default-color swatch in the picker. */
function resolveDefaultColorKey(iconColor: string): string | undefined {
  for (const [key, preset] of Object.entries(COLOR_PRESETS)) {
    if (preset.iconColor === iconColor) return key
  }
  return undefined
}

/** Resolve the PascalCase name of a LucideIcon component (for the icon picker). */
function getIconComponentName(icon: LucideIcon): string {
  return (icon as { displayName?: string }).displayName || icon.name || 'Pin'
}

interface ResolvedEntry {
  /** Registry id — also the localStorage key for customizations. */
  id: string
  /** Display label (e.g. "Bash"). */
  name: string
  /** Section header (e.g. "Tools"). */
  group: string
  /** Default Lucide icon name for the picker. */
  defaultIconName: string
  /** COLOR_PRESETS key matching the default color, if any. */
  defaultColorKey: string | undefined
  /** Tailwind iconColor class to render the preview when no override. */
  defaultIconColorClass: string
}

const ALL_ENTRIES: ResolvedEntry[] = Object.values(EVENT_ICON_REGISTRY).map(
  (entry: EventIconEntry) => ({
    id: entry.id,
    name: entry.name,
    group: entry.group,
    defaultIconName: getIconComponentName(entry.icon),
    defaultColorKey: resolveDefaultColorKey(entry.defaultColor.iconColor),
    defaultIconColorClass: entry.defaultColor.iconColor,
  }),
)

export function IconSettings() {
  const { customizations, setCustomization, resetCustomization, resetAll } = useIconCustomizations()
  const [filter, setFilter] = useState('')

  const hasAnyCustomizations = Object.keys(customizations).length > 0

  const filteredEntries = useMemo(() => {
    if (!filter) return ALL_ENTRIES
    const lower = filter.toLowerCase()
    return ALL_ENTRIES.filter(
      (e) =>
        e.name.toLowerCase().includes(lower) ||
        e.id.toLowerCase().includes(lower) ||
        e.group.toLowerCase().includes(lower),
    )
  }, [filter])

  // Group filtered entries by `group`, preserving the order of first
  // appearance in the registry. Uses a Map so a group whose entries are
  // split across the registry (e.g. a trailing `System` entry after
  // other groups) still gets aggregated into a single section — avoids
  // duplicate React keys.
  const grouped = useMemo(() => {
    const buckets = new Map<string, ResolvedEntry[]>()
    for (const entry of filteredEntries) {
      let bucket = buckets.get(entry.group)
      if (!bucket) {
        bucket = []
        buckets.set(entry.group, bucket)
      }
      bucket.push(entry)
    }
    return Array.from(buckets, ([group, entries]) => ({ group, entries }))
  }, [filteredEntries])

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
            <div key={group.group}>
              <div className="px-2 pt-3 pb-1 first:pt-0">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.group}
                </span>
              </div>
              {group.entries.map((entry) => (
                <EventRow
                  key={entry.id}
                  entry={entry}
                  customization={customizations[entry.id]}
                  onChangeIcon={(iconName) => setCustomization(entry.id, { iconName })}
                  onChangeColor={(colorName, customHex) =>
                    setCustomization(entry.id, { colorName, customHex })
                  }
                  onReset={() => resetCustomization(entry.id)}
                />
              ))}
            </div>
          ))}
          {filteredEntries.length === 0 && (
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
  entry: ResolvedEntry
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

  const useDynamic = !!resolveIconName(activeIconName)
  const FallbackIcon = EVENT_ICON_REGISTRY.Default.icon

  const isCustomColor = activeColorKey === 'custom' && activeCustomHex
  const activeIconColorClass = isCustomColor
    ? ''
    : activeColorKey && COLOR_PRESETS[activeColorKey]
      ? COLOR_PRESETS[activeColorKey].iconColor
      : entry.defaultIconColorClass

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

      {/* Event name: label + id */}
      <div className="flex-1 min-w-0">
        <span className="truncate text-xs">{entry.name}</span>
        {entry.name !== entry.id && (
          <span className="ml-1.5 truncate font-mono text-[10px] text-muted-foreground/60">
            {entry.id}
          </span>
        )}
      </div>

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

      <IconPicker
        currentIconName={activeIconName}
        iconColorClass={!isCustomColor ? activeIconColorClass : ''}
        iconStyle={isCustomColor ? { color: activeCustomHex } : undefined}
        onSelect={onChangeIcon}
      />

      <ColorPicker
        currentColor={activeColorKey}
        customHex={activeCustomHex}
        onSelect={onChangeColor}
        defaultSwatch={defaultSwatch}
      />
    </div>
  )
}
