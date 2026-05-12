// Defined inline so the matcher module compiles in isolation,
// before Task 3.1 adds the same union types to @/types. Task 3.1
// will re-export these from @/types so the shapes stay aligned.

import type { RE2JS } from 're2js'

export type FilterTarget = 'hook' | 'tool' | 'payload'
export type FilterDisplay = 'primary' | 'secondary'
export type FilterCombinator = 'and' | 'or'
export type FilterKind = 'default' | 'user'

export interface CompiledPattern {
  target: FilterTarget
  /**
   * Compiled regex backed by the RE2 engine (via re2js). Guarantees
   * linear-time matching, so user patterns can't ReDoS the event
   * pipeline. RE2 omits lookahead/lookbehind — negation is expressed
   * via the `negate` flag below.
   */
  regex: RE2JS
  /** Mirrors `FilterPattern.negate` — applyFilters XORs hit with this. */
  negate?: boolean
}

export interface CompiledFilter {
  id: string
  name: string
  pillName: string
  display: FilterDisplay
  combinator: FilterCombinator
  patterns: CompiledPattern[]
}
