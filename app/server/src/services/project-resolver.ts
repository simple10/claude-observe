import type { EventStore } from '../storage/types'
import {
  extractProjectDir,
  deriveSlugCandidates,
  deriveSlugCandidatesFromCwd,
  normalizeCwd,
} from '../utils/slug'

export interface ResolveProjectInput {
  sessionId: string
  slug: string | null
  transcriptPath: string | null
  cwd?: string | null
}

export interface ResolveProjectResult {
  projectId: number
  projectSlug: string
  created: boolean
}

async function pickAvailableSlug(store: EventStore, candidates: string[]): Promise<string> {
  for (const candidate of candidates) {
    if (await store.isSlugAvailable(candidate)) return candidate
  }
  const base = candidates[0]
  let suffix = 2
  while (!(await store.isSlugAvailable(`${base}-${suffix}`))) {
    suffix++
  }
  return `${base}-${suffix}`
}

export async function resolveProject(
  store: EventStore,
  input: ResolveProjectInput,
): Promise<ResolveProjectResult> {
  const { slug, transcriptPath } = input
  const cwd = normalizeCwd(input.cwd ?? null)

  // 1. Explicit slug override — find or create
  if (slug) {
    const existing = await store.getProjectBySlug(slug)
    if (existing) {
      // Opportunistically backfill cwd on a pre-existing project if we
      // now know it and the project doesn't yet have one recorded.
      if (cwd && !existing.cwd) {
        await store.updateProjectCwd(existing.id, cwd)
      }
      return { projectId: existing.id, projectSlug: existing.slug, created: false }
    }
    const projectDir = transcriptPath ? extractProjectDir(transcriptPath) : null
    const id = await store.createProject(slug, slug, projectDir, cwd)
    return { projectId: id, projectSlug: slug, created: true }
  }

  // 2. Match by cwd — lets sessions from a reopened project reuse the
  // same project record regardless of transcript storage layout.
  if (cwd) {
    const existing = await store.getProjectByCwd(cwd)
    if (existing) {
      return { projectId: existing.id, projectSlug: existing.slug, created: false }
    }
    // Fall through to creation; prefer cwd-derived slug candidates so
    // the slug reflects the project directory rather than a transcript
    // storage quirk (e.g. Codex's date-based session dirs).
    const projectDir = transcriptPath ? extractProjectDir(transcriptPath) : null
    const finalSlug = await pickAvailableSlug(store, deriveSlugCandidatesFromCwd(cwd))
    const id = await store.createProject(finalSlug, finalSlug, projectDir, cwd)
    return { projectId: id, projectSlug: finalSlug, created: true }
  }

  // 3. Match by transcript_path
  if (transcriptPath) {
    const projectDir = extractProjectDir(transcriptPath)
    const existing = await store.getProjectByTranscriptPath(projectDir)
    if (existing) {
      return { projectId: existing.id, projectSlug: existing.slug, created: false }
    }

    const finalSlug = await pickAvailableSlug(store, deriveSlugCandidates(transcriptPath))
    const id = await store.createProject(finalSlug, finalSlug, projectDir, null)
    return { projectId: id, projectSlug: finalSlug, created: true }
  }

  // 4. No slug, no cwd, no transcript_path - use "unknown" project
  const unknown = await store.getProjectBySlug('unknown')
  if (unknown) {
    return { projectId: unknown.id, projectSlug: 'unknown', created: false }
  }
  const id = await store.createProject('unknown', 'unknown', null, null)
  return { projectId: id, projectSlug: 'unknown', created: true }
}
