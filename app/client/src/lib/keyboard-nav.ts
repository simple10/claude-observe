export function focusSiblingMatching(
  current: HTMLElement,
  selector: string,
  container: HTMLElement,
  direction: -1 | 1,
): boolean {
  const items = Array.from(container.querySelectorAll<HTMLElement>(selector))
  const idx = items.indexOf(current)
  if (idx === -1) return false
  const next = items[idx + direction]
  if (!next) return false
  next.focus()
  return true
}
