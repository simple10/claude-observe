import { Hono } from 'hono'
import type { EventStore } from '../storage/types'

type Env = {
  Variables: {
    store: EventStore
  }
}

const router = new Hono<Env>()

// GET /notifications?since=<ts>
// Returns sessions whose latest Notification event is more recent than
// the latest non-notification event (auto-clears on any follow-up
// activity). `since` lets clients resume from their last-seen cursor.
router.get('/notifications', async (c) => {
  const store = c.get('store')
  const sinceParam = c.req.query('since')
  const since = sinceParam ? Number(sinceParam) : 0
  const safeSince = Number.isFinite(since) && since >= 0 ? since : 0

  const rows = await store.getSessionsWithPendingNotifications(safeSince)
  const notifications = rows.map((r: any) => ({
    sessionId: r.session_id,
    projectId: r.project_id,
    latestNotificationTs: r.last_notification_ts,
    count: r.count,
  }))
  return c.json(notifications)
})

export default router
