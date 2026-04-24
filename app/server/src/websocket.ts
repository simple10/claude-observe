import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import type { WSClientMessage } from './types'
import { config } from './config'
import { checkShutdown, cancelPendingShutdown } from './consumer-tracker'

const LOG_LEVEL = config.logLevel

// Track which session each client is subscribed to
const clientSessions = new Map<WebSocket, string>()
const allClients = new Set<WebSocket>()

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/api/events/stream' })

  wss.on('connection', (ws) => {
    allClients.add(ws)
    cancelPendingShutdown()
    console.log(`[WS] Client connected (${allClients.size} total)`)

    ws.on('message', (raw) => {
      try {
        const msg: WSClientMessage = JSON.parse(raw.toString())
        if (msg.type === 'subscribe' && msg.sessionId) {
          const prev = clientSessions.get(ws)
          clientSessions.set(ws, msg.sessionId)
          if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
            const prevInfo = prev ? ` (was: ${prev.slice(0, 8)})` : ''
            console.log(`[WS] Client subscribed to session ${msg.sessionId.slice(0, 8)}${prevInfo}`)
          }
        } else if (msg.type === 'unsubscribe') {
          const prev = clientSessions.get(ws)
          clientSessions.delete(ws)
          if (LOG_LEVEL === 'debug' || LOG_LEVEL === 'trace') {
            console.log(
              `[WS] Client unsubscribed${prev ? ` from session ${prev.slice(0, 8)}` : ''}`,
            )
          }
        }
      } catch {}
    })

    ws.on('close', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
      console.log(`[WS] Client disconnected (${allClients.size} remaining)`)
      checkShutdown()
    })

    ws.on('error', () => {
      allClients.delete(ws)
      clientSessions.delete(ws)
    })
  })

  console.log('[WS] WebSocket enabled on /api/events/stream')
}

/** Send a message only to clients subscribed to a specific session */
export function broadcastToSession(sessionId: string, message: object): void {
  const json = JSON.stringify(message)
  for (const [client, subSessionId] of clientSessions) {
    if (subSessionId === sessionId && client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

// Activity pings tell every connected client that a given session just
// received an event, so the sidebar can animate a pulse. Throttle to
// once per session per ACTIVITY_PING_THROTTLE_MS so a busy session
// doesn't flood the wire with hundreds of pings/second × all clients.
// The map is process-global (not per-connection): slightly less
// responsive on cold-start but trivially small memory and simple to
// reason about. See docs/superpowers/specs/2026-04-24-session-activity-pings-design.md.
export const ACTIVITY_PING_THROTTLE_MS = 5_000
const lastActivityBroadcast = new Map<string, number>()

/** Pure throttle predicate — testable without any WS machinery.
 *  Returns true if a ping should be sent now; caller must update the map. */
export function shouldBroadcastActivity(
  lastMap: Map<string, number>,
  sessionId: string,
  now: number,
  thresholdMs: number = ACTIVITY_PING_THROTTLE_MS,
): boolean {
  const last = lastMap.get(sessionId)
  if (last === undefined) return true
  return now - last >= thresholdMs
}

/** Broadcast an activity ping for a session if we haven't sent one for
 *  this session within the throttle window. Safe to call on every event. */
export function broadcastActivity(sessionId: string, eventId: number): void {
  const now = Date.now()
  if (!shouldBroadcastActivity(lastActivityBroadcast, sessionId, now)) return
  lastActivityBroadcast.set(sessionId, now)
  broadcastToAll({ type: 'activity', data: { sessionId, eventId, ts: now } })
}

/** Clear the activity throttle state. Test-only. */
export function resetActivityThrottleForTests(): void {
  lastActivityBroadcast.clear()
}

/** Send a message to ALL connected clients (for global updates) */
export function broadcastToAll(message: object): void {
  const json = JSON.stringify(message)
  for (const client of allClients) {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(json)
      } catch {
        allClients.delete(client)
        clientSessions.delete(client)
      }
    }
  }
}

export function getClientCount(): number {
  return allClients.size
}
