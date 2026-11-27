// Custom build (hq-router, plan router T1, owner 26.11): where a message the owner marked with 👾 (or
// pasted as a link) goes, and why — exact signals in code first (a footer breadcrumb, a thread already
// bound to a chat, a task / MR / branch the message names), then one model choice over eight open
// chats. The card says why in words the code writes, never the model. Auto sends: hq-router-auto.
import { hqRouterSingleLiveWork, type HqRouterAutoClass } from './hq-router-auto'
import type { HqRouterCrumb } from './hq-router-crumb'
import type { HqSessionState } from './hq-journal'

export const HQ_ROUTER_NEW = 'new'
export const HQ_ROUTER_SHORTLIST = 8
/** Pinned (owner 26.11): a moving alias would change the router under the owner's feet. */
export const HQ_ROUTER_JEV_MODEL = 'typesafe/jev-1.14'
export const HQ_ROUTER_JEV_URL = 'https://openrouter.ai/api/alpha/decisions'
/** Why 3 s: the bake-off's Jev p90 was 2.2 s; past that the fallback model answers. */
export const HQ_ROUTER_JEV_TIMEOUT_MS = 3_000
/** A Lead counts as fresh for the shortlist while it was active this recently. */
export const HQ_ROUTER_FRESH_LEAD_MS = 5 * 24 * 60 * 60_000

/** An open chat the message may go to. */
export type HqRouterChat = {
  sessionId: string
  title: string
  project: string | null
  /** The repo its worktree belongs to; the card needs it to name the chat. */
  repoId: string | null
  /** Custom build (hq-router T4): its worktree, so «Send» can reopen a chat with no tab. */
  worktreeId?: string | null
  role: 'lead' | 'sublead' | 'worker' | 'review' | null
  /** Its Lead's session id, when it has one open. */
  leadId: string | null
  /** `DEV-…` or another task ref it was started for. */
  taskRef: string | null
  lastReport: string | null
  /** Our open questions to this message's author that the chat asked. */
  waitsOnAuthor: string[]
  lastActivityAt: number
  /** Open: working or waiting; done: its tab is open, the turn ended; closed: no tab. Missing = open.
   *  Why (owner 26.11): a 👾 offered done/done/closed chats while open ones did the work. */
  state?: HqRouterChatState
}

export type HqRouterChatState = 'open' | 'done' | 'closed'

/** Open: mid-turn or waiting; done: the tab is open and the turn ended; closed: no tab (null = unknown). */
export function hqRouterChatState(
  state: HqSessionState,
  hasTab: boolean | null
): HqRouterChatState {
  if (hasTab === false) {
    return 'closed'
  }
  return state === 'working' || state === 'waiting' || state === 'queued' ? 'open' : 'done'
}

const STATE_RANK: Record<HqRouterChatState, number> = { open: 0, done: 1, closed: 2 }

/** Open chats first, then done, then closed; the given order kept within each. */
export function hqRouterByState<T extends Pick<HqRouterChat, 'state'>>(chats: readonly T[]): T[] {
  return chats
    .map((chat, index) => ({ chat, index, rank: STATE_RANK[chat.state ?? 'open'] }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.chat)
}

/**
 * Router v2 T2 (owner 28.11): an open topic with the message's author — a work our recent message to them
 * came from, our open waiting on them, or a chat the owner sent their message to — named by the chat
 * that carries it now.
 */
export type HqRouterTopic = {
  /** The chat to send to: the work's live chat, or its Lead once that closed. */
  chat: string
  work: string
  /** Our last word on it (the question we asked), else theirs. */
  text: string
  at: number
  source: 'message' | 'waiting' | 'choice'
}

export type HqRouterInput = {
  text: string
  author: string
  venue: string
  /** The chat a breadcrumb in the message (or the one it answers) resolves to. */
  crumb: HqRouterCrumb | null
  /** The chat this thread was already sent to; its live successor. */
  boundChat: string | null
  /** The owner's own «Send» bound the thread (router_bindings 'choice'): the thread-choice class.
   *  A chat that only posted in the thread or was guessed to work on it is a hint, never auto. */
  boundByChoice?: boolean
  /** Chats the owner sent this author's messages to before, newest first. */
  history: readonly string[]
  chats: readonly HqRouterChat[]
  /** Router v2 T2: the author's open topics, newest first — read only for a DM with no breadcrumb. */
  topics?: readonly HqRouterTopic[]
  now: number
}

export type HqRouteHow =
  | 'crumb'
  | 'thread'
  | 'question'
  | 'ref'
  | 'model'
  | 'fallback'
  | 'none'
  | 'new-mark'
  | 'topic'
  | 'topics'
export type HqRouteLevel = 'worker' | 'lead' | 'new'

export type HqRoute = {
  /** A session id, or `new`. */
  target: string
  targetTitle: string | null
  repoId: string | null
  /** The chosen chat's worktree, to reopen it when it has no tab or no live session. */
  worktreeId?: string | null
  project: string | null
  level: HqRouteLevel
  how: HqRouteHow
  /** Code-written, for the card: what the choice rests on. */
  why: string
  /** Sent without the owner's «Send»: a 🆕, or a class the router log has proved (router v2 T4). */
  auto: boolean
  autoClass?: HqRouterAutoClass | null // T4: the exact signal's class; a model's pick has none
  /** Two other open chats, best first (a «new» pick always shows them). */
  alternatives: {
    sessionId: string
    title: string
    repoId: string | null
    worktreeId?: string | null
  }[]
  /** The model's share for its pick, when a model chose. */
  confidence: number | null
  /** Which model answered, when one did. */
  model: string | null
}

export const quote = (title: string): string =>
  `«${title.replace(/\s+/g, ' ').trim().slice(0, 60)}»`

const DEV = /\bDEV-\d{2,7}\b/gi
const MR =
  /(?:\/merge_requests\/(\d+)|\/pull\/(\d+)|(?:^|[\s(])!(\d{1,6})\b|\b(?:MR|PR)\s*#?(\d{1,6})\b)/gi
// Why this shape: a branch is named with a slash and a hyphen (`feat/new-thing`); links are cut first.
const BRANCH = /(?:^|[\s`'"(])([a-z][\w.-]*\/[\w.-]*-[\w./-]*[\w])(?=$|[\s`'".,;:)])/gim

/** Task ids, MR numbers and branch names the text names, as the strings a chat would carry. */
export function hqRouterRefs(text: string): { tasks: string[]; mrs: string[]; branches: string[] } {
  const tasks = [...new Set([...text.matchAll(DEV)].map((m) => m[0].toUpperCase()))]
  const mrs = [
    ...new Set([...text.matchAll(MR)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]).filter(Boolean))
  ]
  const bare = text.replace(/https?:\/\/\S+/g, ' ')
  const branches = [...new Set([...bare.matchAll(BRANCH)].map((m) => m[1]))]
  return { tasks, mrs, branches }
}

function carries(chat: HqRouterChat, needle: RegExp): boolean {
  return [chat.taskRef, chat.title, chat.lastReport].some((field) => !!field && needle.test(field))
}

const escape = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The open chats that carry a ref the message names, and which ref matched. */
export function hqRouterRefMatches(
  text: string,
  chats: readonly HqRouterChat[]
): { chat: HqRouterChat; ref: string }[] {
  const refs = hqRouterRefs(text)
  const needles = [
    ...refs.tasks.map((ref) => ({ ref, re: new RegExp(`\\b${escape(ref)}\\b`, 'i') })),
    ...refs.mrs.map((ref) => ({
      ref: `MR !${ref}`,
      re: new RegExp(`(?:!|merge_requests/|pull/|MR\\s*#?|PR\\s*#?)${ref}\\b`, 'i')
    })),
    ...refs.branches.map((ref) => ({ ref, re: new RegExp(escape(ref), 'i') }))
  ]
  const out: { chat: HqRouterChat; ref: string }[] = []
  for (const { ref, re } of needles) {
    for (const chat of chats) {
      if (carries(chat, re) && !out.some((hit) => hit.chat.sessionId === chat.sessionId)) {
        out.push({ chat, ref })
      }
    }
  }
  return out
}

/**
 * The eight chats the model chooses from, in this order: where the owner sent this author before,
 * chats waiting on the author, fresh Leads, then the most recently active — open chats above done
 * ones, done above closed.
 */
export function hqRouterShortlist(input: HqRouterInput): HqRouterChat[] {
  const byId = new Map(input.chats.map((chat) => [chat.sessionId, chat]))
  // Why (T7/T4, owner 26.11): a chat still going is where the work is; hqRouterByState below puts
  // done and closed ones after it.
  const recent = [...input.chats].sort((a, b) => b.lastActivityAt - a.lastActivityAt)
  // Why open questions first (variant b, 26.11): an answer most often answers what we asked.
  const order = [
    ...recent.filter((chat) => chat.waitsOnAuthor.length > 0),
    ...input.history.flatMap((id) => byId.get(id) ?? []),
    ...recent.filter(
      (chat) =>
        (chat.role === 'lead' || chat.role === 'sublead') &&
        input.now - chat.lastActivityAt <= HQ_ROUTER_FRESH_LEAD_MS
    ),
    ...recent
  ]
  const out: HqRouterChat[] = []
  for (const chat of hqRouterByState(order)) {
    if (!out.includes(chat)) {
      out.push(chat)
    }
    if (out.length >= HQ_ROUTER_SHORTLIST) {
      break
    }
  }
  return out
}

function levelOf(chat: HqRouterChat | null): HqRouteLevel {
  if (!chat) {
    return 'new'
  }
  return chat.role === 'lead' || chat.role === 'sublead' ? 'lead' : 'worker'
}

/** A runner-up as the card keeps it: enough to name the chat and to reopen it. */
export function hqRouteAlternative(chat: HqRouterChat): HqRoute['alternatives'][number] {
  return {
    sessionId: chat.sessionId,
    title: chat.title,
    repoId: chat.repoId,
    worktreeId: chat.worktreeId ?? null
  }
}

export function routeTo(
  chat: HqRouterChat,
  how: HqRouteHow,
  why: string,
  others: readonly HqRouterChat[],
  extra: Partial<HqRoute> = {}
): HqRoute {
  return {
    target: chat.sessionId,
    targetTitle: chat.title,
    repoId: chat.repoId,
    worktreeId: chat.worktreeId ?? null,
    project: chat.project,
    level: levelOf(chat),
    how,
    why,
    auto: false,
    alternatives: hqRouterByState(others)
      .filter((other) => other.sessionId !== chat.sessionId)
      .slice(0, 2)
      .map(hqRouteAlternative),
    confidence: null,
    model: null,
    ...extra
  }
}

/** A chat and its Lead, the Lead first when the chat itself is not open. */
function withLead(chat: HqRouterChat, chats: readonly HqRouterChat[]): HqRouterChat[] {
  const lead = chat.leadId ? chats.find((other) => other.sessionId === chat.leadId) : undefined
  return lead ? [lead] : []
}

/**
 * The exact signals, strongest first; null when none fits and the model chooses. Each names its auto
 * class (T4); whether it sends by itself is the gate's call (hq-router-auto-gate), not this one's.
 */
export function hqRouteBySignals(input: HqRouterInput): HqRoute | null {
  const byId = new Map(input.chats.map((chat) => [chat.sessionId, chat]))
  const short = hqRouterShortlist(input)
  const hits = hqRouterRefMatches(input.text, input.chats)
  // Why (T4): a text naming another chat's task is a hint the talk moved on — no class, he confirms by hand.
  const namesOther = (id: string): boolean => hits.some((hit) => hit.chat.sessionId !== id)
  if (input.crumb) {
    const chat = input.crumb.chat ? byId.get(input.crumb.chat) : undefined
    const lead = input.crumb.lead ? byId.get(input.crumb.lead) : undefined
    const pick = chat ?? lead
    if (pick) {
      const others = [...(chat && lead ? [lead] : []), ...short]
      // Why «the work» (router v2 T1): a closed work's Lead is named even when the footer had no title.
      const why = chat
        ? `Breadcrumb: ${quote(pick.title)} sent the message they answer`
        : `Breadcrumb: ${input.crumb.chatTitle ? quote(input.crumb.chatTitle) : 'the work'} is closed; its Lead ${quote(pick.title)}`
      const work = chat && input.crumb.work && !namesOther(chat.sessionId) ? 'work-crumb' : null
      return routeTo(pick, 'crumb', why, others, { autoClass: work })
    }
  }
  const bound = input.boundChat ? byId.get(input.boundChat) : undefined
  if (bound) {
    return routeTo(bound, 'thread', `This thread already went to ${quote(bound.title)}`, short, {
      autoClass:
        input.boundByChoice === true && !namesOther(bound.sessionId) ? 'thread-choice' : null
    })
  }
  const asking = input.chats.filter((chat) => chat.waitsOnAuthor.length > 0)
  if (asking.length === 1) {
    const [chat] = asking
    const asked = `We asked them: ${quote(chat.waitsOnAuthor[0])}`
    const autoClass = namesOther(chat.sessionId) ? null : 'question'
    return routeTo(chat, 'question', asked, short, { autoClass })
  }
  if (hits.length > 0) {
    // Why the worker over its Lead: the chat started for the task is the one doing it; an open one first.
    const sorted = [...hits].sort(
      (a, b) =>
        STATE_RANK[a.chat.state ?? 'open'] - STATE_RANK[b.chat.state ?? 'open'] ||
        Number(levelOf(a.chat) === 'lead') - Number(levelOf(b.chat) === 'lead') ||
        b.chat.lastActivityAt - a.chat.lastActivityAt
    )
    const { chat, ref } = sorted[0]
    const others = [
      ...sorted.slice(1).map((hit) => hit.chat),
      ...withLead(chat, input.chats),
      ...short
    ]
    const more = hits.length > 1 ? ` (${hits.length - 1} more chats name it)` : ''
    return routeTo(chat, 'ref', `${ref} is ${quote(chat.title)}'s work${more}`, others, {
      autoClass: hqRouterSingleLiveWork(hqRouterRefs(input.text), chat, hits) ? 'single-ref' : null
    })
  }
  const topics = hqRouterOpenTopics(input)
  if (topics.length === 1) {
    const [{ chat, topic }] = topics
    const said = topic.text
      ? ` — ${topic.source === 'waiting' ? 'we asked' : 'last'}: ${quote(topic.text)}`
      : ''
    return routeTo(
      chat,
      'topic',
      `${input.author}'s one open topic is ${quote(chat.title)}${said}`,
      short,
      { autoClass: 'topic' }
    )
  }
  return null
}

/**
 * Router v2 T2: the author's topics whose chat is on the list, one per chat, newest first. Read after the
 * breadcrumb and the bound thread, so a crumb that resolved to no open chat still finds its topic.
 */
export function hqRouterOpenTopics(
  input: HqRouterInput
): { chat: HqRouterChat; topic: HqRouterTopic }[] {
  if (!input.topics) {
    return []
  }
  const byId = new Map(input.chats.map((chat) => [chat.sessionId, chat]))
  const out: { chat: HqRouterChat; topic: HqRouterTopic }[] = []
  for (const topic of input.topics) {
    const chat = byId.get(topic.chat)
    if (chat && !out.some((hit) => hit.chat === chat)) {
      out.push({ chat, topic })
    }
  }
  return out
}

/**
 * The route of a 🆕 mark (owner 28.11): new work, so no chat is offered and the model is not asked
 * «new or existing» — only the project, which the card's guess fills in (none → the HQ workspace).
 * Sent by itself: the new chat starts without the owner's «Send».
 */
export function hqRouteNewMark(
  where: { repoId: string | null; project: string | null } | null = null
): HqRoute {
  return {
    target: HQ_ROUTER_NEW,
    targetTitle: null,
    repoId: where?.repoId ?? null,
    project: where?.project ?? null,
    level: 'new',
    how: 'new-mark',
    why: `🆕 new work — a new chat in ${where?.project ?? 'HQ'}`,
    auto: true,
    alternatives: [],
    confidence: null,
    model: null
  }
}
