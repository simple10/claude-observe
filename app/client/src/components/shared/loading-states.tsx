import { Loader2, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

/** Small centered spinner with optional label. */
export function Spinner({
  label,
  size = 'md',
  className,
}: {
  label?: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const iconSize = size === 'sm' ? 'h-3 w-3' : size === 'lg' ? 'h-6 w-6' : 'h-4 w-4'
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 text-muted-foreground text-sm',
        className,
      )}
    >
      <Loader2
        className={cn(iconSize, 'animate-spin will-change-transform')}
        style={{ transform: 'translateZ(0)' }}
      />
      {label && <span>{label}</span>}
    </div>
  )
}

/** Centered empty state with optional icon and hint. */
export function EmptyState({
  text,
  hint,
  icon,
  className,
}: {
  text: string
  hint?: string
  icon?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 text-muted-foreground text-sm py-6',
        className,
      )}
    >
      {icon && <div className="opacity-60 mb-1">{icon}</div>}
      <div>{text}</div>
      {hint && <div className="text-xs opacity-70">{hint}</div>}
    </div>
  )
}

/** Centered error state with a message. */
export function ErrorState({ message, className }: { message?: string; className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1 text-destructive text-sm py-6',
        className,
      )}
    >
      <AlertCircle className="h-4 w-4" />
      <div>{message || 'Something went wrong'}</div>
    </div>
  )
}
