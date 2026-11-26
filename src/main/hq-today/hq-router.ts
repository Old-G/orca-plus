// Custom build (hq-router, plan router T1, owner 26.11): one route per 👾 (or pasted link) — the exact
// signals first (crumb, bound thread, task / MR / branch), else Jev's choice over eight open chats, the
// small Claude model when Jev has not answered in 3 s. Only a bound thread is sent by itself.
import {
  HQ_ROUTER_JEV_MODEL,
  HQ_ROUTER_JEV_TIMEOUT_MS,
  HQ_ROUTER_JEV_URL,
  hqRouteBySignals,
  hqRouterShortlist,
  type HqRoute,
  type HqRouterChat,
  type HqRouterInput
} from '../../shared/hq-router'
import {
  hqRouteByModel,
  hqRouterFallbackAnswer,
  hqRouterFallbackPrompt,
  hqRouterJevAnswer,
  hqRouterJevBody
} from '../../shared/hq-router-model'
import { parseHqCrumbs, type HqCrumbFooter, type HqRouterCrumb } from '../../shared/hq-router-crumb'
import { HQ_INTAKE_TEXT_MAX, HQ_ROUTER_TEXT_CHANNEL } from '../../shared/hq-slack-intake'
import { hqRouterPasteAuthor } from '../../shared/hq-router-paste'
import type { HqRouterCrumbLookup } from '../orca-plus/pulse/pulse-router'
import type { HqIntakeDraft } from './hq-slack-intake-suggest'

export const HQ_ROUTER_FALLBACK_MODEL = 'haiku'

export type HqRouterDeps = {
  chats: () => HqRouterChat[] | Promise<HqRouterChat[]>
  /** The task our message (or the owner's earlier choice) bound this thread to (variant b, 26.11). */
  binding?: (lookup: {
    channel: string
    threadTs: string | null
    linked: { channel: string; ts: string } | null
    at: number
  }) => { chat: string; source: 'approve' | 'choice' } | null
  crumb: (lookup: HqRouterCrumbLookup) => HqRouterCrumb | null
  boundChat: (conversationKey: string) => string | null
  leadOf?: (sessionId: string) => string | null
  history: (slackUserId: string) => string[]
  /** The thread's messages, oldest first, when the message is in one; read when routing. */
  thread?: (channel: string, threadTs: string) => Promise<string[] | null>
  /** Our open questions to this author, by the chat that asked. */
  waitsOn: (slackUserId: string) => Map<string, string[]>
  /** POSTs the Decisions API body; null when no key is set. */
  jev: ((body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown>) | null
  fallback: (prompt: string) => Promise<{ ok: true; text: string } | { ok: false; error: string }>
  /** Off: no crumb step (the owner's call on T1's measurement). */
  crumbs?: boolean
  timeoutMs?: number
  now: () => number
}

const SLACK_LINK = /\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})/

/** A link in the text to a Slack message, as channel and ts. */
export function hqRouterLinkedMessage(
  links: readonly string[]
): { channel: string; ts: string } | null {
  for (const link of links) {
    const match = SLACK_LINK.exec(link)
    if (match) {
      return { channel: match[1], ts: `${match[2]}.${match[3]}` }
    }
  }
  return null
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number
): Promise<T | null> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      controller.abort()
      resolve(null)
    }, ms)
  })
  try {
    return await Promise.race([run(controller.signal).catch(() => null), timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** The route for one message. Never throws: with nothing to go on, the card asks the owner. */
export async function routeHqIntake(draft: HqIntakeDraft, deps: HqRouterDeps): Promise<HqRoute> {
  const now = deps.now()
  const thread =
    draft.threadTs && deps.thread
      ? await deps.thread(draft.channel, draft.threadTs).catch(() => null)
      : null
  const footers: HqCrumbFooter[] = [
    ...parseHqCrumbs(draft.text),
    // Why the thread from its newest end: the person answers the latest of ours.
    ...(thread ?? []).toReversed().flatMap((text) => parseHqCrumbs(text))
  ]
  const linked = hqRouterLinkedMessage(draft.links)
  const binding =
    deps.binding?.({
      channel: draft.channel,
      threadTs: draft.threadTs ?? null,
      linked,
      at: draft.at
    }) ?? null
  const conversationKey = `slack:${draft.channel}:${draft.threadTs ?? draft.ts}`
  const crumb =
    deps.crumbs === false
      ? null
      : binding?.source === 'approve'
        ? { chat: binding.chat, lead: deps.leadOf?.(binding.chat) ?? null, chatTitle: null }
        : deps.crumb({
            footers,
            channel: draft.channel,
            threadTs: draft.threadTs && draft.threadTs !== draft.ts ? draft.threadTs : null,
            linked,
            at: draft.at
          })
  const waits = draft.authorSlackId ? deps.waitsOn(draft.authorSlackId) : new Map()
  const chats = (await deps.chats()).map((chat) => ({
    ...chat,
    waitsOnAuthor: waits.get(chat.sessionId) ?? chat.waitsOnAuthor
  }))
  const input: HqRouterInput = {
    text: thread && thread.length > 1 ? thread.join('\n').slice(-3_500) : draft.text,
    author: draft.author,
    venue:
      draft.channel === HQ_ROUTER_TEXT_CHANNEL
        ? 'text the owner pasted'
        : draft.venue === 'dm'
          ? 'Slack DM'
          : draft.venue === 'group'
            ? 'Slack group DM'
            : 'Slack channel',
    crumb,
    boundChat:
      (binding?.source === 'choice' ? binding.chat : null) ?? deps.boundChat(conversationKey),
    boundByChoice: binding?.source === 'choice',
    history: draft.authorSlackId ? deps.history(draft.authorSlackId) : [],
    chats,
    now
  }
  const bySignals = hqRouteBySignals(input)
  if (bySignals) {
    return bySignals
  }
  const short = hqRouterShortlist(input)
  if (short.length === 0) {
    return hqRouteByModel(input, short, null, HQ_ROUTER_JEV_MODEL)
  }
  const jev = deps.jev
  if (jev) {
    const response = await withTimeout(
      (signal) => jev(hqRouterJevBody(input, short), signal),
      deps.timeoutMs ?? HQ_ROUTER_JEV_TIMEOUT_MS
    )
    const answer = response ? hqRouterJevAnswer(response, short) : null
    if (answer) {
      return hqRouteByModel(input, short, answer, 'Jev')
    }
  }
  const generated = await deps
    .fallback(hqRouterFallbackPrompt(input, short))
    .catch((error: unknown) => ({ ok: false as const, error: String(error) }))
  const answer = generated.ok ? hqRouterFallbackAnswer(generated.text, short) : null
  return hqRouteByModel(input, short, answer, 'Haiku')
}

/** The Decisions API call with a key; a non-2xx answer is an error. */
export function hqRouterJevCall(
  key: string,
  fetcher: typeof fetch = fetch
): (body: Record<string, unknown>, signal: AbortSignal) => Promise<unknown> {
  return async (body, signal) => {
    const response = await fetcher(HQ_ROUTER_JEV_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Title': 'Orca+ router'
      },
      body: JSON.stringify(body),
      signal
    })
    if (!response.ok) {
      throw new Error(`Jev answered ${response.status}`)
    }
    return response.json()
  }
}

/** `OPENROUTER_API_KEY` from Orca+'s environment, else from the env file the settings name. */
export function hqRouterKey(
  env: Record<string, string | undefined>,
  keyFile: string | null | undefined,
  read: (path: string) => string | null
): string | null {
  const fromEnv = env.OPENROUTER_API_KEY?.trim()
  if (fromEnv) {
    return fromEnv
  }
  const text = keyFile ? read(keyFile) : null
  const line = text
    ?.split('\n')
    .map((entry) => entry.trim())
    .find((entry) => /^(export\s+)?OPENROUTER_API_KEY=/.test(entry))
  const value = line
    ?.replace(/^(export\s+)?OPENROUTER_API_KEY=/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2')
  return value || null
}

const MARK_LOG_SEEN_MAX = 2_000
const markLogSeen = new Set<string>()

/** One line in logs/hq-router.log per 👾 mark and outcome — a poll every half minute repeats none. */
export function hqRouterMarkLine(
  key: string,
  outcome: string,
  write: (line: string) => void,
  now: number,
  seen: Set<string> = markLogSeen
): void {
  const id = `${key} ${outcome}`
  if (seen.has(id)) {
    return
  }
  if (seen.size >= MARK_LOG_SEEN_MAX) {
    seen.clear()
  }
  seen.add(id)
  write(`${new Date(now).toISOString()} 👾 ${key} ${outcome}\n`)
}

/** A ts for pasted text: Slack's shape, unique even for two pastes in the same millisecond. */
export function hqRouterTextTs(now: number, seq: number): string {
  return `${Math.floor(now / 1000)}.${String(now % 1000).padStart(3, '0')}${String(seq % 1000).padStart(3, '0')}`
}

/** The draft for text pasted into the router: no Slack message, the author from «Name wrote:». */
export function hqRouterTextDraft(text: string, now: number, seq: number): HqIntakeDraft {
  return {
    channel: HQ_ROUTER_TEXT_CHANNEL,
    ts: hqRouterTextTs(now, seq),
    threadTs: null,
    author: hqRouterPasteAuthor(text) ?? 'Pasted text',
    authorSlackId: null,
    venue: 'channel',
    text: text.slice(0, HQ_INTAKE_TEXT_MAX),
    links: [...new Set(text.match(/https?:\/\/[^\s<>"')]+/g) ?? [])],
    files: [],
    permalink: null,
    at: now
  }
}
