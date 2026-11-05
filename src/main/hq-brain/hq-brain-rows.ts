// Custom build (hq-plus-brain): the brain's rows with what only Pulse knows — an approval's outcome and
// where it went, a wait's state and person, the chat a row was said in — and the screen's head, open
// waits and people, built from them.
import {
  hqBrainGroupOf,
  isHqBrainCommandTitle,
  type HqBrainChatRef,
  type HqBrainHead,
  type HqBrainPerson,
  type HqBrainResult,
  type HqBrainRow,
  type HqBrainScriptRow,
  type HqBrainWait
} from '../../shared/hq-brain'
import type { PulseDecision, PulsePerson, PulseWaiting } from '../../shared/pulse-types'

const DECISIONS_READ = 5000

export type HqBrainPulse = {
  waitings: () => PulseWaiting[]
  decisions: (limit: number) => PulseDecision[]
  people: () => PulsePerson[]
}

const ORCA_SESSION = 'orca-session:'

/** `DM with Ann`, `DM Ann` → Ann; a channel or a task is no person. */
export function hqBrainPersonOfTarget(target: string | null): string | null {
  const match = target ? /^DM(?: with)?\s+(.+?)(?:\s+\([A-Z0-9]+\))?$/.exec(target.trim()) : null
  return match ? match[1].trim() : null
}

export type PulseIndex = {
  waits: Map<string, PulseWaiting>
  decisions: Map<string, PulseDecision>
  personName: (id: string | null) => string | null
  /** The Pulse name of a Slack user or DM a message went to: «Ann», not Slack's «Ann Lee». */
  personOfSlack: (id: string | null) => string | null
}

export function pulseIndex(pulse: HqBrainPulse): PulseIndex {
  const list = pulse.people()
  const people = new Map(list.map((person) => [person.id, person.name]))
  const bySlack = new Map(
    list.flatMap((person) =>
      person.slackUserId ? [[person.slackUserId, person.name] as const] : []
    )
  )
  return {
    personOfSlack: (id) => (id ? (bySlack.get(id) ?? null) : null),
    waits: new Map(pulse.waitings().map((wait) => [wait.id, wait])),
    decisions: new Map(pulse.decisions(DECISIONS_READ).map((decision) => [decision.id, decision])),
    personName: (id) => (id ? (people.get(id) ?? null) : null)
  }
}

function chatOf(
  sessionId: string | null,
  worktreeId: string | null,
  sessionWorkspace: (sessionId: string) => string | null
): HqBrainChatRef | null {
  if (!sessionId) {
    return null
  }
  return { sessionId, worktreeId: worktreeId ?? sessionWorkspace(sessionId) }
}

/** One script row with its Pulse state and chat; exported for the tests. */
export function enrichHqBrainRow(
  row: HqBrainScriptRow,
  index: PulseIndex,
  sessionWorkspace: (sessionId: string) => string | null
): HqBrainRow {
  const base: HqBrainRow = {
    ...row,
    id: `${row.key}@${row.day}`,
    at: Date.parse(row.ts) || 0,
    group: hqBrainGroupOf(row.source),
    status: null,
    person: null,
    target: null,
    chat: row.link?.startsWith(ORCA_SESSION)
      ? chatOf(row.link.slice(ORCA_SESSION.length), null, sessionWorkspace)
      : null,
    command: false
  }
  if (row.key.startsWith('decisions:')) {
    const decision = index.decisions.get(row.key.slice('decisions:'.length))
    const sent = decision?.sentContext ?? null
    const target = sent?.targetName ?? null
    return {
      ...base,
      status:
        decision?.kind === 'approval' ? { kind: 'sent', outcome: decision.outcome ?? null } : null,
      person:
        index.personName(decision?.personId ?? null) ??
        index.personOfSlack(sent?.targetId ?? null) ??
        hqBrainPersonOfTarget(target),
      target,
      chat: chatOf(sent?.agentSessionId ?? null, sent?.worktreeId ?? null, sessionWorkspace),
      command: isHqBrainCommandTitle(decision?.title ?? row.title)
    }
  }
  if (row.key.startsWith('waitings:')) {
    const wait = index.waits.get(row.key.slice('waitings:'.length))
    return wait
      ? {
          ...base,
          status: { kind: 'wait', status: wait.status, resolution: wait.resolution },
          person: index.personName(wait.personId),
          // Why: the indexed text repeats «Waiting: we wait for …» before the wait's own words.
          text: wait.title,
          link: row.link ?? wait.replyLink ?? null,
          chat: chatOf(wait.agentSessionId, wait.worktreeId, sessionWorkspace)
        }
      : base
  }
  return base
}

const lower = (text: string | null | undefined): string => (text ?? '').toLowerCase()

/** Open waits about the entity: named in rows, or matching it by id, project or person. */
export function hqBrainOpenWaits(
  query: string,
  matchedBy: HqBrainResult['matchedBy'],
  rows: readonly HqBrainRow[],
  index: PulseIndex,
  sessionWorkspace: (sessionId: string) => string | null
): HqBrainWait[] {
  const needle = lower(query.trim())
  const inRows = new Set(
    rows.filter((row) => row.key.startsWith('waitings:')).map((row) => row.key.slice(9))
  )
  const about = (wait: PulseWaiting): boolean => {
    if (inRows.has(wait.id)) {
      return true
    }
    if (!needle) {
      return false
    }
    if (matchedBy === 'project') {
      return lower(wait.project) === needle
    }
    const person = lower(index.personName(wait.personId))
    return (
      lower(wait.title).includes(needle) ||
      lower(wait.detail).includes(needle) ||
      (matchedBy === 'words' && person !== '' && person === needle)
    )
  }
  return [...index.waits.values()]
    .filter((wait) => wait.status === 'open' && about(wait))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((wait) => ({
      id: wait.id,
      title: wait.title,
      person: index.personName(wait.personId),
      direction: wait.direction,
      since: wait.createdAt,
      link: wait.replyLink ?? (wait.sourceRef?.startsWith('http') ? wait.sourceRef : null),
      chat: chatOf(wait.agentSessionId, wait.worktreeId, sessionWorkspace)
    }))
}

/** The people of the waits and the messages found, most rows first. */
export function hqBrainPeople(
  rows: readonly HqBrainRow[],
  waits: readonly HqBrainWait[]
): HqBrainPerson[] {
  const counts = new Map<string, number>()
  const seenWaits = new Set<string>()
  for (const row of rows) {
    if (row.person && (row.group === 'wait' || row.group === 'sent') && !row.command) {
      counts.set(row.person, (counts.get(row.person) ?? 0) + 1)
      if (row.key.startsWith('waitings:')) {
        seenWaits.add(row.key.slice(9))
      }
    }
  }
  for (const wait of waits) {
    if (wait.person && !seenWaits.has(wait.id)) {
      counts.set(wait.person, (counts.get(wait.person) ?? 0) + 1)
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

const ID_RE = /^[A-Z][A-Z0-9]{1,9}-\d+$/i

/** What the screen's header says about the entity. */
export function hqBrainHead(
  query: string,
  matchedBy: HqBrainResult['matchedBy'],
  rows: readonly HqBrainRow[],
  people: readonly PulsePerson[]
): HqBrainHead {
  const q = query.trim()
  const projects = new Map<string, number>()
  for (const row of rows) {
    if (row.project) {
      projects.set(row.project, (projects.get(row.project) ?? 0) + 1)
    }
  }
  const project = [...projects.entries()].sort((a, b) => b[1] - a[1]).at(0)?.[0] ?? null
  const strip = (title: string | null, lead: string | RegExp): string | null =>
    title ? title.replace(lead, '').trim() || null : null
  if (matchedBy === 'id' && ID_RE.test(q)) {
    const page = rows.find((row) => row.key.toUpperCase() === `CLICKUP:${q.toUpperCase()}`)
    return {
      kind: 'task',
      title: page ? strip(page.title, new RegExp(`^${q}\\s*`, 'i')) : null,
      link: page?.link ?? null,
      project
    }
  }
  if (matchedBy === 'id' && q.includes('!')) {
    const number = q.slice(q.lastIndexOf('!'))
    const page = rows.find(
      (row) => row.key.startsWith('gitlab:') && row.key.endsWith(number) && row.key.includes(q)
    )
    return {
      kind: 'mr',
      title: page ? strip(page.title, /^\S+!\d+\s*/) : null,
      link: page?.link ?? null,
      project
    }
  }
  if (matchedBy === 'project' || (matchedBy === 'id' && projects.has(q))) {
    return { kind: 'project', title: null, link: null, project: q }
  }
  const person = people.some((candidate) => lower(candidate.name) === lower(q))
  return { kind: person ? 'person' : 'words', title: null, link: null, project }
}
