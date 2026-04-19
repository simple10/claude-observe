import { useUIStore } from '@/stores/ui-store'
import { useTheme } from '@/components/theme-provider'
import { Checkbox } from '@/components/ui/checkbox'

export function GeneralSettings() {
  const dedupEnabled = useUIStore((s) => s.dedupEnabled)
  const setDedupEnabled = useUIStore((s) => s.setDedupEnabled)
  const notificationsEnabled = useUIStore((s) => s.notificationsEnabled)
  const setNotificationsEnabled = useUIStore((s) => s.setNotificationsEnabled)
  const { mode, setMode } = useTheme()

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-medium mb-3">Appearance</h3>
        <div className="space-y-2">
          <label className="text-xs text-muted-foreground">Theme</label>
          <div className="flex gap-1">
            {(['light', 'dark', 'system'] as const).map((opt) => (
              <button
                key={opt}
                className={`px-3 py-1.5 text-xs rounded-md border transition-colors cursor-pointer ${
                  mode === opt
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
                onClick={() => setMode(opt)}
              >
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

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
              <div className="text-sm font-medium">
                Event deduplication
                <span className="mx-2 text-muted-foreground/70 font-xs">(Recommended)</span>
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Groups related hook events into single rows. Combines PreToolUse and PostToolUse
                events into one tool row, individual events are shown in expanded row details.
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                When disabled, every hook event is shown as an individual row.
              </div>
              <div className="text-xs text-orange-500 dark:text-orange-400 mt-2">
                Changing this setting reloads the page.
              </div>
            </div>
          </label>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-medium mb-3">Sidebar</h3>
        <div className="space-y-4">
          <label className="flex items-start gap-3 cursor-pointer">
            <Checkbox
              checked={notificationsEnabled}
              onCheckedChange={(v) => setNotificationsEnabled(v === true)}
              className="mt-0.5"
            />
            <div>
              <div className="text-sm font-medium">Show notification alerts</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Highlights sessions (and their parent projects) in the sidebar when an agent emits a
                Notification event and is waiting for your input. Click the bell to dismiss it for
                that session.
              </div>
            </div>
          </label>
        </div>
      </div>
    </div>
  )
}
