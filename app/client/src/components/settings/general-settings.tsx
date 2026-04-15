import { useUIStore } from '@/stores/ui-store'
import { Checkbox } from '@/components/ui/checkbox'

export function GeneralSettings() {
  const dedupEnabled = useUIStore((s) => s.dedupEnabled)
  const setDedupEnabled = useUIStore((s) => s.setDedupEnabled)

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">Event Stream</h3>
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={dedupEnabled}
              onCheckedChange={(v) => setDedupEnabled(v === true)}
              className="mt-0.5"
            />
            <div>
              <div className="text-sm font-medium">Event deduplication</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Merge related hook events into single rows. When enabled, PreToolUse and PostToolUse
                are combined into one tool row, task events are grouped by task ID, and the event
                stream shows a clean summary view.
              </div>
              <div className="text-xs text-muted-foreground/70 mt-1">
                When disabled, every hook event is shown individually with its raw hook name,
                making it easier to debug event payloads and timing.
              </div>
              <div className="text-[10px] text-muted-foreground/50 mt-1">
                Changing this setting will reload the page.
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  )
}
