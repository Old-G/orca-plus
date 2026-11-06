// Custom build (remote-own-work, owner 06.11): what else the agent's own server work looks like — its
// probe scripts in a listed container, its scratchpad by a variable set in the same command, and data
// heredocs whose text no shell reads.
import type { Binding, Word } from './outgoing-shell-words'

/** A name matches a list pattern; `*` stands for any part of it. */
export function globMatch(pattern: string, name: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\w.-]*')
  return /^[\w.-]+$/.test(name) && new RegExp(`^${source}$`).test(name)
}

// Why: one literal file in a listed container — no `..`, variable or glob in the target; the name only
// may match the entry's `*` (owner 06.11).
const LITERAL_FILE = /^\/[\w./-]+$/

/** The target names a listed probe script in the container `rm` runs in. */
export function isOwnContainerScript(
  word: Word,
  entries: string[],
  container: string | null
): boolean {
  const path = word.text
  if (
    container === null ||
    !LITERAL_FILE.test(path) ||
    path.includes('..') ||
    path.includes('//')
  ) {
    return false
  }
  const cut = path.lastIndexOf('/')
  return entries.some((entry) => {
    const colon = entry.indexOf(':')
    const pattern = entry.slice(colon + 1)
    const at = pattern.lastIndexOf('/')
    return (
      entry.slice(0, colon) === container &&
      pattern.slice(0, at) === path.slice(0, cut) &&
      globMatch(pattern.slice(at + 1), path.slice(cut + 1))
    )
  })
}

// Why: a container named in full and one file in a named folder, `*` only inside the file's name and
// before its extension — `agent-app:/app/e2e_*.py`, never `/app/*`, `/app/*.py` or `*:/app/x.py`.
export const OWN_SCRIPT_ENTRY = /^[\w.-]{3,}:(?:\/[\w.-]+)+\/\w[\w.-]*(?:\*[\w.-]*\.\w+)?$/

// Why: Claude Code's own temp root; a variable set to a folder in it is the agent's scratchpad.
const SCRATCH_ROOT = /^\/private\/tmp\/claude-\d+\/[^/]/

/** Variables this command sets to a literal folder under the scratch root (owner 06.11). */
export function scratchBindings(bindings: Map<string, Binding>): Map<string, Binding> {
  return new Map(
    [...bindings].filter(
      ([, binding]) =>
        binding.value !== null &&
        SCRATCH_ROOT.test(binding.value) &&
        !binding.value.split('/').includes('..')
    )
  )
}

const DATA_FILE = String.raw`[^\s;&|<>()\x60'"]+\.(?:py|json|jsonl|ya?ml|md|txt|csv|sql|toml|ts|mts|js|mjs)`
// Why: a heredoc that `cat` writes into a data file or Python reads as its script, alone on its line
// after `;`/`&&` — no pipe or shell reads that text.
// Why: a file `cat` wrote may then run as a shell script; the text stays checked when anything does that.
const RUNS_A_FILE = /(?:^|[\s;&|('"\x60])(?:(?:ba|da|z|k)?sh|chmod)\s+(?!-c\s)/
const DATA_HEREDOC_LINE = new RegExp(
  String.raw`(?:^|&&|;)\s*(?:cat\s+(?:>\s*${DATA_FILE}\s+<<-?\s*(['"]?)\w+\1|<<-?\s*(['"]?)\w+\2\s*>\s*${DATA_FILE})|(?:[\w./-]*\/)?python[\d.]*\s+-\s+<<-?\s*(['"]?)\w+\3)\s*$`
)

/**
 * The command with the text of each data heredoc blanked: Python there (`if r[1]`, `x != r[5]`) reads
 * as a command name built by a glob (owner 06.11, three cleanups held by it). An unquoted one only
 * when this shell runs nothing in it — no `$(` or backquote.
 */
export function withoutDataHeredocs(command: string, keys: string[]): string {
  const bodies = new Map<string, string>()
  for (let k = 0; k < command.length; k++) {
    const at = /^<'?(\d+)$/.exec(keys[k] ?? '')?.[1]
    if (at !== undefined) {
      bodies.set(keys[k], (bodies.get(keys[k]) ?? '') + command[k])
    }
  }
  const data = new Set(
    [...bodies].flatMap(([key, body]) => {
      const at = Number(/\d+$/.exec(key)?.[0])
      const from = command.lastIndexOf('\n', at - 1) + 1
      const to = command.indexOf('\n', at)
      const line = command.slice(from, to === -1 ? undefined : to)
      const quiet = key.startsWith("<'") || !/\$\(|\x60/.test(body)
      const reader = DATA_HEREDOC_LINE.exec(line)
      const runnable = reader?.[3] === undefined && RUNS_A_FILE.test(command)
      return quiet && reader && !runnable ? [key] : []
    })
  )
  return [...command].map((ch, k) => (ch !== '\n' && data.has(keys[k] ?? '') ? ' ' : ch)).join('')
}
