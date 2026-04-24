/** Client-side tuning for activity pulses from the server.
 *
 *  Server-side throttle (see app/server/src/websocket.ts) caps pings at
 *  one per session per 10s. The pulse animation should fade within the
 *  window so sessions look "quiet" between pings instead of continuously
 *  animating. 3s is short enough to feel like a heartbeat without being
 *  so short that it gets lost. */
export const ACTIVITY_CONFIG = {
  pulseDurationMs: 5_000,
} as const
