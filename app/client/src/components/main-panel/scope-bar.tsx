import { useUIStore } from '@/stores/ui-store'
import { Button } from '@/components/ui/button'
import { LogsModal } from './logs-modal'
import { AgentCombobox } from './agent-combobox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  ArrowDownToLine,
  Trash2,
  ChevronsDownUp,
  ChevronsUpDown,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'

export function ScopeBar() {
  const {
    selectedProjectId,
    selectedSessionId,
    setSelectedSessionId,
    autoFollow,
    setAutoFollow,
    expandedEventIds,
    collapseAllEvents,
    requestExpandAll,
  } = useUIStore()
  const queryClient = useQueryClient()

  if (!selectedProjectId || !selectedSessionId) return null

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border min-h-[40px]">
      <AgentCombobox />

      <div className="flex items-center gap-1 shrink-0">
        <LogsModal />
        <Button
          variant={autoFollow ? 'default' : 'ghost'}
          size="icon"
          className="h-7 w-7"
          onClick={() => setAutoFollow(!autoFollow)}
          title={autoFollow ? 'Auto-follow enabled' : 'Auto-follow disabled'}
        >
          <ArrowDownToLine className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => {
            if (expandedEventIds.size > 0) {
              collapseAllEvents()
            } else {
              requestExpandAll()
            }
          }}
          title={expandedEventIds.size > 0 ? 'Collapse all' : 'Expand all'}
        >
          {expandedEventIds.size > 0 ? (
            <ChevronsDownUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              title="Delete or clear session"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete or clear session?</AlertDialogTitle>
              <AlertDialogDescription>
                This only affects Observe logs. Your original Claude session files are not modified.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (selectedSessionId) {
                    await api.clearSessionEvents(selectedSessionId)
                    queryClient.invalidateQueries({ queryKey: ['events'] })
                  }
                }}
              >
                Clear logs
              </AlertDialogAction>
              <AlertDialogAction
                variant="destructive"
                onClick={async () => {
                  if (selectedSessionId) {
                    await api.deleteSession(selectedSessionId)
                    setSelectedSessionId(null)
                    queryClient.invalidateQueries({ queryKey: ['sessions'] })
                    queryClient.invalidateQueries({ queryKey: ['events'] })
                  }
                }}
              >
                Delete session
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  )
}
