// app/server/src/consumer-tracker.ts
// Tracks registered API consumers (MCP processes) with TTL-based expiry.
// The server shuts itself down when no consumers and no WS clients remain.

import { getClientCount } from './websocket'
import { config } from './config'

const CONSUMER_TTL_MS = 30_000
const SWEEP_INTERVAL_MS = 10_000
const STARTUP_GRACE_MS = 60_000

const consumers = new Map<string, number>() // id → last heartbeat timestamp
const startedAt = Date.now()
const devMode = config.runtime === 'local'

let sweepTimer: ReturnType<typeof setInterval> | null = null

if (devMode) {
  console.log('[consumer] Running in dev mode — auto-shutdown is disabled')
}

/** Start the periodic sweep that evicts stale consumers. */
export function startConsumerSweep() {
  if (sweepTimer) return
  sweepTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, lastSeen] of consumers) {
      if (now - lastSeen > CONSUMER_TTL_MS) {
        consumers.delete(id)
        console.log(`[consumer] Evicted stale consumer ${id}`)
      }
    }
    checkShutdown()
  }, SWEEP_INTERVAL_MS)
}

/** Register or refresh a consumer heartbeat. Returns current consumer count. */
export function heartbeat(id: string): number {
  consumers.set(id, Date.now())
  return consumers.size
}

/** Remove a consumer. Returns { activeConsumers, activeClients }. */
export function deregister(id: string): { activeConsumers: number; activeClients: number } {
  consumers.delete(id)
  const counts = { activeConsumers: consumers.size, activeClients: getClientCount() }
  checkShutdown()
  return counts
}

/** Current consumer count. */
export function getConsumerCount(): number {
  return consumers.size
}

/** Check if the server should shut down (no consumers, no WS clients). */
export function checkShutdown() {
  if (consumers.size === 0 && getClientCount() === 0) {
    if (Date.now() - startedAt < STARTUP_GRACE_MS) {
      console.log('[consumer] No active consumers or clients, but within startup grace period — skipping shutdown')
      return
    }
    console.log('[consumer] No active consumers or clients, shutting down')
    if (devMode) {
      console.log('[consumer] Dev mode — shutdown skipped')
      return
    }
    if (sweepTimer) clearInterval(sweepTimer)
    // Give a brief grace period for in-flight responses to complete
    setTimeout(() => process.exit(0), 500)
  }
}
