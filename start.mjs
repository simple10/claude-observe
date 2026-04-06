#!/usr/bin/env node

/**
 * Starts the API server & dashboard UI in a single process.
 * Used to run the server locally without Docker.
 *
 * Reads all config from hooks/scripts/lib/config.mjs (central source of truth).
 */

import { execFileSync, spawn } from 'node:child_process'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig } from './hooks/scripts/lib/config.mjs'

const rootDir = dirname(fileURLToPath(import.meta.url))
const serverDir = resolve(rootDir, 'app/server')
const clientDir = resolve(rootDir, 'app/client')
const clientDistPath = resolve(clientDir, 'dist')

const config = getConfig()

function run(cmd, args, cwd) {
  const rel = cwd.replace(rootDir + '/', '') || '.'
  console.log(`\n> ${cmd} ${args.join(' ')}  (in ${rel})`)
  execFileSync(cmd, args, { cwd, stdio: 'inherit' })
}

// 1. Install dependencies
run('npm', ['install'], serverDir)
run('npm', ['install'], clientDir)

// 2. Build client
run('npm', ['run', 'build'], clientDir)

// 3. Start server
console.log(`\nStarting server on http://localhost:${config.serverPort} (API + UI)\n`)

const server = spawn('npx', ['tsx', 'src/index.ts'], {
  cwd: serverDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    AGENTS_OBSERVE_SERVER_PORT: config.serverPort,
    AGENTS_OBSERVE_CLIENT_DIST_PATH: clientDistPath,
    AGENTS_OBSERVE_DB_PATH: resolve(config.dataDir, 'observe.db'),
    AGENTS_OBSERVE_LOG_LEVEL: config.logLevel,
    AGENTS_OBSERVE_RUNTIME: 'local',
  },
})

server.on('close', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => server.kill('SIGINT'))
process.on('SIGTERM', () => server.kill('SIGTERM'))
