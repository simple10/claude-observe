import '@testing-library/jest-dom/vitest'
// Register all agent classes so any component using AgentRegistry (e.g. the
// shared AgentClassIcon rendered in sidebar/session-list) can resolve a
// registration in tests without each test having to import ./agents/init.
import '@/agents/init'

// JSDOM doesn't compute layout, so @tanstack/react-virtual can't measure
// its scroll container and renders 0 items. Mock element dimensions so the
// virtualizer treats the container as having a sensible viewport size.
//
// CAVEAT: these mocks apply to ALL HTMLElements globally. tanstack-virtual
// reads the scroll element's size via offsetHeight, so the scroll container
// also reports 800. With estimateSize=36 and overscan=10 the virtualizer
// renders ~30 rows in tests — fine for current tests but if you write a
// test that needs to assert against a row beyond index ~25, that row may
// not be mounted. Either keep test datasets small or override offsetHeight
// per-test on the scroll container.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get() {
    return 800
  },
})
Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  get() {
    return 800
  },
})
Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
  configurable: true,
  get() {
    return 1200
  },
})

// Minimal ResizeObserver stub — react-virtual uses it for measureElement.
// No-op is fine: estimateSize is used until measureElement runs, and since
// callbacks never fire in tests, all rows stay at the estimated 36px.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}
