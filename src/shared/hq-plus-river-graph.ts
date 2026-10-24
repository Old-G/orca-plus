// Custom build (hq-plus-ui): the HQ+ screen's Река — one lane per project over the week, green where an
// agent worked and dashed where it waits on a person — and Граф — people → projects → the systems those
// projects lean on, from the open waits and the projects' `relations` in HQ.
import { HQ_JOURNAL_KIND, type HqJournalActivity } from './hq-journal'
import { HQ_PLUS_FEED_WINDOW_MS } from './hq-plus-screen'

const DAY_MS = 24 * 60 * 60_000
const LANE_SLOTS = 14

export function hqPlusLaneSlotMs(): number {
  return HQ_PLUS_FEED_WINDOW_MS / LANE_SLOTS
}
/** A wait this old is drawn as long overdue. */
export const HQ_PLUS_LONG_WAIT_DAYS = 2

export type HqPlusWait = {
  personId: string | null
  personName: string | null
  project: string | null
  title: string
  createdAt: number
  /** `on-them`: we wait on the person; `on-me`: the person waits on the owner. */
  direction: 'on-me' | 'on-them'
}

/** The rows that mean an agent worked on a project, as the River draws them. */
export const HQ_PLUS_WORK_KINDS: ReadonlySet<string> = new Set([
  HQ_JOURNAL_KIND.chatReport,
  HQ_JOURNAL_KIND.chatMessage,
  HQ_JOURNAL_KIND.sessionOpen,
  HQ_JOURNAL_KIND.sessionContinue,
  HQ_JOURNAL_KIND.sessionHandoff,
  HQ_JOURNAL_KIND.sessionPlan
])

export type HqPlusLane = {
  project: string
  room: string
  /** 0…1 across the week, oldest left. */
  work: [number, number][]
  wait: { from: number; long: boolean } | null
  note:
    | { kind: 'wait'; person: string; days: number; long: boolean }
    | { kind: 'today' }
    | { kind: 'quiet'; days: number }
  lastAt: number
  sessionId: string | null
}

function days(now: number, at: number): number {
  return Math.max(0, Math.floor((now - at) / DAY_MS))
}

/** `activity` holds work rows only (HQ_PLUS_WORK_KINDS). Waiting projects first, then the busiest. */
export function hqPlusLanes(
  activity: readonly HqJournalActivity[],
  waits: readonly HqPlusWait[],
  now: number,
  maxLanes = 10
): HqPlusLane[] {
  const start = now - HQ_PLUS_FEED_WINDOW_MS
  const slotMs = HQ_PLUS_FEED_WINDOW_MS / LANE_SLOTS
  const place = (at: number): number =>
    Math.min(1, Math.max(0, (at - start) / HQ_PLUS_FEED_WINDOW_MS))
  const slots = new Map<string, Set<number>>()
  const meta = new Map<string, { room: string; lastAt: number; sessionId: string | null }>()
  for (const entry of activity) {
    if (!entry.project || entry.at < start) {
      continue
    }
    const known = meta.get(entry.project)
    if (!known || known.lastAt < entry.at) {
      meta.set(entry.project, {
        room: entry.workspace,
        lastAt: entry.at,
        sessionId: entry.sessionId ?? known?.sessionId ?? null
      })
    }
    const set = slots.get(entry.project) ?? new Set<number>()
    set.add(Math.min(LANE_SLOTS - 1, Math.floor((entry.at - start) / slotMs)))
    slots.set(entry.project, set)
  }
  const oldestWait = new Map<string, HqPlusWait>()
  for (const wait of waits) {
    if (wait.direction !== 'on-them' || !wait.project) {
      continue
    }
    const known = oldestWait.get(wait.project)
    if (!known || wait.createdAt < known.createdAt) {
      oldestWait.set(wait.project, wait)
    }
  }
  const projects = new Set([...meta.keys(), ...oldestWait.keys()])
  const lanes: HqPlusLane[] = []
  for (const project of projects) {
    const marks = [...(slots.get(project) ?? [])].sort((a, b) => a - b)
    const work: [number, number][] = []
    for (const slot of marks) {
      const last = work.at(-1)
      if (last && Math.round(last[1] * LANE_SLOTS) === slot) {
        last[1] = (slot + 1) / LANE_SLOTS
      } else {
        work.push([slot / LANE_SLOTS, (slot + 1) / LANE_SLOTS])
      }
    }
    const wait = oldestWait.get(project) ?? null
    const waited = wait ? days(now, wait.createdAt) : 0
    const long = waited >= HQ_PLUS_LONG_WAIT_DAYS
    const info = meta.get(project)
    const lastAt = Math.max(info?.lastAt ?? 0, wait?.createdAt ?? 0)
    lanes.push({
      project,
      room: info?.room ?? '',
      work,
      wait: wait ? { from: place(wait.createdAt), long } : null,
      note: wait
        ? { kind: 'wait', person: wait.personName ?? wait.personId ?? '?', days: waited, long }
        : days(now, lastAt) === 0
          ? { kind: 'today' }
          : { kind: 'quiet', days: days(now, lastAt) },
      lastAt,
      sessionId: info?.sessionId ?? null
    })
  }
  // Why: waits alone would fill the lanes; the busiest projects keep at least half of them.
  const recent = (a: HqPlusLane, b: HqPlusLane): number => b.lastAt - a.lastAt
  const waiting = lanes.filter((lane) => lane.wait).sort(recent)
  const working = lanes.filter((lane) => !lane.wait && lane.work.length > 0).sort(recent)
  const shownWaits = waiting.slice(0, Math.max(maxLanes - working.length, Math.ceil(maxLanes / 2)))
  return [...shownWaits, ...working.slice(0, maxLanes - shownWaits.length)]
}

export type HqPlusGraphNode = { id: string; label: string; detail: string }
export type HqPlusGraphEdge = {
  from: string
  to: string
  /** Custom build (hq-closed-loop): `member` — a dossier names the person in the project. */
  kind: 'relation' | 'wait-long' | 'wait' | 'owe' | 'member'
}

/** Custom build (hq-closed-loop): a person in a project, by their dossier. */
export type HqPlusGraphMember = { personId: string; label: string; project: string }

const MEMBERS_SHOWN = 16
export type HqPlusGraph = {
  people: (HqPlusGraphNode & { owner?: boolean })[]
  projects: (HqPlusGraphNode & { room: string; active: boolean })[]
  systems: HqPlusGraphNode[]
  edges: HqPlusGraphEdge[]
}

export const HQ_PLUS_OWNER_NODE = 'owner'

/**
 * People we wait on (and the owner, when someone waits on him) → the projects they hold up or that are
 * busy this week → the projects those depend on, by HQ's `relations`.
 */
export function hqPlusGraph(input: {
  waits: readonly HqPlusWait[]
  pages: readonly { slug: string; room: string; relations: readonly string[] }[]
  active: ReadonlySet<string>
  now: number
  limit?: number
  members?: readonly HqPlusGraphMember[]
}): HqPlusGraph {
  const limit = input.limit ?? 8
  const members = input.members ?? []
  const pageBySlug = new Map(input.pages.map((page) => [page.slug, page]))
  const owes = new Map<string, { label: string; count: number; oldest: number }>()
  const edges: HqPlusGraphEdge[] = []
  const projectWeight = new Map<string, number>()
  const personProject = new Map<string, number>()
  let ownerOwes = false
  for (const wait of input.waits) {
    if (!wait.personId) {
      continue
    }
    const label = wait.personName ?? wait.personId
    if (wait.direction === 'on-me') {
      ownerOwes = true
      const person = owes.get(wait.personId) ?? { label, count: 0, oldest: wait.createdAt }
      owes.set(wait.personId, person)
      edges.push({ from: HQ_PLUS_OWNER_NODE, to: wait.personId, kind: 'owe' })
      continue
    }
    const person = owes.get(wait.personId) ?? { label, count: 0, oldest: wait.createdAt }
    person.count += 1
    person.oldest = Math.min(person.oldest, wait.createdAt)
    owes.set(wait.personId, person)
    if (wait.project) {
      projectWeight.set(wait.project, (projectWeight.get(wait.project) ?? 0) + 10)
      const key = `${wait.personId}\u0000${wait.project}`
      personProject.set(key, Math.min(personProject.get(key) ?? Infinity, wait.createdAt))
    }
  }
  for (const project of input.active) {
    projectWeight.set(project, (projectWeight.get(project) ?? 0) + 1)
  }
  for (const project of new Set(members.map((member) => member.project))) {
    projectWeight.set(project, (projectWeight.get(project) ?? 0) + 1)
  }
  const projects = [...projectWeight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([slug]) => slug)
  const shown = new Set(projects)
  for (const [key, oldest] of personProject) {
    const [personId, project] = key.split('\u0000')
    if (shown.has(project)) {
      edges.push({
        from: personId,
        to: project,
        kind: days(input.now, oldest) >= HQ_PLUS_LONG_WAIT_DAYS ? 'wait-long' : 'wait'
      })
    }
  }
  const fanIn = new Map<string, number>()
  const linked = new Set<string>()
  for (const project of projects) {
    for (const target of pageBySlug.get(project)?.relations ?? []) {
      if (shown.has(target)) {
        // Why: a mutual relation is drawn once; a one-way one must survive any slug order.
        const pair = [project, target].sort().join('\u0000')
        if (!linked.has(pair)) {
          linked.add(pair)
          edges.push({ from: project, to: target, kind: 'relation' })
        }
      } else {
        fanIn.set(target, (fanIn.get(target) ?? 0) + 1)
      }
    }
  }
  const systems = [...fanIn.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit - 1)
    .map(([slug]) => slug)
  const systemSet = new Set(systems)
  for (const project of projects) {
    for (const target of pageBySlug.get(project)?.relations ?? []) {
      if (systemSet.has(target)) {
        edges.push({ from: project, to: target, kind: 'relation' })
      }
    }
  }
  for (const member of members) {
    if (shown.has(member.project)) {
      edges.push({ from: member.personId, to: member.project, kind: 'member' })
      if (!owes.has(member.personId)) {
        owes.set(member.personId, { label: member.label, count: 0, oldest: input.now })
      }
    }
  }
  const linkedPeople = new Set(
    edges.flatMap((edge) => (edge.kind === 'relation' ? [] : [edge.from, edge.to]))
  )
  const people = [...owes.entries()]
    .filter(([id]) => linkedPeople.has(id))
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, members.length > 0 ? MEMBERS_SHOWN : limit - 1)
    .map(([id, person]) => ({
      id,
      label: person.label,
      detail: person.count > 0 ? `${person.count} · ${days(input.now, person.oldest)} d` : ''
    }))
  return {
    people: ownerOwes
      ? [...people, { id: HQ_PLUS_OWNER_NODE, label: '', detail: '', owner: true }]
      : people,
    projects: projects.map((slug) => ({
      id: slug,
      label: slug,
      detail: '',
      room: pageBySlug.get(slug)?.room ?? '',
      active: input.active.has(slug)
    })),
    systems: systems.map((slug) => ({ id: slug, label: slug, detail: '' })),
    edges: edges.filter(
      (edge) =>
        (edge.kind !== 'owe' && edge.kind !== 'member') ||
        people.some((person) => person.id === (edge.kind === 'owe' ? edge.to : edge.from))
    )
  }
}

/** Custom build (hq-closed-loop): the graph's people-in-projects, from People rows with dossiers. */
export function hqPlusGraphMembers(
  rows: readonly {
    key: string
    name: string
    pulsePersonId: string | null
    projects?: readonly { slug: string }[]
  }[]
): HqPlusGraphMember[] {
  return rows.flatMap((row) =>
    (row.projects ?? []).map((entry) => ({
      personId: row.pulsePersonId ?? row.key,
      label: row.name,
      project: entry.slug
    }))
  )
}
