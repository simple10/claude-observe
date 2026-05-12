import type { Filter } from '@/types'
import { RE2JS } from 're2js'
import type { CompiledFilter, CompiledPattern } from './types'

/**
 * Translate the i/m/s string subset we accept on FilterPattern.flags
 * into RE2JS's numeric bitfield. Unknown letters are ignored — the
 * server validator rejects anything outside [ims] before storage, so
 * this is a defensive no-op for those.
 */
export function flagsStringToRE2(flags: string | undefined): number {
  if (!flags) return 0
  let f = 0
  if (flags.includes('i')) f |= RE2JS.CASE_INSENSITIVE
  if (flags.includes('m')) f |= RE2JS.MULTILINE
  if (flags.includes('s')) f |= RE2JS.DOTALL
  return f
}

/**
 * Wrap a user-authored regex source so it's anchored at the start with
 * a non-greedy "skip" prefix. RE2 matches in linear time regardless, so
 * this is no longer a perf hedge — we keep the wrap purely to preserve
 * the historical "match-from-the-start" anchoring semantics that
 * downstream tests rely on. (Stripping it would change where a `.test()`
 * match nominally begins; safe but a behavior change worth its own PR.)
 *
 * The wrap preserves "matches anywhere in the string" semantics:
 *   user regex `is_error`        →  `^.*?(?:is_error)`
 *   user regex `foo|bar`         →  `^.*?(?:foo|bar)`  (alternation scoped)
 *
 * Two cases skip the wrap:
 *  - User explicitly anchored with `^` — respect their intent.
 *  - User's pattern already starts with `.*`, `.+`, `.*?`, or `.+?`.
 *    Just anchor it directly with `^` so we don't doubly-greedy match.
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
          regex: RE2JS.compile(wrapWithAnchor(p.regex), flagsStringToRE2(p.flags)),
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
