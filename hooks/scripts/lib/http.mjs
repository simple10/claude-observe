// hooks/scripts/lib/http.mjs
// HTTP helpers for Agents Observe. No dependencies - Node.js built-ins only.

import { request } from 'node:http'
import { request as httpsRequest } from 'node:https'

// Auto timeout requests if they don't return in 5 seconds
const HTTP_DEFAULT_TIMEOUT = 5000

export function httpRequest(url, options, body) {
  const parsed = new URL(url)
  const transport = parsed.protocol === 'https:' ? httpsRequest : request
  const fireAndForget = options.fireAndForget || false
  const log = options.log

  log && log.trace(`Sending HTTP ${options.method} request: ${url}`)

  return new Promise((resolve) => {
    const req = transport(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: options.method || 'GET',
        headers: options.headers || {},
        timeout: HTTP_DEFAULT_TIMEOUT,
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) })
          } catch {
            resolve({ status: res.statusCode, body: data })
          }
        })
      },
    )

    if (fireAndForget) {
      log && log.trace('HTTP fire and forget enabled: unref socket to exit early')
      req.on('socket', (socket) => {
        socket.unref()
      })
    }

    req.on('error', (err) => {
      log && log.error(`HTTP request failed: ${err}`)
      resolve({ status: 0, body: null, error: err.message })
    })
    req.on('timeout', () => {
      log && log.warn(`HTTP request timed out: ${url}`)
      req.destroy()
      resolve({ status: 0, body: null, error: 'timeout' })
    })
    if (body) req.write(body)
    req.end()
  })
}

export function postJson(url, data, { fireAndForget = false, log } = {}) {
  const body = JSON.stringify(data)
  return httpRequest(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      fireAndForget,
      log,
    },
    body,
  )
}

export function getJson(url, { log } = {}) {
  return httpRequest(url, { method: 'GET', log }, null)
}
