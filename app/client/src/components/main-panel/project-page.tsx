import { useMemo } from 'react'
import { Clock, CalendarDays } from 'lucide-react'
import { useSessions } from '@/hooks/use-sessions'
import { useProjects } from '@/hooks/use-projects'
import { useUIStore } from '@/stores/ui-store'
import { SessionList } from './session-list'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export function ProjectPage() {
  const { selectedProjectId, sessionSortOrder, setSessionSortOrder } = useUIStore()
  const { data: sessions, isLoading } = useSessions(selectedProjectId)
  const { data: projects } = useProjects()
  const project = projects?.find((p) => p.id === selectedProjectId)

  const sorted = useMemo(() => {
    if (!sessions) return []
    if (sessionSortOrder === 'activity') {
      return [...sessions].sort((a, b) => {
        const aTime = a.lastActivity || a.startedAt
        const bTime = b.lastActivity || b.startedAt
        return bTime - aTime
      })
    }
    return [...sessions].sort((a, b) => b.startedAt - a.startedAt)
  }, [sessions, sessionSortOrder])

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold">{project?.name ?? selectedProjectId}</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {sessions?.length ?? 0} session{sessions?.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => setSessionSortOrder(sessionSortOrder === 'activity' ? 'created' : 'activity')}
            >
              {sessionSortOrder === 'activity' ? (
                <><Clock className="h-3 w-3" /> Recent</>
              ) : (
                <><CalendarDays className="h-3 w-3" /> Created</>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left" className="text-xs">
            {sessionSortOrder === 'activity' ? 'Sorted by recent activity' : 'Sorted by creation date'}
          </TooltipContent>
        </Tooltip>
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-32 text-xs text-muted-foreground">
            Loading...
          </div>
        )}
        {!isLoading && sorted.length > 0 && (
          <SessionList sessions={sorted} sortBy={sessionSortOrder} />
        )}
      </div>
    </div>
  )
}
