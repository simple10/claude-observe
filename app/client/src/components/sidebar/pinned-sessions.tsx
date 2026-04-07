import { useEffect, useState } from 'react'
import { Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/stores/ui-store'
import { api } from '@/lib/api-client'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Session } from '@/types'

interface PinnedSessionData extends Session {
  projectName?: string
  projectSlug?: string
}

export function PinnedSessions({ collapsed }: { collapsed: boolean }) {
  const pinnedIds = useUIStore((s) => s.pinnedSessionIds)
  const selectedSessionId = useUIStore((s) => s.selectedSessionId)
  const togglePinnedSession = useUIStore((s) => s.togglePinnedSession)
  const [sessions, setSessions] = useState<PinnedSessionData[]>([])

  function selectSession(session: PinnedSessionData) {
    const isSelected = selectedSessionId === session.id
    if (isSelected) {
      useUIStore.getState().setSelectedSessionId(null)
    } else {
      // Set the project context first, then the session
      useUIStore.getState().setSelectedProject(session.projectId, session.projectSlug || null)
      useUIStore.getState().setSelectedSessionId(session.id)
    }
  }

  // Fetch session data for all pinned IDs
  useEffect(() => {
    if (pinnedIds.size === 0) {
      setSessions([])
      return
    }

    const ids = [...pinnedIds]
    Promise.all(ids.map((id) => api.getSession(id).catch(() => null)))
      .then((results) => {
        setSessions(results.filter(Boolean) as PinnedSessionData[])
      })
  }, [pinnedIds])

  if (pinnedIds.size === 0) return null

  if (collapsed) {
    return (
      <div className="px-1 py-1 space-y-1">
        {sessions.map((session) => (
          <Tooltip key={session.id}>
            <TooltipTrigger asChild>
              <button
                className={cn(
                  'flex h-8 w-8 mx-auto items-center justify-center rounded-md text-xs cursor-pointer',
                  selectedSessionId === session.id
                    ? 'bg-primary/10 text-primary border border-primary/30'
                    : 'text-muted-foreground hover:bg-accent',
                )}
                onClick={() => selectSession(session)}
              >
                <Pin className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">{session.slug || session.id.slice(0, 8)}</TooltipContent>
          </Tooltip>
        ))}
      </div>
    )
  }

  return (
    <div className="px-2 py-1">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 dark:text-muted-foreground/60 px-2 pb-0.5 select-none">
        Pinned
      </div>
      {sessions.map((session) => {
        const isSelected = selectedSessionId === session.id
        const label = session.slug || session.id.slice(0, 8)

        return (
          <div key={session.id} className="flex items-center">
            <button
              className={cn(
                'group flex items-center gap-1.5 flex-1 rounded-md px-2 py-1 text-xs transition-colors cursor-pointer',
                isSelected
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
              onClick={() => selectSession(session)}
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  session.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/60 dark:bg-muted-foreground/40',
                )}
              />
              <span className="truncate">{label}</span>
              <Pin
                className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 text-primary/60 hover:text-primary transition-opacity cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation()
                  togglePinnedSession(session.id)
                }}
              />
            </button>
          </div>
        )
      })}
    </div>
  )
}
