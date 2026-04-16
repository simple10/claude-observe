#!/usr/bin/env bun
/**
 * Checks that hook events and commands are consistent across our config files,
 * and ensures we don't register hooks that would cause unintended side effects.
 *
 * Uses .claude/settings.json as the authoritative source.
 *
 * Checks:
 * 1. All config files have the same hook events
 * 2. Commands match structurally (same script/args after normalizing path prefixes)
 * 3. All safe documented hooks from code.claude.com are present
 * 4. No blacklisted hooks are registered (hooks that replace default behavior)
 * 5. AI-assisted analysis of hook docs for additional exclusions
 *
 * Usage: bun scripts/check-hooks.ts [--skip-ai] [--output-prompt]
 */

import { readFileSync } from 'fs'
import { spawnSync } from 'child_process'

const HOOKS_DOC_URL = 'https://code.claude.com/docs/en/hooks.md'

const AUTHORITATIVE = '.claude/settings.json'
const TARGETS = ['hooks/hooks.json']

// Hooks that replace default Claude Code behavior and MUST NOT be registered
// by an observability plugin. Registering these delegates critical functionality
// to our hook, which we don't implement.
const BLACKLIST = new Set(['WorktreeCreate'])

// Path prefixes used in each file — stripped for comparison
const PATH_PREFIXES = [
  '$CLAUDE_PROJECT_DIR',
  '${CLAUDE_PLUGIN_ROOT}',
  '__HOOK_SCRIPT_DIR__',
  '__HOOK_SCRIPT__',
]

const SKIP_AI = process.argv.includes('--skip-ai')
const OUTPUT_PROMPT = process.argv.includes('--output-prompt')
const HELP = process.argv.includes('--help') || process.argv.includes('-h')

if (HELP) {
  console.log(`Usage: bun scripts/check-hooks.ts [options]

Checks that hook events and commands are consistent across our config files,
and ensures we don't register hooks that would cause unintended side effects.

Options:
  --skip-ai         Skip AI-assisted analysis of hook docs (faster, no claude CLI)
  --output-prompt   Print only the AI-analysis prompt (for piping to a file) and exit
  -h, --help        Show this help message and exit`)
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HookEntry {
  type: string
  command: string
}

interface HookConfig {
  [event: string]: { matcher?: string; hooks: HookEntry[] }[]
}

function readHooks(path: string): HookConfig {
  const json = JSON.parse(readFileSync(path, 'utf8'))
  return json.hooks ?? {}
}

/** Normalize a command by stripping known path prefixes */
function normalizeCommand(cmd: string): string {
  let normalized = cmd
  for (const prefix of PATH_PREFIXES) {
    normalized = normalized.replace(prefix, '<ROOT>')
  }
  return normalized.trim()
}

/** Extract normalized commands for each event */
function getEventCommands(hooks: HookConfig): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [event, matchers] of Object.entries(hooks)) {
    const commands = matchers.flatMap((m) =>
      (m.hooks || []).map((h: HookEntry) => normalizeCommand(h.command)),
    )
    result.set(event, commands)
  }
  return result
}

async function fetchDocumentedHooks(): Promise<string[]> {
  try {
    const res = await fetch(HOOKS_DOC_URL)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const md = await res.text()
    const hooks = new Set<string>()
    for (const line of md.split('\n')) {
      const match = line.match(/^\|\s*`([A-Z][A-Za-z]+)`\s*\|/)
      if (match) hooks.add(match[1])
    }
    if (hooks.size === 0) throw new Error('No hooks parsed')
    return [...hooks]
  } catch (err) {
    console.warn(`  ⚠  Could not fetch documented hooks: ${err}`)
    return []
  }
}

/** Build the prompt sent to the claude CLI for hook-safety analysis. */
function buildAiPrompt(hooksDocMd: string): string {
  return `You are analyzing Claude Code hook documentation for a plugin called "agents-observe" that is purely an observability/logging plugin. It should ONLY register hooks where it can safely observe events WITHOUT affecting Claude Code's behavior.

Your task is to classify each hook event documented below into one of three categories:

## Categories

### "blacklist" — NEVER register
Hooks where registering a handler that exits 0 with no stdout causes Claude Code to break, skip, or corrupt default behavior. These hooks either:
- Replace a default Claude Code action (the handler takes ownership of performing the action itself and must return a result), OR
- Require the handler to produce specific stdout/JSON on exit 0 for Claude Code to proceed normally — absence of that output is treated as failure, blocking, or incorrect behavior

The defining property: a silent, successful handler (exit 0, empty stdout) does NOT mean "allow / proceed normally" for these hooks. An observability plugin must never register them.

### "flagged" — safe when handler exits 0 with no output, but ambiguous parsing is a risk
Hooks that correctly treat exit 0 with no stdout as "allow / proceed normally", BUT where Claude Code parses stdout on exit 0 looking for specific JSON decision fields, and malformed or partial output could be misinterpreted as a blocking/modifying directive. Include a hook here only if BOTH conditions hold:
1. Exit 0 with truly empty stdout preserves default behavior (otherwise it's blacklist), AND
2. Claude Code inspects stdout on exit 0 for decision fields (e.g., "decision": "block", "permissionDecision": "deny", "continue": false, hookSpecificOutput directives), such that accidental output — stray logging to stdout, a misformatted JSON fragment, a shell profile banner, or a partial write — could be parsed as a directive that blocks or alters Claude's flow

These are acceptable for an observability plugin only if the handler strictly writes logs to stderr or a file (never stdout) and exits 0. Flag them so the plugin author knows stdout hygiene is critical.

### Neither list — purely observational or no stdout parsing
Hooks that fall into either of these buckets:
- The docs explicitly state exit code and output are ignored (no decision control at all), OR
- The hook only supports blocking via exit code 2 or stderr, with no JSON decision parsing on exit 0 — meaning accidental stdout on exit 0 cannot be misinterpreted as a blocking directive

These are safe for observability without special stdout-hygiene concerns.

## Classification rules

- Each hook appears in AT MOST one list (blacklist OR flagged), or neither.
- Exit code 2 behavior is NOT a reason to flag a hook. Flagging is exclusively about exit-0 stdout parsing risk. An observability handler that exits 0 cannot accidentally exit 2.
- The universal "continue: false" field applies to all hooks, so its presence alone doesn't warrant flagging. Only flag if the hook has event-specific decision fields parsed from exit-0 stdout.
- When in doubt between "blacklist" and "flagged": if a handler that exits 0 with genuinely empty stdout preserves default behavior, it's "flagged" (or neither). If that same handler breaks things, it's "blacklist".
- Hooks whose exit code and stdout are explicitly documented as "ignored" belong in neither list.

## Output format

Return ONLY a JSON object of this exact shape, with no prose, no markdown fences, no commentary:

{
  "blacklist": ["HookA", "HookB"],
  "flagged":   ["HookC", "HookD"]
}

Use the exact PascalCase hook event names as documented (e.g., "PreToolUse", "WorktreeCreate"). Do not invent hooks that aren't in the documentation.

<hooks-documentation>
${hooksDocMd}
</hooks-documentation>`
}

interface AiAnalysis {
  blacklist: string[]
  flagged: string[]
}

/**
 * Ask Claude CLI to analyze the hooks documentation and classify hooks
 * into "blacklist" (must not be registered) and "flagged" (safe if
 * configured correctly but dangerous if misconfigured).
 */
function aiAnalyzeHooks(hooksDocMd: string): AiAnalysis {
  const empty: AiAnalysis = { blacklist: [], flagged: [] }
  const prompt = buildAiPrompt(hooksDocMd)

  try {
    const proc = spawnSync(
      'claude',
      ['-p', prompt, '--model', 'claude-opus-4-7', '--output-format', 'json', '--debug'],
      {
        encoding: 'utf8',
        timeout: 120_000,
      },
    )

    if (proc.error || proc.status !== 0) {
      throw new Error(proc.error?.message || proc.stderr || `exit ${proc.status}`)
    }

    const cliOutput = JSON.parse(proc.stdout)
    const text = cliOutput.result || ''

    // Extract JSON from Claude's response text (may be wrapped in markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*"blacklist"[\s\S]*"flagged"[\s\S]*\}/)
    if (!jsonMatch) {
      console.warn('  ⚠  AI analysis returned no parseable JSON')
      return empty
    }

    const parsed = JSON.parse(jsonMatch[0])
    if (Array.isArray(parsed.blacklist) && Array.isArray(parsed.flagged)) {
      return { blacklist: parsed.blacklist, flagged: parsed.flagged }
    }
    console.warn('  ⚠  AI analysis returned unexpected format')
    return empty
  } catch (err) {
    console.warn(`  ⚠  AI analysis failed: ${err instanceof Error ? err.message : err}`)
    return empty
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (OUTPUT_PROMPT) {
    const res = await fetch(HOOKS_DOC_URL)
    if (!res.ok) {
      console.error(`Failed to fetch hooks doc: HTTP ${res.status}`)
      process.exit(1)
    }
    const md = await res.text()
    process.stdout.write(buildAiPrompt(md))
    return
  }

  let hasErrors = false

  console.log('Checking claude hooks against:', HOOKS_DOC_URL)

  const authHooks = readHooks(AUTHORITATIVE)
  const authCommands = getEventCommands(authHooks)
  const authEvents = new Set(Object.keys(authHooks))

  console.log(`✓ ${AUTHORITATIVE} (${authEvents.size} events)`)

  // ------------------------------------------------------------------
  // Check: blacklisted hooks must not be registered
  // ------------------------------------------------------------------
  const blacklisted = [...authEvents].filter((e) => BLACKLIST.has(e))
  if (blacklisted.length > 0) {
    hasErrors = true
    console.error(`\n✗ Blacklisted hook(s) found in ${AUTHORITATIVE}: ${blacklisted.join(', ')}`)
    console.error(
      `  These hooks replace default Claude Code behavior and must not be registered by an observability plugin.`,
    )
  } else {
    console.log(`✓ No blacklisted hooks registered`)
  }

  // ------------------------------------------------------------------
  // Check: config file consistency
  // ------------------------------------------------------------------
  for (const targetPath of TARGETS) {
    let targetHooks: HookConfig
    try {
      targetHooks = readHooks(targetPath)
    } catch {
      console.error(`✗ ${targetPath} — file not found or unreadable`)
      hasErrors = true
      continue
    }

    const targetEvents = new Set(Object.keys(targetHooks))
    const targetCommands = getEventCommands(targetHooks)
    let fileOk = true

    // Blacklist check on target too
    const targetBlacklisted = [...targetEvents].filter((e) => BLACKLIST.has(e))
    if (targetBlacklisted.length > 0) {
      hasErrors = true
      fileOk = false
      console.error(`✗ ${targetPath} — blacklisted hook(s): ${targetBlacklisted.join(', ')}`)
    }

    // Missing events
    const missing = [...authEvents].filter((e) => !targetEvents.has(e))
    if (missing.length > 0) {
      hasErrors = true
      fileOk = false
      console.error(`✗ ${targetPath} — missing ${missing.length} event(s): ${missing.join(', ')}`)
    }

    // Extra events
    const extra = [...targetEvents].filter((e) => !authEvents.has(e))
    if (extra.length > 0) {
      hasErrors = true
      fileOk = false
      console.error(`✗ ${targetPath} — extra ${extra.length} event(s): ${extra.join(', ')}`)
    }

    // Command structure matches
    for (const event of authEvents) {
      if (!targetEvents.has(event)) continue
      const authCmds = authCommands.get(event) ?? []
      const targetCmds = targetCommands.get(event) ?? []

      if (authCmds.length !== targetCmds.length) {
        hasErrors = true
        fileOk = false
        console.error(
          `✗ ${targetPath} — ${event}: ${targetCmds.length} command(s) vs ${authCmds.length} in authority`,
        )
        continue
      }

      for (let i = 0; i < authCmds.length; i++) {
        if (authCmds[i] !== targetCmds[i]) {
          hasErrors = true
          fileOk = false
          console.error(`✗ ${targetPath} — ${event} command mismatch:`)
          console.error(`    authority: ${authCmds[i]}`)
          console.error(`    target:    ${targetCmds[i]}`)
        }
      }
    }

    if (fileOk) {
      console.log(`✓ ${targetPath} — matches (${authEvents.size} events)`)
    }
  }

  // ------------------------------------------------------------------
  // Check: documented hooks coverage (excluding blacklisted)
  // ------------------------------------------------------------------
  const documented = await fetchDocumentedHooks()
  if (documented.length > 0) {
    const safeDocumented = documented.filter((h) => !BLACKLIST.has(h))
    const missing = safeDocumented.filter((h) => !authEvents.has(h))
    if (missing.length > 0) {
      hasErrors = true
      console.error(
        `\n✗ ${AUTHORITATIVE} is missing ${missing.length} documented hook(s): ${missing.join(
          ', ',
        )}`,
      )
    } else {
      console.log(
        `✓ All ${safeDocumented.length} safe documented hooks are present (${BLACKLIST.size} blacklisted)`,
      )
    }
  }

  // ------------------------------------------------------------------
  // AI analysis: cross-reference with Claude's understanding of the docs
  // ------------------------------------------------------------------
  if (!SKIP_AI && documented.length > 0) {
    console.log(`\n— AI analysis of hook safety (via claude CLI)...`)
    try {
      const res = await fetch(HOOKS_DOC_URL)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const md = await res.text()
      const { blacklist: aiBlacklist, flagged: aiFlagged } = aiAnalyzeHooks(md)

      // --- Blacklist cross-check -----------------------------------------
      if (aiBlacklist.length > 0) {
        console.log(`  AI blacklist: ${aiBlacklist.join(', ')}`)

        // AI-blacklisted hooks we haven't captured in our local BLACKLIST
        const missingFromLocal = aiBlacklist.filter((h) => !BLACKLIST.has(h))
        if (missingFromLocal.length > 0) {
          const registered = missingFromLocal.filter((h) => authEvents.has(h))
          if (registered.length > 0) {
            hasErrors = true
            console.error(
              `✗ AI blacklisted ${
                registered.length
              } registered hook(s) not in local BLACKLIST: ${registered.join(', ')}`,
            )
            console.error(`  Review these hooks and add to BLACKLIST if confirmed unsafe.`)
          } else {
            console.log(
              `  AI blacklisted ${missingFromLocal.length} hook(s) not in local BLACKLIST but none are registered`,
            )
          }
        }

        // Local BLACKLIST entries the AI didn't blacklist (possible false positive)
        const notInAi = [...BLACKLIST].filter((h) => !aiBlacklist.includes(h))
        if (notInAi.length > 0) {
          console.warn(
            `  ⚠  Local BLACKLIST contains ${
              notInAi.length
            } hook(s) AI did not blacklist: ${notInAi.join(', ')}`,
          )
          console.warn(`  These may be safe — review and remove from BLACKLIST if appropriate.`)
        }

        const agreed = [...BLACKLIST].filter((h) => aiBlacklist.includes(h))
        if (agreed.length > 0) {
          console.log(`  ✓ AI agrees with BLACKLIST on: ${agreed.join(', ')}`)
        }
      } else {
        console.log(`  AI returned an empty blacklist`)
      }

      // --- Flagged cross-check -------------------------------------------
      if (aiFlagged.length > 0) {
        console.log(`  AI flagged: ${aiFlagged.join(', ')}`)
        const flaggedRegistered = aiFlagged.filter((h) => authEvents.has(h))
        if (flaggedRegistered.length > 0) {
          console.log(
            `  ⚠  ${
              flaggedRegistered.length
            } flagged hook(s) are registered — ensure handlers always exit 0 and emit no directive output: ${flaggedRegistered.join(
              ', ',
            )}`,
          )
        }
      }
    } catch (err) {
      console.warn(`  ⚠  AI analysis skipped: ${err instanceof Error ? err.message : err}`)
    }
  } else if (SKIP_AI) {
    console.log(`\n— AI analysis skipped (--skip-ai)`)
  }

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  if (hasErrors) {
    console.error('\nHook configuration has issues. Fix them before releasing.')
    process.exit(1)
  }

  console.log('\nAll hook configurations are consistent and safe.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
