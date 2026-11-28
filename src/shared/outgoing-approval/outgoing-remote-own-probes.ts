// Custom build (remote-own-work, owner 06.11): what else the agent's own server work looks like — its
// probe scripts in a listed container, its scratchpad by a variable set in the same command, and data
// heredocs whose text no shell reads.
import { isRemote } from './outgoing-remote-scope'
import { inComment, type Binding, type Word } from './outgoing-shell-words'

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

// Custom build (C3, plan 15.18, owner 11.11): a probe the agent copies into a container and removes
// after the run — `docker cp /tmp/q.mjs app:/app/q.mjs … docker exec app rm -f /app/q.mjs` — without a
// list entry. Why only these: the destination is one literal script file, no `..`, glob or variable; the
// source is a path, not the `-` tar stream that can unpack anything. Why scripts only: if the copy did
// not run, the rm takes a file of that name already there — code the image brings back, never data
// (`.db`, `.json`, `.env`; review 28.11).
const DOCKER_CP_IN = new RegExp(
  String.raw`(?:^|[\s;&|('"\x60])docker\s+cp\s+(?:-[aLq]+\s+)*(?!-\s)[^\s;&|<>'"\x60$()]+\s+([\w.-]+):(\/[\w./-]*\/\w[\w.-]*\.(?:[cm]?[jt]s|py|sh))(?=$|[\s;&|)'"])`,
  'g'
)
// Why: a branch, group, function or background job may skip the copy and still run the rm; after a
// comment, an escaped separator (`echo x \; docker cp …`) or inside a heredoc in quotes (which
// contextKeys does not split off) it is no command at all (review 28.11).
const BRANCHING =
  /\|\||[{}#\\]|<<|(?:^|[\s;&|])(?:if|then|else|elif|do|case|while|until|for|function)(?=[\s;]|$)|(?:^|[^&>])&(?![&>])/

export type ContainerCopy = { container: string; path: string; at: number }

/**
 * Files this command copies into a container by name — only a `docker cp` that is a command itself:
 * after `;`, `&&`, a newline or the quote that opens the remote command, not in a comment, an echo or a
 * string (review 28.11).
 */
export function copiesIntoContainers(command: string, keys: string[]): ContainerCopy[] {
  return [...command.matchAll(DOCKER_CP_IN)].flatMap((match) => {
    const path = match[2]
    const at = (match.index ?? 0) + match[0].search(/docker\s/)
    const before = command.slice(0, at).replace(/[ \t]+$/, '')
    const open = /['"](\d+)$/.exec(keys[at] ?? '')
    const starts =
      /(?:;|&&|\n)$/.test(before) || (open !== null && Number(open[1]) === before.length - 1)
    return path.includes('..') || path.includes('//') || !starts || inComment(command, at)
      ? []
      : [{ container: match[1], path, at }]
  })
}

/** From the remote command's start to the rm, its own shell runs one straight line of commands. */
function straightLine(command: string, keys: string[], from: number, to: number): boolean {
  let text = ''
  for (let k = from; k < to; k++) {
    text += keys[k] === keys[to] ? command[k] : ' '
  }
  return !BRANCHING.test(text)
}

/**
 * The target is a file an earlier `docker cp` of this command put into the same container, in the same
 * shell of the same ssh call's remote command. Why `rm -f` is safe here: `container` is set only for an
 * rm without `-r`, so at worst it removes one script of that name (owner 11.11: 185 of 185 approved).
 */
export function isCopiedHere(
  command: string,
  word: Word,
  copies: ContainerCopy[],
  container: string | null,
  rmAt: number,
  spans: [number, number][],
  keys: string[]
): boolean {
  const span = spans.find(([start, end]) => start <= rmAt && rmAt < end)
  return (
    container !== null &&
    span !== undefined &&
    word.quote !== "'" &&
    LITERAL_FILE.test(word.text) &&
    straightLine(command, keys, span[0], rmAt) &&
    copies.some(
      (copy) =>
        copy.container === container &&
        copy.path === word.text &&
        span[0] <= copy.at &&
        copy.at < rmAt &&
        keys[copy.at] === keys[rmAt] &&
        isRemote(copy.at, spans, keys)
    )
  )
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
const RUNS_A_FILE = /(?:^|[\s;&|('"\x60/\\])(?:(?:ba|da|z|k)?sh|chmod)\s+(?!-c\s)/
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
      // Why one: with two heredocs on a line (`bash <<'A'; python3 - <<'B'`) the reader is not sure.
      const reader = (line.match(/<</g) ?? []).length === 1 ? DATA_HEREDOC_LINE.exec(line) : null
      const runnable = reader?.[3] === undefined && RUNS_A_FILE.test(command)
      return quiet && reader && !runnable ? [key] : []
    })
  )
  // Why split(''): keys are indexed by UTF-16 code units, as contextKeys reads the text (Codex, 06.11).
  return command
    .split('')
    .map((ch, k) => (ch !== '\n' && data.has(keys[k] ?? '') ? ' ' : ch))
    .join('')
}
