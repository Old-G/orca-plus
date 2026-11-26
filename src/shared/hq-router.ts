// Custom build (hq-router, plan router T1, owner 26.11): where a message the owner marked with 👾 (or
// pasted as a link) goes, and why — exact signals in code first (a footer breadcrumb, a thread already
// bound to a chat, a task / MR / branch the message names), then one model choice over eight open
// chats. The card says why in words the code writes, never the model. In the trial only a bound thread
// is sent without the owner's «Send». No runtime imports: the offline eval runs this file as it is.
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

export type HqRouterInput = {
  text: string
  author: string
  venue: string
  /** The chat a breadcrumb in the message (or the one it answers) resolves to. */
  crumb: HqRouterCrumb | null
  /** The chat this thread was already sent to; its live successor. */
  boundChat: string | null
  /** The owner's own «Send» bound the thread (router_bindings 'choice'): the one route sent by itself.
   *  A chat that only posted in the thread or was guessed to work on it is a hint, never auto. */
  boundByChoice?: boolean
  /** Chats the owner sent this author's messages to before, newest first. */
  history: readonly string[]
  chats: readonly HqRouterChat[]
  now: number
}

export type HqRouteHow = 'crumb' | 'thread' | 'question' | 'ref' | 'model' | 'fallback' | 'none'
export type HqRouteLevel = 'worker' | 'lead' | 'new'

export type HqRoute = {
  /** A session id, or `new`. */
  target: string
  targetTitle: string | null
  repoId: string | null
  project: string | null
  level: HqRouteLevel
  how: HqRouteHow
  /** Code-written, for the card: what the choice rests on. */
  why: string
  /** Sent without the owner's «Send» — only a bound thread in the trial. */
  auto: boolean
  /** Two other open chats, best first (a «new» pick always shows them). */
  alternatives: { sessionId: string; title: string; repoId: string | null }[]
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
    project: chat.project,
    level: levelOf(chat),
    how,
    why,
    auto: false,
    alternatives: hqRouterByState(others)
      .filter((other) => other.sessionId !== chat.sessionId)
      .slice(0, 2)
      .map((other) => ({ sessionId: other.sessionId, title: other.title, repoId: other.repoId })),
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
 * The exact signals, strongest first; null when none fits and the model chooses. A bound thread is
 * the one route sent without the owner's «Send».
 */
export function hqRouteBySignals(input: HqRouterInput): HqRoute | null {
  const byId = new Map(input.chats.map((chat) => [chat.sessionId, chat]))
  const short = hqRouterShortlist(input)
  if (input.crumb) {
    const chat = input.crumb.chat ? byId.get(input.crumb.chat) : undefined
    const lead = input.crumb.lead ? byId.get(input.crumb.lead) : undefined
    const pick = chat ?? lead
    if (pick) {
      const others = [...(chat && lead ? [lead] : []), ...short]
      const why =
        chat || !input.crumb.chatTitle
          ? `Breadcrumb: ${quote(pick.title)} sent the message they answer`
          : `Breadcrumb: ${quote(input.crumb.chatTitle)} is closed; its Lead ${quote(pick.title)}`
      return routeTo(pick, 'crumb', why, others)
    }
  }
  const bound = input.boundChat ? byId.get(input.boundChat) : undefined
  if (bound) {
    // Why: a reply naming another task's ref is a hint the thread moved on — he confirms it by hand.
    const namesOther = hqRouterRefMatches(input.text, input.chats).some(
      (hit) => hit.chat.sessionId !== bound.sessionId
    )
    return routeTo(bound, 'thread', `This thread already went to ${quote(bound.title)}`, short, {
      auto: input.boundByChoice === true && !namesOther
    })
  }
  const asking = input.chats.filter((chat) => chat.waitsOnAuthor.length > 0)
  if (asking.length === 1) {
    const [chat] = asking
    return routeTo(chat, 'question', `We asked them: ${quote(chat.waitsOnAuthor[0])}`, short)
  }
  const hits = hqRouterRefMatches(input.text, input.chats)
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
    return routeTo(chat, 'ref', `${ref} is ${quote(chat.title)}'s work${more}`, others)
  }
  return null
}
