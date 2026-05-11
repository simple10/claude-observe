// Defined inline so the matcher module compiles in isolation,
// before Task 3.1 adds the same union types to @/types. Task 3.1
// will re-export these from @/types so the shapes stay aligned.

export type FilterTarget = 'hook' | 'tool' | 'payload'
export type FilterDisplay = 'primary' | 'secondary'
export type FilterCombinator = 'and' | 'or'
export type FilterKind = 'default' | 'user'

export interface CompiledPattern {
  target: FilterTarget
  regex: RegExp
}

export interface CompiledFilter {
  id: string
  name: string
  pillName: string
  display: FilterDisplay
  combinator: FilterCombinator
  patterns: CompiledPattern[]
}
