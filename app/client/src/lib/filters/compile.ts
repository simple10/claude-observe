import type { Filter } from '@/types'
import type { CompiledFilter, CompiledPattern } from './types'

export function compileFilters(filters: readonly Filter[]): CompiledFilter[] {
  const out: CompiledFilter[] = []
  for (const f of filters) {
    if (!f.enabled) continue
    const patterns: CompiledPattern[] = []
    let ok = true
    for (const p of f.patterns) {
      try {
        patterns.push({ target: p.target, regex: new RegExp(p.regex) })
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
