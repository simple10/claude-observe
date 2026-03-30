// app/server/src/index.ts
import type { Server } from 'http'
import { serve } from '@hono/node-server'
import { createApp } from './app'
import { createStore } from './storage'
import { attachWebSocket, broadcastToSession, broadcastToAll } from './websocket'

const store = createStore()
const PORT = parseInt(process.env.CLAUDE_OBSERVE_SERVER_PORT || '4981', 10)

const app = createApp(store, broadcastToSession, broadcastToAll)

const server = serve({ fetch: app.fetch, port: PORT }, () => {
  console.log(`Server running on http://localhost:${PORT}`)
  console.log(`POST events: http://localhost:${PORT}/api/events`)
})

attachWebSocket(server as unknown as Server)
