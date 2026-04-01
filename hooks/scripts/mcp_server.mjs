#!/usr/bin/env node
// hooks/scripts/mcp_server.mjs
// MCP stdio server for Agents Observe plugin.
// Starts Docker container, then responds to MCP JSON-RPC protocol.

import { createInterface } from 'node:readline'
import { getConfig } from './lib/config.mjs'
import { startServer, stopServer } from './lib/docker.mjs'
import { getJson } from './lib/http.mjs'
import { createLogger } from './lib/logger.mjs'

const config = getConfig()
const log = createLogger('mcp.log', config)

async function main() {
  const actualPort = await startServer(config)
  if (!actualPort) {
    log.error('Failed to start server')
    process.exit(1)
  }

  log.info(`Dashboard: http://127.0.0.1:${actualPort}`)

  const cleanup = async () => {
    clearInterval(healthInterval)
    if (!config.mcpPersist) {
      await stopServer(config)
    }
    process.exit(0)
  }
  process.on('SIGTERM', cleanup)
  process.on('SIGINT', cleanup)

  // Periodic health check — exit if the Docker container goes down
  const HEALTH_CHECK_INTERVAL = 10_000
  const HEALTH_CHECK_MAX_FAILURES = 3
  let healthFailures = 0
  const healthUrl = `http://127.0.0.1:${actualPort}/api/health`

  const healthInterval = setInterval(async () => {
    try {
      const result = await getJson(healthUrl)
      if (result.status === 200 && result.body?.ok) {
        healthFailures = 0
      } else {
        healthFailures++
        log.warn(`Health check failed (${healthFailures}/${HEALTH_CHECK_MAX_FAILURES})`)
      }
    } catch {
      healthFailures++
      log.warn(`Health check error (${healthFailures}/${HEALTH_CHECK_MAX_FAILURES})`)
    }
    if (healthFailures >= HEALTH_CHECK_MAX_FAILURES) {
      log.error('Docker container is unreachable, exiting MCP server')
      await cleanup()
    }
  }, HEALTH_CHECK_INTERVAL)

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
