// Custom build (hq-plus-map): what HQ+'s Map layout draws and how its Feed sorts rows into tabs. The map
// is one room's hub with its sources (Slack, ClickUp, mail, GitLab) feeding the projects, and each
// project unfolds into the people it waits on, its chats and the talks that wait on the owner. The feed
// keeps one card per conversation in All · Your move · Waiting · FYI · Done and leaves service rows out.
import { hqPlusIsFyi, hqPlusLook, hqPlusNeedsOwner, hqPlusSourceOfKey } from './hq-plus-kinds'
import type { HqPlusSource } from './hq-plus-kinds'
import type { HqPlusLogItem } from './hq-plus-log'

export const HQ_PLUS_MAP_FEED_TABS = ['all', 'you', 'wait', 'fyi', 'done'] as const
export type HqPlusMapFeedTab = (typeof HQ_PLUS_MAP_FEED_TABS)[number]

/** Where a row stands in the new feed; null keeps it off the feed (a chat's turn, a journal row, a
 *  decided Approve, a reminder alone) — the map and the chat list show those. */
export function hqPlusMapFeedPlace(item: HqPlusLogItem): 'you' | 'fyi' | 'done' | 'other' | null {
  if (item.kind === 'line') {
    return null
  }
  if (item.kind === 'me') {
    return 'other'
  }
  if (hqPlusNeedsOwner(item)) {
    return 'you'
  }
  if (item.open) {
    return hqPlusIsFyi(item) ? 'fyi' : null
  }
  if (item.type === 'approve' || hqPlusLook(item).kind === 'bg') {
    return null
  }
  return 'done'
}

/** The rows of one tab, in feed order; Waiting is the waits list, not rows. */
export function hqPlusMapFeedRows(
  items: readonly HqPlusLogItem[],
  tab: HqPlusMapFeedTab
): HqPlusLogItem[] {
  return items.filter((item) => {
    const place = hqPlusMapFeedPlace(item)
    return place !== null && (tab === 'all' || place === tab)
  })
}

/** The source a row came from, if it came from outside. */
export function hqPlusMapSourceOf(item: HqPlusLogItem): HqPlusSource | null {
  if (item.kind !== 'card') {
    return null
  }
  if (item.type === 'conversation' && item.conversation) {
    return hqPlusSourceOfKey(item.conversation.key)
  }
  return hqPlusLook(item).source
}

export type HqPlusMapWait = {
  id: string
  personName: string | null
  project: string | null
  title: string
  at: number
  /** The feed row holding the person's answer, when one came. */
  answerId: string | null
}

export type HqPlusMapChatState = 'asks' | 'working' | 'done' | 'quiet'

export type HqPlusMapChat = {
  key: string
  project: string | null
  state: HqPlusMapChatState
  sessionId: string | null
}

export type HqPlusMapLeaf =
  | {
      kind: 'person'
      key: string
      name: string
      waits: HqPlusMapWait[]
      answered: number
      oldestAt: number
    }
  | { kind: 'chat'; key: string; chatKey: string; state: HqPlusMapChatState }
  | { kind: 'talk'; key: string; itemId: string; title: string; source: HqPlusSource | null }

export type HqPlusMapProject = {
  slug: string
  /** Conversations no rule or model placed — the owner sorts them with the card's project chip. */
  unsorted: boolean
  /** What waits on the owner here: talks, answers that came, chats that ask. */
  you: number
  waits: number
  chats: number
  oldestWaitAt: number | null
  /** Conversations per source, for the hub's edges. */
  sources: Partial<Record<HqPlusSource, number>>
  leaves: HqPlusMapLeaf[]
}

export type HqPlusMapModel = {
  sources: { source: HqPlusSource; count: number }[]
  projects: HqPlusMapProject[]
}

export const HQ_PLUS_MAP_UNSORTED = 'Unsorted'
const SOURCE_ORDER: readonly HqPlusSource[] = ['slack', 'clickup', 'gmail', 'gitlab']
const TALKS_PER_PROJECT = 8
const CHAT_ORDER: readonly HqPlusMapChatState[] = ['asks', 'working', 'done', 'quiet']
/** Where HQ's own rows and waits with no project stand. */
const HQ_OWN = 'HQ'

function itemTitle(item: HqPlusLogItem): string {
  return item.kind === 'me' ? item.text : item.title
}

/**
 * The room's map. `projects` are the room's own, in its order; a project with nothing going on stays
 * off the map, and one the rows name but the room does not list joins it.
 */
export function hqPlusMapModel(input: {
  projects: readonly string[]
  items: readonly HqPlusLogItem[]
  waits: readonly HqPlusMapWait[]
  chats: readonly HqPlusMapChat[]
}): HqPlusMapModel {
  const bySlug = new Map<string, HqPlusMapProject>()
  const order = [...input.projects]
  const projectOf = (slug: string | null): HqPlusMapProject => {
    const key = slug ?? HQ_PLUS_MAP_UNSORTED
    let project = bySlug.get(key)
    if (!project) {
      project = {
        slug: key,
        unsorted: slug === null,
        you: 0,
        waits: 0,
        chats: 0,
        oldestWaitAt: null,
        sources: {},
        leaves: []
      }
      bySlug.set(key, project)
      if (!order.includes(key)) {
        order.push(key)
      }
    }
    return project
  }

  const answerIds = new Set(input.waits.flatMap((wait) => (wait.answerId ? [wait.answerId] : [])))
  const chatSessions = new Set(
    input.chats.flatMap((chat) => (chat.sessionId ? [chat.sessionId] : []))
  )
  const talks = new Map<HqPlusMapProject, { item: HqPlusLogItem; source: HqPlusSource | null }[]>()
  const totals = new Map<HqPlusSource, number>()
  for (const item of input.items) {
    const source = hqPlusMapSourceOf(item)
    const asksOwner = hqPlusNeedsOwner(item)
    if (!source && !asksOwner) {
      continue
    }
    // Why: a chat's own question shows on its chat leaf, an answer on its person leaf.
    const shownElsewhere =
      answerIds.has(item.id) ||
      (item.kind === 'card' && item.type === 'move' && chatSessions.has(item.sessionId ?? ''))
    if (!source && shownElsewhere) {
      continue
    }
    // Why: only a conversation from outside is unsorted; HQ's own rows belong to HQ.
    const project = projectOf(item.project ?? (source ? null : HQ_OWN))
    if (source) {
      project.sources[source] = (project.sources[source] ?? 0) + 1
      totals.set(source, (totals.get(source) ?? 0) + 1)
    }
    if (asksOwner && !shownElsewhere) {
      talks.set(project, [...(talks.get(project) ?? []), { item, source }])
    }
  }

  const people = new Map<HqPlusMapProject, Map<string, HqPlusMapWait[]>>()
  for (const wait of input.waits) {
    const project = projectOf(wait.project ?? HQ_OWN)
    const name = wait.personName ?? 'Someone'
    const list = people.get(project) ?? new Map<string, HqPlusMapWait[]>()
    list.set(name, [...(list.get(name) ?? []), wait])
    people.set(project, list)
  }

  const chats = new Map<HqPlusMapProject, HqPlusMapChat[]>()
  for (const chat of input.chats) {
    const project = projectOf(chat.project)
    chats.set(project, [...(chats.get(project) ?? []), chat])
  }

  for (const project of bySlug.values()) {
    const projectTalks = (talks.get(project) ?? []).toSorted((a, b) => b.item.at - a.item.at)
    for (const { item, source } of projectTalks.slice(0, TALKS_PER_PROJECT)) {
      project.leaves.push({
        kind: 'talk',
        key: `talk:${item.id}`,
        itemId: item.id,
        title: itemTitle(item),
        source
      })
    }
    // Why: whoever answered comes first, then whoever is late the longest.
    const persons = [...(people.get(project) ?? new Map<string, HqPlusMapWait[]>()).entries()]
      .map(([name, waits]) => ({
        name,
        waits: waits.toSorted((a, b) => a.at - b.at),
        answered: waits.filter((wait) => wait.answerId).length,
        oldestAt: Math.min(...waits.map((wait) => wait.at))
      }))
      .sort((a, b) => b.answered - a.answered || a.oldestAt - b.oldestAt)
    for (const person of persons) {
      project.leaves.push({ kind: 'person', key: `person:${person.name}`, ...person })
      project.waits += person.waits.length
      project.oldestWaitAt = Math.min(project.oldestWaitAt ?? person.oldestAt, person.oldestAt)
    }
    const projectChats = (chats.get(project) ?? []).toSorted(
      (a, b) => CHAT_ORDER.indexOf(a.state) - CHAT_ORDER.indexOf(b.state)
    )
    for (const chat of projectChats) {
      project.leaves.push({
        kind: 'chat',
        key: `chat:${chat.key}`,
        chatKey: chat.key,
        state: chat.state
      })
    }
    project.chats = projectChats.length
    project.you =
      projectTalks.length +
      persons.reduce((sum, person) => sum + person.answered, 0) +
      projectChats.filter((chat) => chat.state === 'asks').length
  }

  const projects = order.flatMap((slug) => {
    const project = bySlug.get(slug)
    return project && (project.leaves.length > 0 || Object.keys(project.sources).length > 0)
      ? [project]
      : []
  })
  // Why: what waits on the owner leads; Unsorted closes the list whatever it holds.
  projects.sort(
    (a, b) =>
      Number(a.unsorted) - Number(b.unsorted) ||
      Number(b.you > 0) - Number(a.you > 0) ||
      b.you - a.you ||
      b.waits - a.waits
  )
  return {
    sources: SOURCE_ORDER.flatMap((source) => {
      const count = totals.get(source) ?? 0
      return count > 0 ? [{ source, count }] : []
    }),
    projects
  }
}
