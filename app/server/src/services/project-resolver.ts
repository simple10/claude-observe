// app/server/src/services/project-resolver.ts
//
// Project resolution per the three-layer contract spec
// (docs/specs/2026-04-25-three-layer-contract-design.md
// §"Project resolution algorithm").
//
// Trigger contract:
//  - The resolver runs at most once per session-event ingest. Callers
//    invoke it after the session row has been upserted, passing
//    `currentProjectId` from the freshly-read session.
//  - If the session already has a project_id, the resolver short-circuits
//    (sticky after first assignment).
//  - Explicit `_meta.project.id` and `_meta.project.slug` are honored
//    unconditionally; sibling matching only fires when the envelope
//    sets `flags.resolveProject`.
//
// Returns the project_id the caller should write back, or `null` to
// leave the session unassigned.

import { dirname } from 'node:path'
import type { EventStore } from '../storage/types'
import type { EventEnvelopeCreationHints, EventEnvelopeFlags } from '../types'
import { deriveSlugFromPath } from '../utils/slug'

export interface ResolveProjectInput {
  sessionId: string
  meta?: EventEnvelopeCreationHints['project']
  flags?: EventEnvelopeFlags
  /** sessions.start_cwd for this session (already populated). */
  startCwd: string | null
  /** sessions.transcript_path for this session (already populated). */
  transcriptPath: string | null
  /** sessions.project_id from the freshly-read row. */
  currentProjectId: number | null
}

export async function resolveProject(
  store: EventStore,
  input: ResolveProjectInput,
): Promise<number | null> {
  if (input.currentProjectId !== null && input.currentProjectId !== undefined) {
    return input.currentProjectId
  }

  // Explicit project.id wins (validated to exist).
  if (input.meta?.id !== undefined && input.meta.id !== null) {
    const exists = await store.getProjectById(input.meta.id)
    if (exists) return exists.id
    // Fall through if the id is invalid — better to attempt slug/sibling
    // resolution than leave the session unassigned because of a stale id.
  }

  // Explicit project.slug — find or create.
  if (input.meta?.slug) {
    const result = await store.findOrCreateProjectBySlug(input.meta.slug)
    return result.id
  }

  // Sibling matching only fires on explicit flag.
  if (input.flags?.resolveProject) {
    const transcriptBasedir = input.transcriptPath ? dirname(input.transcriptPath) : null
    const sibling = await store.findSiblingSessionWithProject({
      startCwd: input.startCwd,
      transcriptBasedir,
      excludeSessionId: input.sessionId,
    })
    if (sibling) return sibling.projectId

    const slugSource = input.startCwd ?? transcriptBasedir
    if (slugSource) {
      const slug = deriveSlugFromPath(slugSource)
      const result = await store.findOrCreateProjectBySlug(slug)
      return result.id
    }
  }

  return null
}
