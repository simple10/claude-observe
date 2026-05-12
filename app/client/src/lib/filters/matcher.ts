import type { RawEvent } from '@/agents/types'
import type { CompiledFilter } from './types'

const VAR_RE = /\{([a-zA-Z]+)\}/g

function resolveVar(name: string, raw: RawEvent, toolName: string | null): string | null {
  switch (name) {
    case 'hookName':
      return raw.hookName ?? null
    case 'toolName':
      return toolName ?? null
    case 'bashCommand': {
      // In the filter context, "bashCommand" resolves to just the binary
      // the user invoked — not the entire command line — so the filter
      // bar collapses to "cat, npm, git, …" instead of one pill per
      // distinct command string.
      //
      // Rules:
      //  - Skip leading env-var assignments (`FOO=bar`, `wait_id=foo;`).
      //  - The binary must be purely alphanumeric. Anything else (`[`,
      //    `./script`, `apt-get`, quoted strings, subshells) is not
      //    emitted — we accept missing the pill for those rather than
      //    flooding the bar with shell-syntax tokens.
      //  - If the first non-env-var token isn't a clean binary, give
      //    up rather than scanning further into the command (avoids
      //    misclassifying an arg of `[` as the binary).
      //
      // Event details rendering uses the full command via a separate
      // code path and is unaffected.
      if (toolName !== 'Bash') return null
      const cmd = (raw.payload as Record<string, any>)?.tool_input?.command
      if (typeof cmd !== 'string' || cmd === '') return null
      const ENV_ASSIGNMENT_RE = /^[A-Za-z_][A-Za-z0-9_]*=/
      const BINARY_RE = /^[A-Za-z0-9]+$/
      for (const tok of cmd.trim().split(/\s+/)) {
        if (!tok) continue
        if (ENV_ASSIGNMENT_RE.test(tok)) continue
        return BINARY_RE.test(tok) ? tok : null
      }
      return null
    }
    default:
      return null
  }
}

function resolvePillName(template: string, raw: RawEvent, toolName: string | null): string | null {
  if (!template.includes('{')) return template
  let nullSeen = false
  const out = template.replace(VAR_RE, (_, key) => {
    const v = resolveVar(key, raw, toolName)
    if (v == null) {
      nullSeen = true
      return ''
    }
    return v
  })
  if (nullSeen) return null
  const trimmed = out.trim()
  return trimmed === '' ? null : trimmed
}

export function applyFilters(
  raw: RawEvent,
  toolName: string | null,
  compiled: readonly CompiledFilter[],
  /**
   * Optional pre-stringified version of `raw`. When provided, the
   * matcher uses it for payload-target regex tests instead of running
   * `JSON.stringify(raw)` here. Caller is responsible for using a
   * stable, semantically-equivalent stringification — typically a
   * cached `JSON.stringify(event)` from upstream. Lets LivePreview
   * stringify once per session and reuse across many test runs.
   */
  prestringified?: string,
): { primary: string[]; secondary: string[] } {
  if (compiled.length === 0) return { primary: [], secondary: [] }

  let payloadText: string | null = prestringified ?? null
  const getPayload = () => payloadText ?? (payloadText = JSON.stringify(raw))

  const primary: string[] = []
  const secondary: string[] = []

  for (const f of compiled) {
    const wantAll = f.combinator === 'and'
    let matched = wantAll
    for (const p of f.patterns) {
      const target =
        p.target === 'hook'
          ? (raw.hookName ?? '')
          : p.target === 'tool'
            ? (toolName ?? '')
            : getPayload()
      // `negate` inverts the regex result so users can express "doesn't
      // match X" without lookahead — important for the planned RE2
      // backend, which omits lookahead/lookbehind entirely.
      const hit = p.negate ? !p.regex.test(target) : p.regex.test(target)
      if (wantAll && !hit) {
        matched = false
        break
      }
      if (!wantAll && hit) {
        matched = true
        break
      }
    }
    if (!matched) continue

    const pillName = resolvePillName(f.pillName, raw, toolName)
    if (pillName == null) continue
    ;(f.display === 'primary' ? primary : secondary).push(pillName)
  }
  return { primary, secondary }
}
