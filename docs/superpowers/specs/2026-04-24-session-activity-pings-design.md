# Session Activity Pings — Design

**Date:** 2026-04-24
**Status:** Draft

## Problem

The dashboard gives no at-a-glance signal for which sessions or projects are receiving events *right now*. The sidebar shows every session regardless of live activity, so a user watching a dozen sessions has no way to tell which ones are alive this minute without opening each.

The existing WebSocket channel is per-session: a subscribed client gets every event for its one selected session. That's correct for the main event-stream view but useless for "show a pulse on any active session's sidebar icon."

## Goal

Add a lightweight broadcast-to-all channel that emits a tiny activity ping whenever the server receives an event. The client uses each ping to trigger a brief pulse animation on the corresponding session's sidebar icon and roll that up to the session's project.

## Non-Goals

- **Not a historical feed.** We're not tracking "was this session active in the last hour." The existing `/api/sessions` endpoint already returns `lastActivity` timestamps for that.
- **No client-side persistence.** No localStorage, no IndexedDB. Pings arrive → pulse plays → state dies with the animation.
- **No per-agent granularity.** The sidebar animates at session and project level only. `agentId` is not in the payload. (Easy to add later if per-agent affordances are wanted.)
- **No payload.** The ping does not include the event body. We do not want to duplicate the event firehose across every connected client.
- **No reconnect replay.** A new client does not get a "catch up" ping for sessions that fired in the last 10s. The existing sessions API already shows current status for cold-start; pings are strictly additive for live awareness.

## Hard Constraints

- **Must not regress per-session WebSocket behavior.** The existing subscribed-session channel (event inserts, notifications, session_update broadcasts) keeps working exactly as today.
- **Must not flood the wire.** A single busy session must not generate more than ~1 ping every 10s across all connected clients combined.
- **Ping fan-out cost per event is O(connected clients).** We're not willing to spend more; no fan-out amplification, no per-client state lookup.

## Design

### Server

A single module-level Map in `websocket.ts` (or a small dedicated file):

```ts
// Last time we broadcast an activity ping for this sessionId.
// Global across all connections — not per-connection.
const lastActivityBroadcast = new Map<string, number>()
const ACTIVITY_PING_THROTTLE_MS = 10_000
```

In the events route (`routes/events.ts`), after a successful insert and alongside the existing `notification` / `session_update` broadcasts, add:

```ts
const now = Date.now()
const last = lastActivityBroadcast.get(sessionId) ?? 0
if (now - last >= ACTIVITY_PING_THROTTLE_MS) {
  lastActivityBroadcast.set(sessionId, now)
  broadcastToAll({
    type: 'activity',
    sessionId,
    eventId,
    ts: now,
  })
}
```

**Threshold rationale:** 10s is fast enough that a user glancing at the sidebar sees the pulse "keep going" on a steadily-busy session (the pulse animation is ~1s, so the icon is idle ~9s between flashes — noticeable but not misleading). It's also long enough to cut traffic by one to two orders of magnitude on a tool-heavy session firing multiple events per second.

**Memory:** `lastActivityBroadcast` grows once per session that ever fires on this server process. Stale entries are harmless — they sit on old timestamps forever, each ~50 bytes. No periodic prune.

**Process lifetime:** Map lives for the lifetime of the Node process. Reset on server restart, which is fine — the first ping from each session after restart will always fire.

### Payload

```ts
type ActivityPing = {
  type: 'activity'
  sessionId: string
  eventId: number   // the triggering event id (so client can future-jump to it)
  ts: number        // server-side timestamp (ms epoch)
}
```

`ts` lets the client render timing info if it ever wants to ("last active 3s ago") without trusting its own clock. `eventId` is cheap to include and forward-compatible; no current use case but it makes "click the pulse → open that event" trivially implementable later.

### Client

`ws-client.ts` (or wherever the WS message handler dispatches) adds an `activity` case:

```ts
case 'activity':
  useUIStore.getState().pulseSession(msg.sessionId)
  break
```

A tiny slice on `ui-store.ts`:

```ts
// sessionId -> monotonically-increasing pulse count. Re-incrementing
// triggers React re-render even if the value already existed.
sessionPulses: Map<string, number>
pulseSession: (sessionId: string) => void
```

`pulseSession` is fire-and-forget — it bumps the count for that session. There is **no** "is active" state, no idle timeout, no cleanup. The animation is self-terminating.

### Sidebar animation

`SessionItem` subscribes to `sessionPulses.get(session.id)`. On value change it:
- Applies a CSS class or Tailwind animation (`animate-pulse` is too slow/ambient; we want a single quick "ping" like `animate-[ping_1s_ease-out_1]`).
- Tailwind already ships a `ping` keyframe; confirm or add a custom one.
- The animation runs once and removes itself; no state to reset.

For the **project** rollup, `ProjectList` (or its item component) subscribes to `sessionPulses` too and computes "any session.projectId === this.id pinged recently." A 12s window (slightly longer than the 10s throttle) gives a steady pulse on projects with at least one active session. This *is* a tiny bit of client-side state (last-pulse-per-session timestamp), but it's in-memory only and rebuilds on refresh — no persistence.

Alternative: rather than re-derive per-project, maintain `projectPulses: Map<projectId, number>` updated alongside `sessionPulses` using the session→project lookup already in `useRecentSessions`. Cleaner; same memory. Prefer this.

## Edge Cases

- **Event for unknown session.** The server broadcasts anyway — the client sidebar may not have that session listed yet. The pulse is no-op on the client (no subscriber for that session id). First `/api/sessions` refresh will bring the session in; next ping will pulse it. Acceptable.
- **Rapid back-and-forth between two sessions.** Each session has its own throttle bucket. User gets a pulse on session A, 1s later a pulse on session B, 10s later another A, etc. Correct.
- **Multiple tabs / clients.** All tabs receive the same ping. Each one pulses its own sidebar. No coordination needed. Expected.
- **Event insert fails after the throttle check.** We update `lastActivityBroadcast` *before* the insert succeeds, so a failing insert still suppresses pings for 10s. Fix: update the map only after a successful insert (guard with the existing insert-result check).

## Testing

- **Server unit:** throttle suppresses within 10s, releases after. Isolate the throttle logic (not the whole route) so it's testable without spinning up a WS server.
- **Integration:** POST two events 1s apart → observe exactly one `activity` broadcast. POST two events 11s apart → two broadcasts.
- **Client unit:** `pulseSession` action increments the map; multiple calls for same sessionId each increment. `projectPulses` derivation: pinging session in project P bumps project P's pulse.
- **No UI animation tests.** Animations are visual; skip automated verification. Manual smoke test: open dashboard, send events via `just test-event`, watch sidebar icon pulse.

## Rollout

Single additive change. No feature flag, no migration. Ship it.

## Open Questions

1. **Tailwind `animate-ping` or custom?** `animate-ping` scales + fades — may be too subtle on a small icon. A short brightness/scale bump might read better. Decide during implementation by eyeballing.
2. **Does the pulse apply when the session is the currently-selected one in the sidebar?** Probably yes — it reinforces that events are landing in the session you're watching. But the main event stream already scrolls on new events so the pulse may be redundant. Default to yes; revisit if noisy.
