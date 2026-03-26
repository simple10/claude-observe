import type { Agent } from '@/types';

// Display name for an agent
export function getAgentDisplayName(agent: Agent): string {
  // Root agent = "Main"
  if (!agent.parentAgentId) return 'Main';

  // Subagent: use name (from Agent tool description), slug, or truncated ID
  return agent.name || agent.slug || agent.id.slice(0, 8);
}
