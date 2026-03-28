// app/server/src/app.ts
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from '@hono/node-server/serve-static'
import path from 'path'
import fs from 'fs'
import type { EventStore } from './storage/types'

import eventsRouter from './routes/events'
import projectsRouter from './routes/projects'
import sessionsRouter from './routes/sessions'
import agentsRouter from './routes/agents'
import adminRouter from './routes/admin'
import pollRouter from './routes/poll'
import healthRouter from './routes/health'

type Env = { Variables: { store: EventStore; broadcast: (msg: object) => void } }

export function createApp(store: EventStore, broadcast: (msg: object) => void) {
  const app = new Hono<Env>()

  app.use('*', cors())

  // Inject store and broadcast into all routes
  app.use('*', async (c, next) => {
    c.set('store', store)
    c.set('broadcast', broadcast)
    await next()
  })

  app.route('/api', eventsRouter)
  app.route('/api', projectsRouter)
  app.route('/api', sessionsRouter)
  app.route('/api', agentsRouter)
  app.route('/api', adminRouter)
  app.route('/api', pollRouter)
  app.route('/api', healthRouter)

  // Serve built client static files when CLIENT_DIST_PATH is set
  const clientDistPath = process.env.CLIENT_DIST_PATH
  if (clientDistPath && fs.existsSync(clientDistPath)) {
    app.use('/*', serveStatic({ root: path.relative(process.cwd(), clientDistPath) }))

    // Return 404 for unmatched API routes before SPA fallback
    app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404))

    // SPA fallback: serve index.html for all non-API routes
    const indexHtml = fs.readFileSync(path.join(clientDistPath, 'index.html'), 'utf8')
    app.get('*', (c) => c.html(indexHtml))
  }

  return app
}
