#!/usr/bin/env node
// hooks/scripts/mcp_server.mjs
// MCP stdio server for Agents Observe plugin.
// Starts Docker container, then responds to MCP JSON-RPC protocol.

import { createInterface } from 'node:readline'
import { getConfig } from './lib/config.mjs'
import { startServer } from './lib/docker.mjs'
import { postJson } from './lib/http.mjs'
import { createLogger } from './lib/logger.mjs'

const config = { ...getConfig() }

// Override log level to enable all logs to the mcp.log file
config.logLevel = 'trace'
const log = createLogger('mcp.log', config)

async function main() {
  log.info(`Starting server...`)

  const actualPort = await startServer(config)
  if (!actualPort) {
    log.error('Failed to start server')
    process.exit(1)
  }

  log.info(`Server running at: http://127.0.0.1:${actualPort}`)

  const consumerId = `mcp-${process.pid}`
  const heartbeatUrl = `http://127.0.0.1:${actualPort}/api/consumer/heartbeat`
  const deregisterUrl = `http://127.0.0.1:${actualPort}/api/consumer/deregister`

  const cleanup = async () => {
    clearInterval(heartbeatInterval)
    await postJson(deregisterUrl, { id: consumerId }, { log })
    log.info('Deregistered from server')
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)

  // Heartbeat loop — registers this MCP process and detects server going down
  const HEARTBEAT_INTERVAL = 10_000
  const HEARTBEAT_MAX_FAILURES = 3
  let heartbeatFailures = 0

  async function sendHeartbeat() {
    const result = await postJson(heartbeatUrl, { id: consumerId }, { log })
    if (result.status === 200) {
      heartbeatFailures = 0
    } else {
      heartbeatFailures++
      log.warn(`Heartbeat failed (${heartbeatFailures}/${HEARTBEAT_MAX_FAILURES})`)
    }
    if (heartbeatFailures >= HEARTBEAT_MAX_FAILURES) {
      log.error('Server is unreachable, exiting MCP process')
      clearInterval(heartbeatInterval)
      process.exit(1)
    }
  }

  // Initial heartbeat to register immediately
  await sendHeartbeat()

  const heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL)

  // MCP JSON-RPC protocol on stdio
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    if (!line.trim()) return
    try {
      handleMessage(JSON.parse(line))
    } catch {
      // Ignore unparseable lines
    }
  })
  rl.on('close', cleanup)
}

function handleMessage(msg) {
  const { method, id } = msg

  log.debug(`Received message: ${JSON.stringify(msg)}`)

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: msg.params?.protocolVersion || '2024-11-05',
        capabilities: {},
        serverInfo: {
          name: 'agents-observe',
          version: config.expectedVersion || '0.0.0',
        },
      },
    })
    return
  }

  // Notifications (no id) need no response
  if (method === 'notifications/initialized') return

  // Standard list methods — we have no tools, resources, or prompts
  if (method === 'tools/list') {
    send({ jsonrpc: '2.0', id, result: { tools: [] } })
    return
  }
  if (method === 'resources/list') {
    send({ jsonrpc: '2.0', id, result: { resources: [] } })
    return
  }
  if (method === 'prompts/list') {
    send({ jsonrpc: '2.0', id, result: { prompts: [] } })
    return
  }

  // Unknown request — respond with error
  if (id != null) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } })
  }
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

main().catch((err) => {
  log.error(`MCP server failed: ${err.message}`)
  process.exit(1)
})
