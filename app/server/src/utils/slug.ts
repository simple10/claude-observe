// app/server/src/utils/slug.ts
//
// Phase 3: the heuristic project-dir + multi-candidate slug helpers
// went away. The new project resolver only needs a single deterministic
// slug for find-or-create-by-slug.

import { basename } from 'node:path'

/**
 * Derive a slug from an absolute path. Pure: take the basename,
 * lowercase, replace runs of non-alphanumeric with a single hyphen,
 * trim leading/trailing hyphens. Returns 'unnamed' for empty input.
 *
 * Examples:
 *   /Users/joe/Development/my-app          -> 'my-app'
 *   /Users/joe/.claude/projects/-MyApp     -> 'myapp'
 *   /Users/joe/.codex/sessions/2026/04/17  -> '17'
 *
 * Note: Phase 3 intentionally does NOT collapse Codex's /YYYY/MM/DD
 * structure into a single date slug. The hook lib is the right place
 * for that mapping if Codex needs it; the server stays neutral.
 */
export function deriveSlugFromPath(p: string): string {
  if (!p) return 'unnamed'
  const trimmed = p.replace(/\/+$/, '')
  const base = basename(trimmed) || 'unnamed'
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'unnamed'
}
