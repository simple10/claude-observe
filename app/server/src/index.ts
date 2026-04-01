// app/server/src/index.ts
import type { Server } from 'http'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createStore } from './storage'
import { attachWebSocket, broadcastToSession, broadcastToAll } from './websocket'
import { config } from './config'
import { startConsumerSweep } from './consumer-tracker'

const store = createStore()
const PORT = config.port

const app = createApp(store, broadcastToSession, broadcastToAll)

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
