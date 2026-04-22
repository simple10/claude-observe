import { describe, it, expect, beforeEach } from 'vitest'
import { focusSiblingMatching } from './keyboard-nav'

function setup() {
  document.body.innerHTML = `
    <div id="container">
      <button data-item="">A</button>
      <button data-item="">B</button>
      <button data-item="">C</button>
    </div>
  `
  const container = document.getElementById('container') as HTMLElement
  const buttons = Array.from(container.querySelectorAll<HTMLElement>('[data-item]'))
  return { container, buttons }
}

describe('focusSiblingMatching', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('focuses the next sibling and returns true', () => {
    const { container, buttons } = setup()
    buttons[0].focus()
    const result = focusSiblingMatching(buttons[0], '[data-item]', container, 1)
    expect(result).toBe(true)
    expect(document.activeElement).toBe(buttons[1])
  })

  it('focuses the previous sibling and returns true', () => {
    const { container, buttons } = setup()
    buttons[2].focus()
    const result = focusSiblingMatching(buttons[2], '[data-item]', container, -1)
    expect(result).toBe(true)
    expect(document.activeElement).toBe(buttons[1])
  })

  it('returns false at the end (no wraparound)', () => {
    const { container, buttons } = setup()
    buttons[2].focus()
    const result = focusSiblingMatching(buttons[2], '[data-item]', container, 1)
    expect(result).toBe(false)
    expect(document.activeElement).toBe(buttons[2])
  })

  it('returns false at the start (no wraparound)', () => {
    const { container, buttons } = setup()
    buttons[0].focus()
    const result = focusSiblingMatching(buttons[0], '[data-item]', container, -1)
    expect(result).toBe(false)
    expect(document.activeElement).toBe(buttons[0])
  })

  it('returns false when current is not in the list', () => {
    const { container } = setup()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const result = focusSiblingMatching(outside, '[data-item]', container, 1)
    expect(result).toBe(false)
  })
})
