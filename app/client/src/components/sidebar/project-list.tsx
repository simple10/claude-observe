import { useMemo, useState, useRef, useEffect, useCallback } from 'react'
import { useProjects } from '@/hooks/use-projects'
import { useSessions } from '@/hooks/use-sessions'
import { useUIStore } from '@/stores/ui-store'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Folder, Pencil } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import type { Session } from '@/types'

interface ProjectListProps {
  collapsed: boolean
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function getDateGroupLabel(ts: number): string {
  const now = new Date()
  const date = new Date(ts)

  // Start of today (midnight)
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)

  // Start of this week (Monday)
  const startOfThisWeek = new Date(startOfToday)
  const dayOfWeek = startOfToday.getDay()
  // getDay(): 0=Sun, 1=Mon ... 6=Sat. We want Monday as start of week.
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  startOfThisWeek.setDate(startOfThisWeek.getDate() - daysToMonday)

  const startOfLastWeek = new Date(startOfThisWeek)
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7)

  if (date >= startOfToday) {
    return 'Today'
  }
  if (date >= startOfYesterday) {
    return 'Yesterday'
  }
  if (date >= startOfThisWeek) {
    return 'This Week'
  }
  if (date >= startOfLastWeek) {
    return 'Last Week'
  }
  // Older: group by month
  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]
  return `${monthNames[date.getMonth()]} ${date.getFullYear()}`
}

interface SessionGroup {
  label: string
  sessions: Session[]
}

function groupSessionsByDate(sessions: Session[]): SessionGroup[] {
  const groups: SessionGroup[] = []
  let currentLabel: string | null = null
  let currentGroup: Session[] = []

  for (const session of sessions) {
    const label = getDateGroupLabel(session.startedAt)
    if (label !== currentLabel) {
      if (currentLabel !== null && currentGroup.length > 0) {
        groups.push({ label: currentLabel, sessions: currentGroup })
      }
      currentLabel = label
      currentGroup = [session]
    } else {
      currentGroup.push(session)
    }
  }
  if (currentLabel !== null && currentGroup.length > 0) {
    groups.push({ label: currentLabel, sessions: currentGroup })
  }
  return groups
}

export function ProjectList({ collapsed }: ProjectListProps) {
  const { data: projects } = useProjects()
  const { selectedProjectId, setSelectedProjectId } = useUIStore()
  const queryClient = useQueryClient()

  const [editingProjectId, setEditingProjectId] = useState<number | null>(null)
  const [editValue, setEditValue] = useState('')
  const projectInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingProjectId && projectInputRef.current) {
      projectInputRef.current.focus()
      projectInputRef.current.select()
    }
  }, [editingProjectId])

  const startEditingProject = useCallback((projectId: number, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingProjectId(projectId)
    setEditValue(currentName)
  }, [])

  const cancelEditingProject = useCallback(() => {
    setEditingProjectId(null)
    setEditValue('')
  }, [])

  const saveProjectName = useCallback(async (projectId: number) => {
    const trimmed = editValue.trim()
    if (trimmed) {
      await api.renameProject(projectId, trimmed)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
    }
    setEditingProjectId(null)
    setEditValue('')
  }, [editValue, queryClient])

  if (!projects?.length) {
    return (
      <div className="text-xs text-muted-foreground p-2">{collapsed ? '' : 'No projects yet'}</div>
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-1">
        {!collapsed && (
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">
            Projects
          </div>
        )}
        {projects.map((project) => {
          const isSelected = selectedProjectId === project.id
          const isEditingThis = editingProjectId === project.id
          const displayLabel = project.name

          if (collapsed) {
            return (
              <Tooltip key={project.id}>
                <TooltipTrigger asChild>
                  <button
                    className={cn(
                      'flex h-8 w-8 mx-auto items-center justify-center rounded-md text-xs',
                      isSelected
                        ? 'bg-primary/10 text-primary border border-primary/30'
                        : 'text-muted-foreground hover:bg-accent',
                    )}
                    onClick={() => setSelectedProjectId(isSelected ? null : project.id)}
                  >
                    {displayLabel.charAt(0).toUpperCase()}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">{displayLabel}</TooltipContent>
              </Tooltip>
            )
          }

          return (
            <div key={project.id}>
              <button
                className={cn(
                  'group flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-sm transition-colors',
                  isSelected ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-accent',
                )}
                onClick={() => !isEditingThis && setSelectedProjectId(isSelected ? null : project.id)}
              >
                {isSelected ? (
                  <ChevronDown className="h-3.5 w-3.5 shrink-0" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <Folder className="h-3.5 w-3.5 shrink-0" />
                {isEditingThis ? (
                  <input
                    ref={projectInputRef}
                    className="truncate bg-transparent border border-border rounded px-0.5 text-sm outline-none w-full min-w-0"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        saveProjectName(project.id)
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        cancelEditingProject()
                      }
                    }}
                    onBlur={() => saveProjectName(project.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <>
                    <span className="truncate">{displayLabel}</span>
                    <Pencil
                      data-testid={`edit-project-${project.id}`}
                      className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-muted-foreground transition-opacity cursor-pointer"
                      onClick={(e) => startEditingProject(project.id, displayLabel, e)}
                    />
                  </>
                )}
                {!isEditingThis && project.sessionCount != null && (
                  <Badge variant="secondary" className="ml-auto text-[10px] h-4 px-1">
                    {project.sessionCount}
                  </Badge>
                )}
              </button>
              {isSelected && <SessionList projectId={project.id} />}
            </div>
          )
        })}
      </div>
    </TooltipProvider>
  )
}

function shortenCwd(cwd: string): string {
  // Replace /Users/<name> or /home/<name> with ~
  return cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}

function SessionList({ projectId }: { projectId: number }) {
  const { data: sessions } = useSessions(projectId)
  const { selectedSessionId, setSelectedSessionId } = useUIStore()
  const queryClient = useQueryClient()

  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editingSessionId && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editingSessionId])

  const startEditing = useCallback((session: Session, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingSessionId(session.id)
    setEditValue(session.slug || session.id.slice(0, 8))
  }, [])

  const cancelEditing = useCallback(() => {
    setEditingSessionId(null)
    setEditValue('')
  }, [])

  const saveSlug = useCallback(async (sessionId: string) => {
    const trimmed = editValue.trim()
    if (trimmed) {
      await api.updateSessionSlug(sessionId, trimmed)
      await queryClient.invalidateQueries({ queryKey: ['sessions', projectId] })
    }
    setEditingSessionId(null)
    setEditValue('')
  }, [editValue, projectId, queryClient])

  const groups = useMemo(() => {
    if (!sessions?.length) return []
    return groupSessionsByDate(sessions)
  }, [sessions])

  if (!sessions?.length) {
    return <div className="text-xs text-muted-foreground pl-6 py-1">No sessions</div>
  }

  return (
    <div className="ml-4 mt-1 space-y-0.5">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/80 dark:text-muted-foreground/60 px-2 pt-2 pb-0.5 select-none">
            {group.label}
          </div>
          {group.sessions.map((session) => {
            const isSelected = selectedSessionId === session.id
            const isEditing = editingSessionId === session.id
            const label = session.slug || session.id.slice(0, 8)
            const cwd = typeof session.metadata?.cwd === 'string' ? session.metadata.cwd : null
            const activeAgents = session.activeAgentCount ?? 0

            const statusLabel = session.status === 'active' ? 'Active' : 'Ended'
            const tooltipLines = [
              statusLabel,
              cwd,
              activeAgents > 0 ? `${activeAgents} active agent${activeAgents !== 1 ? 's' : ''}` : null,
            ].filter(Boolean)

            return (
              <Tooltip key={session.id}>
                <TooltipTrigger asChild>
                  <div>
                    <button
                      className={cn(
                        'group flex items-center gap-1.5 w-full rounded-md px-2 py-1 text-xs transition-colors',
                        isSelected
                          ? 'bg-accent text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )}
                      onClick={() => !isEditing && setSelectedSessionId(isSelected ? null : session.id)}
                    >
                      <span
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          session.status === 'active' ? 'bg-green-500' : 'bg-muted-foreground/60 dark:bg-muted-foreground/40',
                        )}
                      />
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          className="truncate bg-transparent border border-border rounded px-0.5 text-xs outline-none w-full min-w-0"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              saveSlug(session.id)
                            } else if (e.key === 'Escape') {
                              e.preventDefault()
                              cancelEditing()
                            }
                          }}
                          onBlur={() => saveSlug(session.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <>
                          <span className="truncate">{label}</span>
                          <Pencil
                            data-testid={`edit-session-${session.id}`}
                            className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground/50 hover:text-muted-foreground transition-opacity cursor-pointer"
                            onClick={(e) => startEditing(session, e)}
                          />
                        </>
                      )}
                      {!isEditing && (
                        <span className="text-[10px] text-muted-foreground/80 dark:text-muted-foreground/60 ml-auto shrink-0">
                          {formatRelativeTime(session.startedAt)}
                        </span>
                      )}
                      {!isEditing && session.eventCount != null && (
                        <Badge variant="outline" className="text-[9px] h-3.5 px-1 shrink-0">
                          {session.eventCount}
                        </Badge>
                      )}
                    </button>
                    {cwd && (
                      <div className="px-2 pb-0.5 text-[10px] text-muted-foreground/70 dark:text-muted-foreground/50 truncate">
                        {shortenCwd(cwd)}
                      </div>
                    )}
                  </div>
                </TooltipTrigger>
                {tooltipLines.length > 0 && (
                  <TooltipContent side="right" className="text-xs">
                    {tooltipLines.map((line, i) => (
                      <div key={i}>{line}</div>
                    ))}
                  </TooltipContent>
                )}
              </Tooltip>
            )
          })}
        </div>
      ))}
    </div>
  )
}
