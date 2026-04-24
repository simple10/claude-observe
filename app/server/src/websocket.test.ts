import { describe, it, expect } from 'vitest'
import { shouldBroadcastActivity, ACTIVITY_PING_THROTTLE_MS } from './websocket'

describe('shouldBroadcastActivity', () => {
  it('allows the first ping for an unseen session', () => {
    const map = new Map<string, number>()
    expect(shouldBroadcastActivity(map, 'sess-1', 1000)).toBe(true)
  })

  it('suppresses a second ping within the throttle window', () => {
    const map = new Map<string, number>([['sess-1', 1000]])
    expect(shouldBroadcastActivity(map, 'sess-1', 1000 + 1)).toBe(false)
    expect(shouldBroadcastActivity(map, 'sess-1', 1000 + ACTIVITY_PING_THROTTLE_MS / 2)).toBe(false)
    expect(shouldBroadcastActivity(map, 'sess-1', 1000 + ACTIVITY_PING_THROTTLE_MS - 1)).toBe(false)
  })

  it('allows a ping exactly at the threshold boundary', () => {
    const map = new Map<string, number>([['sess-1', 1000]])
    expect(shouldBroadcastActivity(map, 'sess-1', 1000 + ACTIVITY_PING_THROTTLE_MS)).toBe(true)
  })

  it('tracks each session independently', () => {
    const map = new Map<string, number>([['sess-1', 5000]])
    expect(shouldBroadcastActivity(map, 'sess-1', 5001)).toBe(false)
    expect(shouldBroadcastActivity(map, 'sess-2', 5001)).toBe(true)
  })

  it('honors a custom threshold', () => {
    const map = new Map<string, number>([['sess-1', 1000]])
    expect(shouldBroadcastActivity(map, 'sess-1', 2000, 1000)).toBe(true)
    expect(shouldBroadcastActivity(map, 'sess-1', 2000, 10_000)).toBe(false)
  })

  it('treats a missing entry as never-sent', () => {
    const map = new Map<string, number>()
    expect(shouldBroadcastActivity(map, 'sess-1', 0)).toBe(true)
    expect(shouldBroadcastActivity(map, 'sess-1', Number.MAX_SAFE_INTEGER)).toBe(true)
  })
})
