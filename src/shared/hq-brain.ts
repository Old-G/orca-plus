// Custom build (hq-plus-brain): HQ+'s «Brain» screen — every mention of a task (DEV-123), an MR (!19,
// repo!19), a person or a project in one feed by day, newest first: chats, what went out through Approve,
// waits, Slack, ClickUp, MRs, documents. The rows come from HQ's brain index (`hq_brain.py timeline|search
// --json`), run by the host; the host adds what only Pulse knows (sent or rejected, open or closed).

/** The source chips, in the screen's order; a source outside them shows under «All» only. */
export const HQ_BRAIN_GROUPS = ['chat', 'sent', 'wait', 'clickup', 'code'] as const
export type HqBrainGroup = (typeof HQ_BRAIN_GROUPS)[number] | 'other'

const GROUP_OF_SOURCE: Record<string, HqBrainGroup> = {
  claude: 'chat',
  codex: 'chat',
  'orca-chat': 'chat',
  'pulse:orca': 'chat',
  'pulse:journal': 'chat',
  'pulse:decisions': 'sent',
  'pulse:threads': 'sent',
  'pulse:slack': 'sent',
  'pulse:waitings': 'wait',
  clickup: 'clickup',
  'pulse:clickup': 'clickup',
  gitlab: 'code',
  'pulse:git': 'code',
  docs: 'code',
  wiki: 'code',
  hq: 'code'
}

export function hqBrainGroupOf(source: string): HqBrainGroup {
  return GROUP_OF_SOURCE[source] ?? 'other'
}

/** One row as `hq_brain.py timeline --json` prints it (a search hit is mapped to the same shape). */
export type HqBrainScriptRow = {
  ts: string
  day: string
  key: string
  source: string
  project: string | null
  title: string | null
  link: string | null
  atom: string | null
  mentions: number
  text: string
}

export type HqBrainStatus =
  | { kind: 'sent'; outcome: 'approved' | 'edited' | 'rejected' | null }
  | { kind: 'wait'; status: 'open' | 'resolved' | 'cancelled'; resolution: string | null }

export type HqBrainChatRef = { sessionId: string; worktreeId: string | null }

export type HqBrainRow = HqBrainScriptRow & {
  /** Unique on the screen: one document per day. */
  id: string
  at: number
  group: HqBrainGroup
  status: HqBrainStatus | null
  /** Who a wait is on, or who a message went to. */
  person: string | null
  /** Where an approved call went: `DM with Ann`, `#general`, the task. */
  target: string | null
  /** The Orca chat the row was said in, or that sent it; «Open chat» opens it. */
  chat: HqBrainChatRef | null
  /** An approved shell command (`remote · …`, `git · push`…): hidden unless asked for. */
  command: boolean
}

export type HqBrainHeadKind = 'task' | 'mr' | 'project' | 'person' | 'words'

export type HqBrainHead = {
  kind: HqBrainHeadKind
  /** The task's or MR's own name, when the brain holds its page. */
  title: string | null
  link: string | null
  /** The project most rows belong to. */
  project: string | null
}

export type HqBrainWait = {
  id: string
  title: string
  person: string | null
  /** `on-them`: we wait for the person; `on-me`: the person waits for us. */
  direction: 'on-them' | 'on-me'
  since: number
  link: string | null
  chat: HqBrainChatRef | null
}

export type HqBrainPerson = { name: string; count: number }

export type HqBrainResult = {
  query: string
  mode: 'timeline' | 'search'
  matchedBy: 'id' | 'project' | 'words' | 'nothing'
  ms: number
  head: HqBrainHead
  rows: HqBrainRow[]
  /** Open waits about this entity, newest first. */
  waiting: HqBrainWait[]
  /** Closed waits among the rows — «nothing — the last 5 waits are closed». */
  closedWaits: number
  people: HqBrainPerson[]
}

const str = (value: unknown): string | null => (typeof value === 'string' ? value : null)

function readRow(value: unknown): HqBrainScriptRow | null {
  if (!value || typeof value !== 'object') {
    return null
  }
  const get = (name: string): unknown => Reflect.get(value, name)
  const ts = str(get('ts'))
  const key = str(get('key'))
  const source = str(get('source'))
  if (!ts || !key || !source) {
    return null
  }
  const mentions = get('mentions')
  return {
    ts,
    day: str(get('day')) ?? ts.slice(0, 10),
    key,
    source,
    project: str(get('project')),
    title: str(get('title')),
    link: str(get('link')),
    atom: str(get('atom')),
    mentions: typeof mentions === 'number' && Number.isFinite(mentions) ? mentions : 1,
    text: str(get('text')) ?? str(get('snippet')) ?? ''
  }
}

/** `timeline --json`: how it matched and its rows; null when the output is not that shape. */
export function readHqBrainTimeline(
  raw: unknown
): { matchedBy: HqBrainResult['matchedBy']; ms: number; rows: HqBrainScriptRow[] } | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const rows = Reflect.get(raw, 'rows')
  if (!Array.isArray(rows)) {
    return null
  }
  const how = Reflect.get(raw, 'matched_by')
  const ms = Reflect.get(raw, 'ms')
  return {
    matchedBy: how === 'id' || how === 'project' || how === 'words' ? how : 'nothing',
    ms: typeof ms === 'number' ? ms : 0,
    rows: rows.map(readRow).filter((row): row is HqBrainScriptRow => row !== null)
  }
}

/** `search --json`: its hits as timeline rows (the snippet is the text). */
export function readHqBrainSearch(raw: unknown): { ms: number; rows: HqBrainScriptRow[] } | null {
  if (!raw || typeof raw !== 'object') {
    return null
  }
  const hits = Reflect.get(raw, 'hits')
  if (!Array.isArray(hits)) {
    return null
  }
  const ms = Reflect.get(raw, 'ms')
  return {
    ms: typeof ms === 'number' ? ms : 0,
    rows: hits.map(readRow).filter((row): row is HqBrainScriptRow => row !== null)
  }
}

/** Free text of three words or more goes to the ranked search; an id, a project or a name to the timeline. */
export function hqBrainModeOf(query: string): 'timeline' | 'search' {
  return query.trim().split(/\s+/).filter(Boolean).length >= 3 ? 'search' : 'timeline'
}

const COMMAND_SERVICES = new Set(['remote', 'ssh', 'git', 'deploy'])

/** An approval of a shell command rather than of a message: `remote · …`, `git · push`, `HTTP · curl …`. */
export function isHqBrainCommandTitle(title: string | null): boolean {
  if (!title) {
    return false
  }
  const [service, operation = ''] = title.split(' · ')
  return COMMAND_SERVICES.has(service.trim()) || /^curl\b/.test(operation.trim())
}

/** Task ids, MRs and repo MRs inside a line of text, for the cards' clickable mentions. */
const ENTITY_RE =
  /(?<![\w-])[A-Z][A-Z0-9]{1,9}-\d{3,}(?![\w-])|(?<![\w!#/])(?:[a-z0-9][\w.-]*\/)*[a-z0-9][\w.-]*!\d+\b|(?<![\w!#])!\d+\b/g

export type HqBrainTextPart =
  | { kind: 'text'; text: string }
  | { kind: 'entity'; text: string; entity: string }

/** `acme/billing-api!23` is asked for as `billing-api!23`: the group would match every MR of it. */
export function hqBrainEntityOf(token: string): string {
  const slash = token.lastIndexOf('/')
  return slash !== -1 && token.includes('!') ? token.slice(slash + 1) : token
}

export function splitHqBrainEntities(text: string): HqBrainTextPart[] {
  const parts: HqBrainTextPart[] = []
  let last = 0
  for (const match of text.matchAll(ENTITY_RE)) {
    const at = match.index ?? 0
    if (at > last) {
      parts.push({ kind: 'text', text: text.slice(last, at) })
    }
    parts.push({ kind: 'entity', text: match[0], entity: hqBrainEntityOf(match[0]) })
    last = at + match[0].length
  }
  if (last < text.length) {
    parts.push({ kind: 'text', text: text.slice(last) })
  }
  return parts
}

/** The rows by day, newest day first and newest row first within it. */
export function hqBrainDays(rows: readonly HqBrainRow[]): { day: string; rows: HqBrainRow[] }[] {
  const byDay = new Map<string, HqBrainRow[]>()
  for (const row of [...rows].sort((a, b) => b.at - a.at)) {
    const list = byDay.get(row.day)
    if (list) {
      list.push(row)
    } else {
      byDay.set(row.day, [row])
    }
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([day, list]) => ({ day, rows: list }))
}

/** The rows a chip shows; command approvals only when asked for. */
export function hqBrainVisibleRows(
  rows: readonly HqBrainRow[],
  group: HqBrainGroup | 'all',
  showCommands: boolean
): HqBrainRow[] {
  return rows.filter(
    (row) => (showCommands || !row.command) && (group === 'all' || row.group === group)
  )
}

/** How many rows each chip holds, command approvals counted only when shown. */
export function hqBrainGroupCounts(
  rows: readonly HqBrainRow[],
  showCommands: boolean
): Record<HqBrainGroup | 'all', number> {
  const counts: Record<HqBrainGroup | 'all', number> = {
    all: 0,
    chat: 0,
    sent: 0,
    wait: 0,
    clickup: 0,
    code: 0,
    other: 0
  }
  for (const row of rows) {
    if (row.command && !showCommands) {
      continue
    }
    counts.all += 1
    counts[row.group] += 1
  }
  return counts
}

export function isHqBrainResult(value: unknown): value is HqBrainResult {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    Array.isArray(Reflect.get(value as object, 'rows')) &&
    Array.isArray(Reflect.get(value as object, 'waiting')) &&
    Array.isArray(Reflect.get(value as object, 'people')) &&
    typeof Reflect.get(value as object, 'head') === 'object'
  )
}
