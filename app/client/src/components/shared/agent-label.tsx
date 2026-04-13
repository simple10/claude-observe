import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getAgentDisplayName } from '@/lib/agent-utils'
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
export function AgentLabel({
  agent,
  parentAgent,
  className,
  disableTooltip,
  tooltipSide = 'right',
  children,
}: AgentLabelProps) {
  const displayName = getAgentDisplayName(agent)
  const hasTooltipContent =
    !disableTooltip && (agent.description || agent.agentType || agent.parentAgentId)

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
          <span className="font-medium">{displayName}</span>
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
