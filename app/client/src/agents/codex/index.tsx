// Codex agent class registration. Reuses the default renderer (generic JSON
// payload) but surfaces a Codex-branded icon + display name for UI hints.

import { Terminal } from 'lucide-react'
import { AgentRegistry } from '../registry'
import {
  processEvent,
  DefaultRowSummary,
  DefaultEventDetail,
  DefaultDotTooltip,
} from '../default/index'

AgentRegistry.register({
  agentClass: 'codex',
  displayName: 'codex',
  Icon: Terminal,
  processEvent,
  getEventIcon: () => Terminal,
  getEventColor: () => ({
    iconColor: 'text-muted-foreground',
    dotColor: 'bg-muted-foreground',
  }),
  RowSummary: DefaultRowSummary,
  EventDetail: DefaultEventDetail,
  DotTooltip: DefaultDotTooltip,
})
