# Design Spec: Timeline Rewind

## Problem

The timeline is anchored to `Date.now()` — the right edge is always "now." This means events from completed or historical sessions have already scrolled off the left edge and are invisible. Users can only see events happening in real-time.

## Goal

Let users browse historical session data by scrolling through the timeline. The timeline and event stream should stay in sync — scrolling one pane should move the other to show the same time period.

## Two modes

**Live mode** (default): Timeline animates in real-time. Right edge = now. Events drift left and eventually disappear. This is the existing behavior.

**Rewind mode** (user-activated toggle): Timeline is frozen. All session events are visible as static dots positioned by timestamp. The user scrolls through history.

## Key design constraints

### 1. The two panes have different geometries

The event stream is a vertical list with equal-height rows (regardless of time gaps). The timeline is horizontal and time-proportional (events clustered in time appear close together). A naive scroll-ratio sync (`scrollTop/scrollHeight = scrollLeft/scrollWidth`) will feel wrong when event density varies — scrolling past 50 rapid events barely moves the timeline, while a single event after a gap jumps it.

**Lesson learned:** Viewport tracking by timestamp (find the first visible event's timestamp, scroll the timeline to that time) is more accurate than ratio mapping.

### 2. Scroll sync must avoid React re-renders

Any approach that updates React state on every scroll frame will be janky. The sync must happen entirely in the DOM — read scroll position, compute target, set `scrollLeft` — with zero state updates.

**Lesson learned:** Store a callback function (`timelineScrollTo`) in the Zustand store. The timeline registers it; the event stream calls it from a passive scroll listener inside `requestAnimationFrame`. All DOM, no React.

### 3. The timeline needs native horizontal scrolling in rewind mode

In rewind mode, the timeline should be a natively scrollable pane (GPU-composited, buttery smooth). All events rendered as static dots at absolute pixel positions. The total width is proportional to the session's time span.

**Lesson learned:** Agent name labels need `position: sticky; left: 0` with an opaque background so they stay visible while dots scroll behind them.

### 4. Initial sync matters

When entering rewind mode, the timeline must immediately sync with wherever the event stream is currently scrolled — not hardcode to the right edge or left edge. Otherwise the first user interaction causes a jarring jump.

**Lesson learned:** The initial sync should be triggered from the event stream side (it knows its own scroll position) after the timeline has registered its scroll callback.

### 5. Scroll direction bias

The sync should position the first visible event near the **left edge** of the timeline viewport, not centered. This keeps the majority of the viewport showing newer events (to the right), which is what users care about. Centering wastes half the viewport on older events the user has already scrolled past.

### 6. New events arriving during rewind

When `autoFollow` is disabled (which it should be in rewind mode), neither pane auto-scrolls. New events appear at the bottom of the event stream and the right edge of the timeline, but the user's viewport stays stable. The timeline may need to extend its total width to accommodate new events, which slightly repositions existing dots — this should be negligible for a few events at a time.

### 7. Transitioning between modes

Switching from rewind to live (or vice versa) needs a clean break — no stale CSS state should carry over. A full remount of timeline dots (via React key change) on mode switch is the safest approach.

## Open questions for implementation

- Should the user be able to directly scroll the timeline horizontally in rewind mode (in addition to scroll-sync from the event stream)? If so, should that reverse-sync to the event stream?
- Should the time range buttons (1m/5m/10m/60m) be visible in rewind mode? They don't apply to a static layout, but a zoom concept might be useful.
- How should the timeline handle very long sessions (hours)? At 120px/min, a 2-hour session is 14400px. This is fine for native scroll but a lot of dots in the DOM.
- Should PreToolUse/PostToolUse events be deduplicated in the timeline (as they are in the event stream)?
