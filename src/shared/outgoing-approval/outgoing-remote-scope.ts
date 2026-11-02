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
// Why: what reads a pipe may run what came through it (`… | sh`, `| ssh h sh -s`, `tar --to-command`);
// only these whole commands pass (security review, 02.11, fourth round).
const SAFE_PIPE =
  /^(?:(?:tail|head)(?:\s+(?:-n\s*)?-?\d+)?|grep(?:\s+-[a-zA-Z]+)*(?:\s+[^\s-]\S*)?|wc(?:\s+-[lcwm]+)?|tar\s+-?x[vzjpf]*(?:\s+-)?(?:\s+-C\s+\S+)?)\s*$/
// Why: an ssh that gets a script of its own reads the pipe only as data, unless that script starts a
// shell or an interpreter.
const SSH_DATA = /^\s*ssh\s+[\w.@-]+\s+'([^']*)'/
const READS_CODE = /\b(?:(?:ba|z|da|k)?sh|python\d*|perl|ruby|node|php|source|eval)\b/

function pipeIsSafe(command: string, at: number): boolean {
  const rest = command.slice(at)
  const ssh = SSH_DATA.exec(rest)
  if (ssh) {
    return !READS_CODE.test(ssh[1].replace(/['"\\]/g, ''))
  }
  const target = /^[^;&|\n)]*/.exec(rest.replace(/['"\\]/g, ''))?.[0] ?? ''
  return SAFE_PIPE.test(target.trim())
}

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
  // Why `|&` too: it pipes stderr as well; only `||` is not a pipe.
  return [...command.matchAll(/(?<!\|)\|&?(?!\|)/g)].some(
    (pipe) => !pipeIsSafe(command, (pipe.index ?? 0) + pipe[0].length)
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
