// app/server/src/index.ts
import type { Server } from 'http'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createStore } from './storage'
import { attachWebSocket, broadcastToSession, broadcastToAll, broadcastActivity } from './websocket'
import { config } from './config'
import { startConsumerSweep } from './consumer-tracker'

const store = createStore()
const PORT = config.port

// Repair any rows with broken foreign keys before serving traffic.
// Logs what it found so the user knows if state was unexpected.
store.repairOrphans().then((result) => {
  const total =
    result.sessionsReassigned +
    result.agentsDeleted +
    result.agentsReparented +
    result.eventsDeleted
  if (total > 0) {
    console.log(
      `[startup] Repaired orphaned rows: ` +
        `${result.sessionsReassigned} sessions reassigned to 'unknown', ` +
        `${result.agentsDeleted} agents deleted, ` +
        `${result.agentsReparented} agents reparented, ` +
        `${result.eventsDeleted} events deleted`,
    )
  }
})

const app = createApp(store, broadcastToSession, broadcastToAll, broadcastActivity)

function start(retries = 3) {
  const server = serve({ fetch: app.fetch, port: PORT }, () => {
    console.log(`Server running on http://localhost:${PORT}`)
    console.log(`POST events: http://localhost:${PORT}/api/events`)
  })

  ;(server as unknown as Server).on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE' && retries > 0) {
      console.log(`Port ${PORT} in use, retrying in 1s... (${retries} left)`)
      setTimeout(() => start(retries - 1), 1000)
    } else {
      console.error(err)
      process.exit(1)
    }
  })

  attachWebSocket(server as unknown as Server)
  startConsumerSweep()
}

start()
