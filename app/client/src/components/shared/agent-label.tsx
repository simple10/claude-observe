import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getAgentDisplayName } from '@/lib/agent-utils'
import type { Agent } from '@/types'

interface AgentLabelProps {
  agent: Agent
  /** Parent agent (for "Sub-Agent of X" line) */
  parentAgent?: Agent | null
  className?: string
  children?: React.ReactNode
}

/**
 * Renders an agent display name with a tooltip showing description,
 * agent type, and parent relationship. Wrap any inline agent name
 * in this component to get consistent tooltips everywhere.
 */
export function AgentLabel({ agent, parentAgent, className, children }: AgentLabelProps) {
  const displayName = getAgentDisplayName(agent)
  const hasTooltipContent = agent.description || agent.agentType || agent.parentAgentId

  if (!hasTooltipContent) {
    return <span className={className}>{children ?? displayName}</span>
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={className}>{children ?? displayName}</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <div className="flex flex-col gap-0.5 text-left">
          {agent.description && (
            <span>{agent.description}</span>
          )}
          {agent.agentType && (
            <span className="opacity-70">Type: {agent.agentType}</span>
          )}
          {agent.parentAgentId && (
            <span className="opacity-70">
              Sub-Agent of {parentAgent ? getAgentDisplayName(parentAgent) : 'Main'}
            </span>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
