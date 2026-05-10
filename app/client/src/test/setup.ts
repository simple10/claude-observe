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

// CSS Custom Highlight API polyfill for jsdom.
// Real browsers paint these; jsdom doesn't render — we just need the
// surface so tests can construct, register, and assert on highlights.
if (typeof (globalThis as any).Highlight === 'undefined') {
  class HighlightPolyfill {
    private ranges = new Set<Range>()
    priority = 0
    constructor(...ranges: Range[]) {
      for (const r of ranges) this.ranges.add(r)
    }
    add(range: Range) {
      this.ranges.add(range)
    }
    has(range: Range) {
      return this.ranges.has(range)
    }
    delete(range: Range) {
      return this.ranges.delete(range)
    }
    clear() {
      this.ranges.clear()
    }
    get size() {
      return this.ranges.size
    }
    [Symbol.iterator]() {
      return this.ranges[Symbol.iterator]()
    }
  }
  ;(globalThis as any).Highlight = HighlightPolyfill
}

if (typeof CSS !== 'undefined' && !('highlights' in CSS)) {
  ;(CSS as any).highlights = new Map()
}

// Element.prototype.scrollBy is not implemented in jsdom; LogsModal's
// scrollMatchIntoView calls it on <pre> and the modal scroller. Make it
// a no-op so tests don't throw. Tests that need to assert on scroll
// behavior patch this prototype themselves.
if (typeof Element !== 'undefined' && typeof Element.prototype.scrollBy !== 'function') {
  Element.prototype.scrollBy = function scrollByNoop() {} as typeof Element.prototype.scrollBy
}

// Range.prototype.getBoundingClientRect is not implemented in jsdom;
// scrollMatchIntoView calls it to calculate scroll deltas. Return a
// zero DOMRect so the no-op scrollBy above absorbs the call silently.
if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
  Range.prototype.getBoundingClientRect = function getBoundingClientRectNoop(): DOMRect {
    return new DOMRect(0, 0, 0, 0)
  }
}
