import { useState, useEffect, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api-client'
import { useUIStore } from '@/stores/ui-store'
import { Dialog, DialogContent, DialogClose, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Pencil, Trash2, Check, X } from 'lucide-react'
import type { Project, Session } from '@/types'

interface ProjectModalProps {
  project: Project | null
  open: boolean
  onOpenChange: (open: boolean) => void
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

export function ProjectModal({ project, open, onOpenChange }: ProjectModalProps) {
  const queryClient = useQueryClient()
  const { selectedProjectId, setSelectedProject } = useUIStore()

  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [selectedSessionIds, setSelectedSessionIds] = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState<'project' | 'sessions' | null>(null)
  const [deleting, setDeleting] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)

  const { data: sessions } = useQuery({
    queryKey: ['sessions', project?.id],
    queryFn: () => api.getSessions(project!.id),
    enabled: open && !!project,
  })

  // Sort sessions by most recent activity first
  const sortedSessions = sessions
    ? [...sessions].sort((a, b) => (b.stoppedAt ?? b.startedAt) - (a.stoppedAt ?? a.startedAt))
    : []

  // Reset state when modal opens/closes or project changes
  useEffect(() => {
    setIsRenaming(false)
    setRenameValue('')
    setSelectedSessionIds(new Set())
    setConfirmDelete(null)
  }, [open, project?.id])

  useEffect(() => {
    if (isRenaming) renameInputRef.current?.focus()
  }, [isRenaming])

  if (!project) return null

  function startRenaming() {
    setRenameValue(project!.name)
    setIsRenaming(true)
  }

  async function saveRename() {
    const trimmed = renameValue.trim()
    if (!trimmed || trimmed === project!.name) {
      setIsRenaming(false)
      return
    }
    await api.renameProject(project!.id, trimmed)
    await queryClient.invalidateQueries({ queryKey: ['projects'] })
    setIsRenaming(false)
  }

  async function handleDeleteProject() {
    setDeleting(true)
    try {
      await api.deleteProject(project!.id)
      if (selectedProjectId === project!.id) setSelectedProject(null)
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['sessions'] })
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
      onOpenChange(false)
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }

  async function handleDeleteSelectedSessions() {
    setDeleting(true)
    try {
      await Promise.all([...selectedSessionIds].map((id) => api.deleteSession(id)))
      setSelectedSessionIds(new Set())
      await queryClient.invalidateQueries({ queryKey: ['sessions', project!.id] })
      await queryClient.invalidateQueries({ queryKey: ['projects'] })
      await queryClient.invalidateQueries({ queryKey: ['recentSessions'] })
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
    }
  }

  function toggleSession(id: string) {
    setSelectedSessionIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    if (selectedSessionIds.size === sortedSessions.length) {
      setSelectedSessionIds(new Set())
    } else {
      setSelectedSessionIds(new Set(sortedSessions.map((s) => s.id)))
    }
  }

  const allSelected = sortedSessions.length > 0 && selectedSessionIds.size === sortedSessions.length

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="w-[540px] max-w-[90vw] max-h-[80vh] flex flex-col p-0">
          {/* Header: project name + actions */}
          <div className="flex items-center gap-3 px-5 pt-5 pb-3">
            {isRenaming ? (
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <Input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveRename()
                    if (e.key === 'Escape') setIsRenaming(false)
                  }}
                  className="h-8 text-sm"
                />
                <Button variant="ghost" size="icon-xs" onClick={saveRename}>
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon-xs" onClick={() => setIsRenaming(false)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <>
                <DialogTitle
                  className="flex-1 min-w-0 truncate cursor-pointer hover:underline"
                  onClick={startRenaming}
                >
                  {project.name}
                </DialogTitle>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0"
                  onClick={startRenaming}
                  title="Rename project"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDelete('project')}
                  title="Delete project"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
                <DialogClose asChild>
                  <Button variant="ghost" size="icon-xs" className="shrink-0" title="Close">
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </DialogClose>
              </>
            )}
          </div>

          {/* Session list */}
          <div className="flex-1 min-h-0 overflow-y-auto border-t">
            {sortedSessions.length > 0 ? (
              <div className="divide-y divide-border/50">
                {/* Select all header */}
                <div className="flex items-center gap-3 px-5 py-2 bg-muted/30">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={toggleAll}
                  />
                  <span className="text-xs text-muted-foreground">
                    {sortedSessions.length} session{sortedSessions.length !== 1 ? 's' : ''}
                    {selectedSessionIds.size > 0 && (
                      <span className="ml-1">({selectedSessionIds.size} selected)</span>
                    )}
                  </span>
                  {selectedSessionIds.size > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="ml-auto text-destructive hover:text-destructive"
                      onClick={() => setConfirmDelete('sessions')}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Delete selected
                    </Button>
                  )}
                </div>
                {sortedSessions.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    selected={selectedSessionIds.has(session.id)}
                    onToggle={() => toggleSession(session.id)}
                    onDelete={() => {
                      setSelectedSessionIds(new Set([session.id]))
                      setConfirmDelete('sessions')
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
                No sessions
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialogs */}
      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDelete === 'project'
                ? `Delete project "${project.name}"?`
                : `Delete ${selectedSessionIds.size} session${selectedSessionIds.size !== 1 ? 's' : ''}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete === 'project'
                ? 'This will permanently delete this project and all its Observe logs. Your original Claude session files are not modified.'
                : 'This will permanently delete the selected session logs. Your original Claude session files are not modified.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (confirmDelete === 'project') handleDeleteProject()
                else if (confirmDelete === 'sessions') handleDeleteSelectedSessions()
              }}
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function SessionRow({
  session,
  selected,
  onToggle,
  onDelete,
}: {
  session: Session
  selected: boolean
  onToggle: () => void
  onDelete: () => void
}) {
  const label = session.slug || session.id.slice(0, 8)
  const time = formatRelativeTime(session.stoppedAt ?? session.startedAt)

  return (
    <div className="flex items-center gap-3 px-5 py-2 hover:bg-muted/20">
      <Checkbox checked={selected} onCheckedChange={onToggle} />
      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{label}</div>
        <div className="text-[10px] text-muted-foreground">
          {time}
          {session.eventCount != null && (
            <span className="ml-2">{session.eventCount} events</span>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  )
}
