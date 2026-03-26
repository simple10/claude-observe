// app/hooks/send_event.mjs
// Dumb pipe: reads JSONL from stdin, adds project_name, POSTs to server.
// No dependencies -- uses only Node.js built-ins.

import { request } from 'node:http';
import { readFileSync } from 'node:fs';

const projectName = process.env.CLAUDE_OBSERVE_PROJECT_NAME
if (!projectName) {
  process.exit(0) // Silently skip if not configured
}

const port = parseInt(process.env.CLAUDE_OBSERVE_PORT || '4001', 10)

let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  input += chunk
})
process.stdin.on('end', () => {
  if (!input.trim()) process.exit(0)

  let payload
  try {
    payload = JSON.parse(input)
  } catch {
    process.exit(0) // Silently skip malformed input
  }

  payload.project_name = projectName;

  // On Stop events, read the transcript file and attach as chat
  if (payload.hook_event_name === 'Stop' && payload.transcript_path) {
    try {
      const lines = readFileSync(payload.transcript_path, 'utf8')
        .split('\n')
        .filter(Boolean);
      payload.chat = lines.map(line => {
        try { return JSON.parse(line); }
        catch { return null; }
      }).filter(Boolean);
    } catch {
      // Transcript file not readable — skip
    }
  }

  const body = JSON.stringify(payload)
  const req = request(
    {
      hostname: '127.0.0.1',
      port,
      path: '/api/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      timeout: 3000,
    },
    (res) => {
      res.resume() // Drain response
      process.exit(0)
    }
  )

  req.on('error', () => process.exit(0)) // Silently fail -- don't block the agent
  req.on('timeout', () => {
    req.destroy()
    process.exit(0)
  })
  req.write(body)
  req.end()
})
