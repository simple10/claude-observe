import { memo } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getAgentDisplayName } from '@/lib/agent-utils'
import { AgentClassIcon, agentClassDisplayName } from '@/components/shared/agent-class-icon'
import type { Agent } from '@/types'

interface AgentLabelProps {
  agent: Agent
  /** Parent agent (for "Sub of X" line) */
  parentAgent?: Agent | null
  className?: string
  /** Disable tooltip — just render the name */
  disableTooltip?: boolean
  /** Tooltip placement (default: "right") */
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
  children?: React.ReactNode
}

/**
 * Renders an agent display name with a tooltip showing description,
 * agent type, and parent relationship. Wrap any inline agent name
 * in this component to get consistent tooltips everywhere.
 */
function AgentLabelInner({
  agent,
  parentAgent,
  className,
  disableTooltip,
  tooltipSide = 'right',
  children,
}: AgentLabelProps) {
  const displayName = getAgentDisplayName(agent)
  const hasTooltipContent =
    !disableTooltip &&
    (agent.description || agent.agentType || agent.parentAgentId || agent.agentClass)

  if (!hasTooltipContent) {
    return <span className={className}>{children ?? displayName}</span>
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{children ?? displayName}</span>
      </TooltipTrigger>
      <TooltipContent side={tooltipSide} className="max-w-xs">
        <div className="flex flex-col gap-0.5 text-left">
          {agent.description && agent.description !== displayName && (
            <span>{agent.description}</span>
          )}
          <span className="flex items-center gap-1.5">
            <AgentClassIcon agentClass={agent.agentClass} />
            <span className="font-medium">{displayName}</span>
            <span className="text-[10px] opacity-60">
              {agentClassDisplayName(agent.agentClass)}
            </span>
          </span>
          {agent.cwd && (
            <span className="text-[10px] opacity-60 font-mono truncate" dir="rtl">
              <span dir="ltr">{agent.cwd.replace(/^\/(?:Users|home)\/[^/]+/, '~')}</span>
            </span>
          )}
          {agent.agentType && <span className="opacity-70">Type: {agent.agentType}</span>}
          {agent.parentAgentId && (
            <span className="text-[10px] opacity-50">
              Sub of {parentAgent ? getAgentDisplayName(parentAgent) : 'Main'}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

// useAgents returns a new Agent[] on every WS flush even when the agents
// themselves haven't changed — so the agent/parentAgent refs passed to
// AgentLabel turn over constantly. Compare by display-relevant fields
// instead, so the Tooltip tree only reconciles when something the user
// could actually see has changed.
function agentFieldsEqual(a: Agent | null | undefined, b: Agent | null | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.description === b.description &&
    a.agentType === b.agentType &&
    a.agentClass === b.agentClass &&
    a.cwd === b.cwd &&
    a.parentAgentId === b.parentAgentId
  )
}

export const AgentLabel = memo(AgentLabelInner, (prev, next) => {
  if (prev.className !== next.className) return false
  if (prev.disableTooltip !== next.disableTooltip) return false
  if (prev.tooltipSide !== next.tooltipSide) return false
  if (prev.children !== next.children) return false
  if (!agentFieldsEqual(prev.agent, next.agent)) return false
  if (!agentFieldsEqual(prev.parentAgent, next.parentAgent)) return false
  return true
})
