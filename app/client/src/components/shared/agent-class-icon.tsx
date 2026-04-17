import { AgentRegistry } from '@/agents/registry'
import { cn } from '@/lib/utils'

interface AgentClassIconProps {
  agentClass: string | null | undefined
  className?: string
}

/**
 * Small icon indicating an agent's class (Claude Code, Codex, …).
 * Looks up the registration, falls back to the default when unknown.
 */
export function AgentClassIcon({ agentClass, className }: AgentClassIconProps) {
  const registration = AgentRegistry.get(agentClass || 'claude-code')
  const Icon = registration.Icon
  return <Icon className={cn('h-3 w-3 shrink-0', className)} />
}

/** Display name for an agent class — Claude Code, Codex, or the default label. */
export function agentClassDisplayName(agentClass: string | null | undefined): string {
  return AgentRegistry.get(agentClass || 'claude-code').displayName
}
