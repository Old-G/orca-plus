// Custom build (remote-own-work, plan 15.17, owner 23.10 and 01.11): the agent's own deploys and cleanups
// on a server pass without a card when every destructive step in the command is on the owner's list,
// HQ autonomy.yaml `remote_no_approve`. Whatever the text cannot settle keeps the card.
import type { HqRemoteNoApprove } from '../hq-autonomy'
import { bindingsIn, contextKeys, readWords, type Binding, type Word } from './outgoing-shell-words'
import {
  SSH_CALL,
  hasUnknownExpansion,
  hasUnreadableWords,
  isRemote,
  remoteSpans
} from './outgoing-remote-scope'

// Why: run on another machine or database, these cannot be taken back.
export const REMOTE_DESTRUCTION =
  /\brm\s+(?:--?[\w-]+\s+)*?(?:-[a-z]*[rf]|--recursive|--force)|\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b|\bdocker\s+(?:volume\s+rm|system\s+prune|(?:container\s+)?rm\s+(?:--?[\w-]+\s+)*?(?:-[a-z]*f|--force))\b|\bdropDatabase\s*\(/i

const DESTRUCTION_SITES = new RegExp(REMOTE_DESTRUCTION.source, 'gi')

let ownWork: HqRemoteNoApprove | null = null

export function setRemoteNoApprove(config: HqRemoteNoApprove | null): void {
  ownWork = config
}

// Why: a target the shell would expand or unquote cannot be judged from its text.
const SHELL_EXPANSION = /[$`\\'"{}~]/

/** Scratch the agent made under /tmp, gone on a reboot anyway: always passes, list or not. */
export function isTempTarget(target: string): boolean {
  return (
    /^(?:\/private)?\/(?:var\/)?tmp\/[^\s*?/][^\s*?]*$/.test(target) &&
    !target.includes('..') &&
    !SHELL_EXPANSION.test(target)
  )
}

const SSH_FLAGS = '46AaCfGgKkMNnqsTtVvXxYy'
const SSH_SAFE_VALUE_OPTIONS = 'ilOop'
const SSH_SAFE_CONFIG =
  /^(?:ControlPath|ControlMaster|ControlPersist|BatchMode|ConnectTimeout|ConnectionAttempts|ServerAliveInterval|ServerAliveCountMax|StrictHostKeyChecking|LogLevel)[=\s]/i
const AT_COMMAND = new RegExp(
  String.raw`(?:^|[\n;&|('"\x60{]|\$\(|\bthen|\bdo|\belse)\s*(?:sudo\s+(?:-\S+\s+)*)?$`
)
const RM_IN_CONTAINER =
  /\bdocker\s+(?:compose\s+)?exec\s+(?:(?:-[uwe]|--(?:user|workdir|env|env-file))\s+\S+\s+|-\S+\s+)*[\w.-]+\s+$/
const PATH_CHARS = /^[\w.\-+@:,=*?/~]+$/
// Why: each can feed rm or docker words, rebind a variable, move `~` or point a listed path elsewhere
// (a link or a mount), move other data into it (`mv`) or swap rm itself, in a way the text does not show.
const UNSURE =
  /\b(?:ln|mount)(?![\w.-])|--bind\b|\bdocker\s+run\b[^\n;|&]*\s(?:-v|--volume|--mount)\b|\b(?:eval|source|xargs|parallel)\b|(?:^|[;&|(\n])\s*\.\s|-exec(?:dir)?\b|\b(?:HOME|IFS|PATH)\+?=|\b(?:mv|alias|enable|builtin|hash)(?![\w.-])|--remove-source-files\b|\b(?:rm|docker|mktemp)\s*\(\s*\)|\bfunction\s+(?:rm|docker|mktemp)\b/
// Why: these point docker at another engine than the one on the listed host — set in the environment,
// a config dir, a context switch or a global flag. Read on the text with quotes and backslashes dropped,
// as the shell reads `con\\text` and `co"n"text` (security review, 02.11).
const OTHER_DOCKER =
  /DOCKER_[A-Z]|\.docker\b|\bcontext\s+(?:use|create|update|import|rm)\b|\bdocker\s+(?:-H|--host|--context|-c|--config)\b/
const QUIET_TARGET = /^\/dev\/(?:null|stdout|stderr)$/

function globMatch(pattern: string, name: string): boolean {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\w.-]*')
  return /^[\w.-]+$/.test(name) && new RegExp(`^${source}$`).test(name)
}

/** The host of the ssh call whose options start at `from`, or null when it cannot be read. */
function sshHost(command: string, from: number): string | null {
  const tokens = [...command.slice(from).matchAll(/\S+/g)].map((match) => match[0])
  for (let t = 0; t < tokens.length; t++) {
    // Why: `-o "HostName=…"` is the same option to ssh once the shell drops the quotes.
    const token = tokens[t].replace(/['"]/g, '')
    if (!token.startsWith('-')) {
      const host = /^(?:[\w.-]+@)?([\w.-]+)$/.exec(tokens[t].replace(/[;&|)]+$/, ''))?.[1] ?? null
      // Why: ssh also reads options given after the host, and one may name another machine.
      return /^['"]?-/.test(tokens[t + 1] ?? '') ? null : host
    }
    // Why: walked like getopt; any option off this short list may send ssh somewhere else.
    for (let c = 1; c < token.length; c++) {
      const letter = token[c]
      if (SSH_FLAGS.includes(letter)) {
        continue
      }
      if (!SSH_SAFE_VALUE_OPTIONS.includes(letter)) {
        return null
      }
      const value = token.slice(c + 1) || (tokens[++t] ?? '').replace(/['"]/g, '')
      if (letter === 'o' && !SSH_SAFE_CONFIG.test(value)) {
        return null
      }
      break
    }
  }
  return null
}

const MKTEMP = Symbol('mktemp')

/** What `rm` gets for this word: a path, MKTEMP for a whole-word `mktemp` variable, or null. */
function resolve(
  word: Word,
  bindings: Map<string, Binding>,
  keys: string[]
): string | typeof MKTEMP | null {
  const ref = word.quote === "'" ? null : /^\$(?:(\w+)|\{(\w+)\})(.*)$/.exec(word.text)
  if (!ref) {
    return /[$`\\]/.test(word.text) ? null : word.text
  }
  const binding = bindings.get(ref[1] ?? ref[2])
  const rest = ref[3]
  if (
    !binding ||
    binding.at > word.at ||
    binding.context !== keys[word.at] ||
    /[$`\\]/.test(rest)
  ) {
    return null
  }
  // Why: a failed mktemp leaves the variable empty, and `$D/x` would then name `/x`.
  if (binding.value === null) {
    return rest === '' ? MKTEMP : null
  }
  return binding.value + rest
}

function pathMatches(pattern: string, path: string): boolean {
  if (!pattern.endsWith('*')) {
    return path === pattern
  }
  const prefix = pattern.slice(0, -1)
  const rest = path.slice(prefix.length)
  return (
    path.startsWith(prefix) &&
    rest !== '' &&
    // Why: one name right under the prefix; a deeper path may run through a link made earlier.
    !rest.includes('/') &&
    // Why: `/tmp/*` names files under /tmp, not every file there at once.
    !(prefix.endsWith('/') && /^[*?]/.test(rest))
  )
}

/** A temp path or mktemp variable passes anywhere; a listed path only on a listed host (`remote`). */
function isOwnPath(
  word: Word,
  path: string | typeof MKTEMP | null,
  own: HqRemoteNoApprove,
  remote: boolean
): boolean {
  if (path === MKTEMP) {
    return own.mktemp
  }
  if (path === null || !PATH_CHARS.test(path) || path.split('/').includes('..')) {
    return false
  }
  if (
    path.includes('~') &&
    (word.quote !== '' || !path.startsWith('~/') || path.includes('~', 1))
  ) {
    return false
  }
  const normalized = path.replace(/^\/private\/tmp\//, '/tmp/')
  return (
    isTempTarget(path) ||
    (remote && own.rmPaths.some((pattern) => pathMatches(pattern, normalized)))
  )
}

function isOwnContainerRemoval(
  command: string,
  words: Word[] | null,
  containers: string[]
): boolean {
  const names =
    words?.filter((word) => !word.redirect && (word.quote !== '' || !word.text.startsWith('-'))) ??
    []
  return (
    !!words &&
    !OTHER_DOCKER.test(command.replace(/['"\\]/g, '')) &&
    names.length > 0 &&
    words.every(
      (word) =>
        names.includes(word) ||
        (word.redirect && QUIET_TARGET.test(word.text)) ||
        (word.quote === '' && /^(?:-f|--force)$/.test(word.text))
    ) &&
    names.every((word) => containers.some((pattern) => globMatch(pattern, word.text)))
  )
}

function isOwnSite(
  command: string,
  site: RegExpMatchArray,
  own: HqRemoteNoApprove,
  bindings: Map<string, Binding>,
  keys: string[],
  spans: [number, number][]
): boolean {
  const at = site.index ?? 0
  const text = site[0]
  const before = command.slice(0, at)
  const remote = isRemote(at, spans, keys)
  if (/^docker\s+(?:container\s+)?rm\s/i.test(text)) {
    const rmAt = at + text.search(/\brm\s/i)
    return (
      remote &&
      AT_COMMAND.test(before) &&
      isOwnContainerRemoval(command, readWords(command, rmAt + 2), own.containers)
    )
  }
  if (!/^rm\s/i.test(text)) {
    return false
  }
  const words = readWords(command, at + 2)
  if (
    !words ||
    !(AT_COMMAND.test(before) || RM_IN_CONTAINER.test(before)) ||
    !words.every((word) => !word.redirect || QUIET_TARGET.test(word.text))
  ) {
    return false
  }
  const endOfOptions = words.findIndex((word) => word.quote === '' && word.text === '--')
  const targets = words.filter(
    (word, index) =>
      !word.redirect &&
      ((endOfOptions !== -1 && index > endOfOptions) ||
        ((endOfOptions === -1 || index < endOfOptions) &&
          (word.quote !== '' || !word.text.startsWith('-'))))
  )
  return (
    targets.length > 0 &&
    targets.every((word) => isOwnPath(word, resolve(word, bindings, keys), own, remote))
  )
}

const NOTHING_LISTED: HqRemoteNoApprove = { hosts: [], containers: [], rmPaths: [], mktemp: false }

/** The list applies only when every ssh call in the command goes to a listed host. */
/** Patterns too broad to mean the agent's own things are dropped: autonomy.yaml is a plain file. */
function narrowed(own: HqRemoteNoApprove): HqRemoteNoApprove {
  const named = (pattern: string) => pattern.replace(/\*/g, '').length >= 3
  const rooted = (pattern: string) =>
    /^~?\//.test(pattern) &&
    !pattern.slice(0, -1).includes('*') &&
    pattern.replace(/\*$/, '').replace(/^~?\//, '') !== ''
  return {
    hosts: own.hosts.filter((host) => !host.includes('*') && named(host)),
    containers: own.containers.filter(named),
    rmPaths: own.rmPaths.filter(rooted),
    mktemp: own.mktemp
  }
}

function listFor(command: string): HqRemoteNoApprove {
  const own = ownWork && narrowed(ownWork)
  if (!own || own.hosts.length === 0) {
    return NOTHING_LISTED
  }
  for (const call of command.matchAll(SSH_CALL)) {
    const host = sshHost(command, (call.index ?? 0) + call[0].length)
    if (!host || !own.hosts.some((pattern) => globMatch(pattern, host))) {
      return NOTHING_LISTED
    }
  }
  return own
}

/** Every destructive step is a /tmp cleanup or, on listed hosts, on the owner's list. */
export function isOwnRemoteWork(command: string): boolean {
  // Why: `'m'v` and `m\v` are `mv` to the shell.
  if (UNSURE.test(command.replace(/['"\\]/g, ''))) {
    return false
  }
  const own = listFor(command)
  const keys = contextKeys(command)
  const bindings = bindingsIn(command, keys)
  const sites = [...command.matchAll(DESTRUCTION_SITES)]
  const rmWords = sites.flatMap((site) =>
    /^rm\s/i.test(site[0]) ? (readWords(command, (site.index ?? 0) + 2) ?? []) : []
  )
  if (hasUnknownExpansion(command, bindings) || hasUnreadableWords(command, rmWords)) {
    return false
  }
  const spans = remoteSpans(command, keys)
  return sites.every((site) => isOwnSite(command, site, own, bindings, keys, spans))
}
