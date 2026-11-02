// Custom build (remote-own-work, security review 02.11): where a step of a command runs — on the listed
// host or on this machine — and whether the shell would expand something the text does not show.
import type { Binding, Word } from './outgoing-shell-words'

export const SSH_CALL = new RegExp(String.raw`(?:^|[\s;&|(\x60{"'/]|\$\()ssh\s+`, 'g')

/**
 * Where each ssh call's remote command lies: its words up to the end of the ssh command, and any quote,
 * subshell or heredoc opened there (`ssh h bash <<'EOF'`). Security review, 02.11: in
 * `ssh myserver true; rm -rf ~/shadow_old` the rm runs on this machine, not on the listed host.
 */
export function remoteSpans(command: string, keys: string[]): [number, number][] {
  return [...command.matchAll(SSH_CALL)].flatMap((call): [number, number][] => {
    const at = (call.index ?? 0) + call[0].search(/ssh\s+$/)
    // Why: an ssh inside a quote, subshell or substitution may be fed to another shell; only a
    // top-level one has a remote command the text shows (security review, 02.11).
    if (keys[at]) {
      return []
    }
    let end = at
    while (
      end < command.length &&
      !(
        keys[end] === keys[at] &&
        /[\n;&|)]/.test(command[end]) &&
        !(command[end] === '&' && (command[end - 1] === '>' || command[end + 1] === '>'))
      )
    ) {
      end++
    }
    return [[at, end]]
  })
}

// Why: the shell turns these into names the text does not show — `/bin/m?`, `{mv,x}`, `cont*xt`.
const GLOB = /[*?[]|\{[^\s{}]*(?:,|\.\.)[^\s{}]*\}/g
// Why: anything else after a pipe may run what came through it (`ssh h cat x | sh`).
const SAFE_PIPE = /^(?:\S*\/)?(?:tail|head|grep|wc|sort|uniq|cat|cut|jq|tar|ssh)$/

/**
 * Words the shell may read differently from the text: a glob or brace expansion anywhere but in rm's own
 * targets (which the path list judges), or a pipe into anything but a plain filter. Security review,
 * 02.11, third round.
 */
export function hasUnreadableWords(command: string, rmWords: readonly Word[]): boolean {
  const inRm = (index: number): boolean =>
    rmWords.some(
      (word) => index >= word.at && index < word.at + word.text.length + (word.quote ? 2 : 0)
    )
  if ([...command.matchAll(GLOB)].some((match) => !inRm(match.index ?? 0))) {
    return true
  }
  return [...command.replace(/['"\\]/g, '').matchAll(/(?<!\|)\|(?![|&])\s*(\S*)/g)].some(
    (pipe) => !SAFE_PIPE.test(pipe[1] ?? '')
  )
}

/** Runs on the listed host: in the ssh call's words, or under a quote or heredoc opened there — but not
 *  in a `(…)` or backquote the local shell runs first (`ssh h echo $(rm …)`); past a single quote or a
 *  quoted heredoc everything is the remote shell's text. */
export function isRemote(at: number, spans: [number, number][], keys: string[]): boolean {
  const opens = (keys[at] ?? '').split(',').filter(Boolean)
  return spans.some(([start, end]) => {
    const base = keys[start] ? keys[start].split(',').length : 0
    const inner = opens.slice(base)
    const first = Number(/\d+$/.exec(inner[0] ?? '')?.[0] ?? at)
    if (first < start || first >= end) {
      return false
    }
    for (const open of inner) {
      if (open.startsWith("'") || open.startsWith("<'")) {
        return true
      }
      if (open.startsWith('(') || open.startsWith('`')) {
        return false
      }
    }
    return true
  })
}

const MKTEMP_ASSIGNMENT = new RegExp(
  String.raw`([A-Za-z_]\w*)="?(\$\(mktemp\b[^()$\x60'";&|\n]*\)|\x60mktemp\b[^()$\x60'";&|\n]*\x60)`,
  'g'
)

/**
 * Whether the shell would expand something here whose result the text does not show. Security review,
 * 02.11: `m"${X}"v`, `$X` or `$(…)` may be any command. Only a variable set once from mktemp, or set once
 * to a path and used as a prefix (`$S/x`, the rest stays visible), and that mktemp call itself pass.
 */
export function hasUnknownExpansion(command: string, bindings: Map<string, Binding>): boolean {
  const allowed: [number, number][] = []
  for (const match of command.matchAll(MKTEMP_ASSIGNMENT)) {
    const binding = bindings.get(match[1])
    if (binding && binding.value === null && binding.at === match.index) {
      const from = match.index + match[0].length - match[2].length
      allowed.push([from, from + match[2].length])
    }
  }
  for (let i = 0; i < command.length; i++) {
    const range = allowed.find(([from, to]) => i >= from && i < to)
    if (range) {
      i = range[1] - 1
      continue
    }
    if (command[i] === '`') {
      return true
    }
    if (command[i] !== '$') {
      continue
    }
    const ref = /^\$(?:([A-Za-z_]\w*)|\{([A-Za-z_]\w*)\})/.exec(command.slice(i))
    const binding = ref ? bindings.get(ref[1] ?? ref[2]) : undefined
    if (
      !ref ||
      !binding ||
      binding.at > i ||
      (binding.value !== null && command[i + ref[0].length] !== '/')
    ) {
      return true
    }
  }
  return false
}
