/**
 * Extracts the project directory from a transcript path.
 * e.g. "/Users/joe/.claude/projects/-Users-joe-Dev-my-app/session.jsonl"
 *    -> "/Users/joe/.claude/projects/-Users-joe-Dev-my-app"
 */
export function extractProjectDir(transcriptPath: string): string {
  let p = transcriptPath.replace(/\/+$/, '')
  if (p.includes('/') && /\.\w+$/.test(p.split('/').pop()!)) {
    p = p.slice(0, p.lastIndexOf('/'))
  }
  return p
}

/**
 * Normalize a filesystem cwd for equality comparisons: strip a trailing
 * slash and collapse an empty string to null. Does NOT resolve symlinks
 * or canonicalize relative parts — callers pass absolute paths.
 */
export function normalizeCwd(cwd: string | null | undefined): string | null {
  if (!cwd) return null
  const trimmed = cwd.replace(/\/+$/, '')
  return trimmed || null
}

/**
 * Derive slug candidates from an absolute cwd path.
 * Returns candidates in order of preference:
 *   1. Basename (last path segment)
 *   2. Last two path segments joined by '-'
 *   3. Last three, etc.
 *
 * e.g. "/Users/joe/Development/my-app" -> ["my-app", "development-my-app", …]
 *
 * Caller should check each candidate for availability.
 */
export function deriveSlugCandidatesFromCwd(cwd: string): string[] {
  const normalized = normalizeCwd(cwd)
  if (!normalized) return ['unknown']
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) return ['unknown']
  const candidates: string[] = []
  for (let i = 1; i <= parts.length; i++) {
    const slug = parts
      .slice(parts.length - i)
      .join('-')
      .toLowerCase()
    candidates.push(slug)
  }
  return candidates
}

/**
 * If the path ends in /YYYY/MM/DD (e.g. Codex's date-based session
 * directory layout /Users/joe/.codex/sessions/2026/04/17), collapse it
 * into a single slug like "2026-04-17". Returns null otherwise.
 *
 * Without this, Codex's first-session-of-the-day would be resolved to a
 * project slug of just "17" (the last path segment).
 */
function extractDateSlug(dir: string): string | null {
  const match = dir.match(/\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/?$/)
  if (!match) return null
  const [, y, m, d] = match
  return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/**
 * Derives slug candidates from a Claude project directory path.
 * The directory name is a dash-joined encoding of the absolute path,
 * e.g. "-Users-joe-Development-opik-agent-super-spy-agents-observe"
 *
 * Returns candidates in order of preference:
 *   1. Last two segments (e.g. "agents-observe")
 *   2. Last three segments (e.g. "spy-agents-observe")
 *   3. etc.
 *
 * Special case: if the path ends with /YYYY/MM/DD (Codex's session
 * layout), a single "YYYY-MM-DD" candidate is returned instead.
 *
 * Caller should check each candidate for availability.
 */
export function deriveSlugCandidates(pathOrDir: string): string[] {
  const dir = extractProjectDir(pathOrDir)

  const dateSlug = extractDateSlug(dir)
  if (dateSlug) return [dateSlug]

  const encoded = dir.split('/').pop() || ''
  const parts = encoded.split('-').filter(Boolean)

  if (parts.length === 0) return ['unknown']

  const candidates: string[] = []
  const minParts = Math.min(2, parts.length)
  for (let i = minParts; i <= parts.length; i++) {
    const slug = parts
      .slice(parts.length - i)
      .join('-')
      .toLowerCase()
    candidates.push(slug)
  }

  if (parts.length === 1) {
    return [parts[0].toLowerCase()]
  }

  return candidates
}
