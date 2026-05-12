import type { Filter } from '@/types'
import type { CompiledFilter, CompiledPattern } from './types'

/**
 * Wrap a user-authored regex source so it's anchored at the start with
 * a non-greedy "skip" prefix. Critical because the matcher runs against
 * JSON-stringified events (kilobytes long), and an unanchored pattern
 * like `h` would make V8 retry at every start position — O(N^2) per
 * call.
 *
 * The wrap preserves "matches anywhere in the string" semantics:
 *   user regex `is_error`        →  `^.*?(?:is_error)`
 *   user regex `foo|bar`         →  `^.*?(?:foo|bar)`  (alternation scoped)
 *
 * Two cases skip the wrap:
 *  - User explicitly anchored with `^` — respect their intent.
 *  - User's pattern already starts with `.*`, `.+`, `.*?`, or `.+?`.
 *    They've expressed "match anywhere at start" themselves; wrapping
 *    with another `.*?` would create a doubly-backtracking prefix
 *    (e.g. `^.*?(?:.*Test)`) and trigger O(N^2) on payloads that don't
 *    contain the target literal. Just anchor it directly with `^`.
 */
export function wrapWithAnchor(source: string): string {
  if (source.startsWith('^')) return source
  if (/^\.[*+]\??/.test(source)) return `^${source}`
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
        patterns.push({
          target: p.target,
          regex: new RegExp(wrapWithAnchor(p.regex), p.flags ?? ''),
          ...(p.negate ? { negate: true } : {}),
        })
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
