import type { Filter } from '@/types'
import type { CompiledFilter, CompiledPattern } from './types'

/**
 * Wrap a user-authored regex source so it's anchored at the start with
 * a non-greedy "skip" prefix. Critical because the matcher runs against
 * JSON-stringified events (kilobytes long), and an unanchored pattern
 * like `.*h` makes V8 retry at every start position and backtrack
 * catastrophically — O(N^2) per call.
 *
 * The wrap preserves "matches anywhere in the string" semantics:
 *   user regex `is_error`        →  `^.*?(?:is_error)`
 *   user regex `foo|bar`         →  `^.*?(?:foo|bar)`  (alternation scoped)
 *
 * If the user explicitly anchored with `^`, leave it alone — they want
 * "starts with" semantics and we shouldn't second-guess them.
 */
export function wrapWithAnchor(source: string): string {
  if (source.startsWith('^')) return source
  return `^.*?(?:${source})`
}

export function compileFilters(filters: readonly Filter[]): CompiledFilter[] {
  const out: CompiledFilter[] = []
  for (const f of filters) {
    if (!f.enabled) continue
    const patterns: CompiledPattern[] = []
    let ok = true
    for (const p of f.patterns) {
      try {
        patterns.push({ target: p.target, regex: new RegExp(wrapWithAnchor(p.regex)) })
      } catch {
        ok = false
        break
      }
    }
    if (!ok) continue
    out.push({
      id: f.id,
      name: f.name,
      pillName: f.pillName,
      display: f.display,
      combinator: f.combinator,
      patterns,
    })
  }
  return out
}
