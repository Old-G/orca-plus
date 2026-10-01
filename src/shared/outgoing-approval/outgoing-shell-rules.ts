// Custom build (outgoing-approval): which shell commands message people or delete something for good.
// Everything else an agent runs — pushes, merges, deploys, API writes — passes (owner's call, 02.10.2026).
import { MAX_OUTGOING_BODY_LENGTH, type OutgoingAction } from './outgoing-action'
import { curlRewritesClickUpTaskText } from './outgoing-clickup-text-rules'

type ShellRule = {
  service: string
  operation: string
  pattern: RegExp
  /** Loopback-only calls are exempt: `segment` checks each matched command, `command` the whole text. */
  hostScope?: 'segment' | 'command'
  /** Narrows a match: only matched commands this accepts are held. */
  holds?: (segment: string, command: string) => boolean
}

// Why: a command word starts the text or follows a separator, a subshell, whitespace, a quote
// (`bash -c "git push"`) or a path (`/usr/bin/ssh`).
const START = String.raw`(?:^|[\s;&|(\x60{"'/]|\$\()`

const DELETE_METHOD = String.raw`['"]?DELETE\b`

const CURL_SEND = new RegExp(
  String.raw`${START}curl\b[^\n;|]*?\s(?:-[A-Za-z]*[dFT][A-Za-z]*(?=[\s'"@{=]|$)|--data[\w-]*|--form[\w-]*|--json|--upload-file|-X\s*['"]?(?:POST|PUT|PATCH)\b|--request[=\s]+['"]?(?:POST|PUT|PATCH)\b)`
)

const SCRIPT_SEND =
  /\b(?:requests|httpx|session|client|axios)\.(?:post|put|patch)\s*\(|\bmethod\s*[=:]\s*['"](?:POST|PUT|PATCH)['"]|\burlopen\s*\([^)]*\bdata\s*=/i

// Why: services whose only job is delivering a message to a person; a path pins the multi-purpose ones.
const MESSAGE_HOST =
  /^(?:[\w-]+\.)*(?:slack\.com|api\.telegram\.org|gmail\.googleapis\.com|api\.sendgrid\.com|api\.mailgun\.net|api\.postmarkapp\.com|api\.resend\.com|api\.twilio\.com|discord(?:app)?\.com)$/i

const MESSAGE_PATH = [
  { host: /^graph\.microsoft\.com$/i, path: /\/sendMail\b/i },
  { host: /^desk\.zoho\.[a-z.]+$/i, path: /\/sendReply\b/i },
  { host: /^api\.clickup\.com$/i, path: /\/chat\// }
]

// Why: run on another machine or database, these cannot be taken back.
const REMOTE_DESTRUCTION =
  /\brm\s+-[a-z]*[rf]|\b(?:DROP\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE|DELETE\s+FROM)\b|\bdocker\s+(?:volume\s+rm|system\s+prune|rm\s+-f)\b|\bdropDatabase\s*\(/i

const SHELL_RULES: ShellRule[] = [
  {
    service: 'git',
    operation: 'force or delete push',
    pattern: new RegExp(
      String.raw`${START}git\s+(?:(?:-C|-c|--git-dir|--work-tree)\s+\S+\s+|--?[\w-]+(?:=\S+)?\s+)*push\b`
    ),
    holds: isDestructiveGitPush
  },
  {
    service: 'git',
    operation: 'send email',
    pattern: new RegExp(String.raw`${START}git\s+(?:-\S+\s+)*send-email\b`)
  },
  {
    service: 'GitHub',
    operation: 'gh delete',
    pattern: new RegExp(
      String.raw`${START}gh\s+(?:repo|release|issue|run|secret|variable|label|cache|gist|ssh-key|gpg-key|codespace)\s+delete\b`
    )
  },
  {
    service: 'GitHub',
    operation: 'gh api delete',
    pattern: new RegExp(
      String.raw`${START}gh\s+api\b[^\n;|]*\s(?:-X\s*${DELETE_METHOD}|--method[=\s]+${DELETE_METHOD})`
    )
  },
  {
    service: 'GitLab',
    operation: 'glab delete',
    pattern: new RegExp(
      String.raw`${START}glab\s+(?:repo|release|issue|mr|variable|label|ci|snippet)\s+delete\b`
    )
  },
  {
    service: 'GitLab',
    operation: 'glab api delete',
    pattern: new RegExp(
      String.raw`${START}glab\s+api\b[^\n;|]*\s(?:-X\s*${DELETE_METHOD}|--method[=\s]+${DELETE_METHOD})`
    )
  },
  {
    service: 'HTTP',
    operation: 'curl delete',
    pattern: new RegExp(
      String.raw`${START}curl\b[^\n;|]*?\s(?:-X\s*${DELETE_METHOD}|--request[=\s]+${DELETE_METHOD})`
    ),
    hostScope: 'segment'
  },
  {
    service: 'HTTP',
    operation: 'message',
    pattern: CURL_SEND,
    holds: (segment) => urlsIn(segment).some(isMessageUrl)
  },
  {
    service: 'ClickUp',
    operation: 'rewrite task name or description',
    pattern: CURL_SEND,
    holds: curlRewritesClickUpTaskText
  },
  {
    service: 'HTTP',
    operation: 'wget delete',
    pattern: new RegExp(String.raw`${START}wget\b[^\n;|]*--method[=\s]+${DELETE_METHOD}`),
    hostScope: 'segment'
  },
  {
    service: 'HTTP',
    operation: 'httpie delete',
    pattern: new RegExp(String.raw`${START}(?:https?|xh)\s+(?:-\S+\s+)*DELETE\s`),
    hostScope: 'segment'
  },
  {
    service: 'HTTP',
    operation: 'script delete',
    pattern:
      /\b(?:requests|httpx|session|client|axios)\.delete\s*\(|\bmethod\s*[=:]\s*['"]DELETE['"]/i,
    hostScope: 'command'
  },
  {
    service: 'HTTP',
    operation: 'script message',
    pattern: SCRIPT_SEND,
    holds: (_segment, command) => urlsIn(command).some(isMessageUrl)
  },
  {
    service: 'remote',
    operation: 'delete on a server or database',
    pattern: new RegExp(String.raw`${START}(?:ssh|psql|mysql|mongosh)\s`),
    holds: (_segment, command) => REMOTE_DESTRUCTION.test(command)
  },
  {
    service: 'deploy',
    operation: 'destroy',
    pattern: new RegExp(
      String.raw`${START}(?:kubectl\s+delete\b|terraform\s+destroy\b|fly\s+(?:apps\s+)?destroy\b|(?:npm|pnpm|yarn)\s+unpublish\b|aws\s+\S+\s+(?:rm|rb|delete-[\w-]+)\b)`
    )
  }
]

const DESTRUCTIVE_PUSH_FLAG =
  /^(?:--force(?:-with-lease|-if-includes)?(?:=\S*)?|--delete|--mirror|--prune|-[a-zA-Z]*[fd][a-zA-Z]*)$/

function words(segment: string): string[] {
  return segment
    .split(/\s+/)
    .map((word) => word.replace(/^[("'`]+|[)"'`]+$/g, ''))
    .filter(Boolean)
}

/** A push that rewrites or deletes remote history: force, delete, mirror, prune, `+ref` or `:ref`. */
export function isDestructiveGitPush(segment: string): boolean {
  const tokens = words(segment)
  const gitAt = tokens.findIndex((token) => /(?:^|\/)git$/.test(token))
  const pushAt = tokens.indexOf('push', gitAt + 1)
  if (gitAt === -1 || pushAt === -1) {
    return false
  }
  return tokens
    .slice(pushAt + 1)
    .some(
      (token) => DESTRUCTIVE_PUSH_FLAG.test(token) || token.startsWith('+') || token.startsWith(':')
    )
}

export function classifyShellCommand(command: string | null): OutgoingAction | null {
  if (!command?.trim()) {
    return null
  }
  // Why: a backslash-newline continues one command, so a flag on the next line still belongs to it.
  const normalized = command.replace(/\\\r?\n/g, ' ')
  const rule = SHELL_RULES.find((candidate) => isHeld(candidate, normalized))
  if (!rule) {
    return null
  }
  return {
    service: rule.service,
    operation: rule.operation,
    draftKind:
      rule.operation.includes('message') || rule.operation.includes('email') ? 'message' : 'other',
    target: firstRemoteHost(normalized),
    body: command.slice(0, MAX_OUTGOING_BODY_LENGTH),
    editField: 'command'
  }
}

const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[?::1\]?|[\w-]+\.localhost)$/i

function urlsIn(text: string): URL[] {
  return [...text.matchAll(/\bhttps?:\/\/[^\s'"]+/gi)].flatMap((match) => {
    try {
      return [new URL(match[0])]
    } catch {
      return []
    }
  })
}

function urlHosts(text: string): string[] {
  return [...text.matchAll(/\bhttps?:\/\/(\[[^\]]+\]|[^/\s'"?:#]+)/gi)].map((match) => match[1])
}

function isMessageUrl(url: URL): boolean {
  return (
    MESSAGE_HOST.test(url.hostname) ||
    MESSAGE_PATH.some((entry) => entry.host.test(url.hostname) && entry.path.test(url.pathname))
  )
}

function isHeld(rule: ShellRule, command: string): boolean {
  if (rule.hostScope === 'command') {
    return rule.pattern.test(command) && !onlyLocalHosts(command)
  }
  if (!rule.hostScope && !rule.holds) {
    return rule.pattern.test(command)
  }
  // Why: one local or harmless call must not excuse a second one in the same command.
  const global = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace('g', '')}g`)
  return [...command.matchAll(global)].some((match) => {
    const segment = segmentAt(command, match.index)
    return (
      !(rule.hostScope === 'segment' && onlyLocalHosts(segment)) &&
      (rule.holds?.(segment, command) ?? true)
    )
  })
}

/** No URL at all counts as remote: the target may hide in a variable. */
function onlyLocalHosts(text: string): boolean {
  const hosts = urlHosts(text)
  return hosts.length > 0 && hosts.every((host) => LOCAL_HOST.test(host))
}

function segmentAt(command: string, index: number): string {
  const rest = command.slice(index)
  const end = rest.slice(1).search(/[\n;|]|&&/)
  return end === -1 ? rest : rest.slice(0, end + 1)
}

function firstRemoteHost(command: string): string | null {
  return urlHosts(command).find((host) => !LOCAL_HOST.test(host)) ?? null
}
