// Custom build (hq-history): HQ's History — the agent chats that finished over the last week, one
// row per chat, read from the bell's agent-finished log, which keeps chats whose tab was closed.
import { z } from 'zod'
import { PULSE_BELL_KIND, readPulseBellPaneRef } from './pulse-bell'
import type { PulseInboxItem } from './pulse-types'

export const HQ_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

const STRUCTURED_TAB_PREFIX = 'structured-agent-session-'
const DAY_MS = 24 * 60 * 60 * 1000

export type HqHistoryEntry = {
  key: string
  paneKey: string
  worktreeId: string | null
  tabId: string | null
  /** A native chat's session, which can be reopened after its tab closed. */
  sessionId: string | null
  /** The latest finish. */
  finishedAt: number
  finishes: number
  agent: string | null
  place: string | null
  title: string | null
  lastMessage: string | null
}

export type HqHistoryDay = { dayStart: number; entries: HqHistoryEntry[] }

type Details = Pick<HqHistoryEntry, 'agent' | 'place' | 'title' | 'lastMessage'>

export type HqHistorySource = Pick<PulseInboxItem, 'kind' | 'body' | 'refId' | 'createdAt'>

const HqHistorySourceSchema = z.object({
  kind: z.string(),
  body: z.string().nullable(),
  refId: z.string().nullable(),
  createdAt: z.number()
})

/** `pulse.listInbox`'s reply as History reads it; an entry shaped otherwise is dropped. */
export function readHqHistorySource(raw: unknown): HqHistorySource[] {
  return Array.isArray(raw)
    ? raw.flatMap((entry) => {
        const parsed = HqHistorySourceSchema.safeParse(entry)
        return parsed.success ? [parsed.data] : []
      })
    : []
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** An item written before the fields were stored apart: «agent · place · title — said». */
function detailsFromBody(body: string | null): Details {
  const dash = body?.indexOf(' — ') ?? -1
  const who = body && dash >= 0 ? body.slice(0, dash) : (body ?? '')
  const said = body && dash >= 0 ? body.slice(dash + 3) : null
  const parts = who.split(' · ').map((part) => part.trim())
  const [agent = null, second = null, ...rest] = parts
  const place = rest.length > 0 || second?.includes(' / ') ? second : null
  const title = rest.length > 0 ? rest.join(' · ') : place === null ? second : null
  return { agent: text(agent), place: text(place), title: text(title), lastMessage: text(said) }
}

function details(item: HqHistorySource): Details {
  try {
    const parsed: unknown = item.refId ? JSON.parse(item.refId) : null
    if (parsed && typeof parsed === 'object' && Reflect.has(parsed, 'agent')) {
      return {
        agent: text(Reflect.get(parsed, 'agent')),
        place: text(Reflect.get(parsed, 'place')),
        title: text(Reflect.get(parsed, 'title')),
        lastMessage: text(Reflect.get(parsed, 'said'))
      }
    }
  } catch {
    // Unreadable ref: the body still names the chat.
  }
  return detailsFromBody(item.body)
}

/** One row per chat, newest finish first; finishes older than the window are left out. */
export function buildHqChatHistory(
  items: readonly HqHistorySource[],
  now: number
): HqHistoryEntry[] {
  const since = now - HQ_HISTORY_WINDOW_MS
  const byChat = new Map<string, HqHistoryEntry>()
  for (const item of items) {
    const ref =
      item.kind === PULSE_BELL_KIND.agentFinished ? readPulseBellPaneRef(item.refId) : null
    if (!ref || item.createdAt < since) {
      continue
    }
    const key = ref.worktreeId && ref.tabId ? `${ref.worktreeId}\u0000${ref.tabId}` : ref.paneKey
    const known = byChat.get(key)
    if (known) {
      known.finishes += 1
      if (item.createdAt <= known.finishedAt) {
        continue
      }
    }
    const sessionId = ref.tabId?.startsWith(STRUCTURED_TAB_PREFIX)
      ? ref.tabId.slice(STRUCTURED_TAB_PREFIX.length)
      : null
    byChat.set(key, {
      key,
      paneKey: ref.paneKey,
      worktreeId: ref.worktreeId,
      tabId: ref.tabId,
      sessionId,
      finishedAt: item.createdAt,
      finishes: known?.finishes ?? 1,
      ...details(item)
    })
  }
  return [...byChat.values()].sort((a, b) => b.finishedAt - a.finishedAt)
}

function startOfDay(at: number): number {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** Days in local time, newest first; entries keep their order. */
export function groupHqChatHistoryByDay(entries: readonly HqHistoryEntry[]): HqHistoryDay[] {
  const days: HqHistoryDay[] = []
  for (const entry of entries) {
    const dayStart = startOfDay(entry.finishedAt)
    const last = days.at(-1)
    if (last?.dayStart === dayStart) {
      last.entries.push(entry)
    } else {
      days.push({ dayStart, entries: [entry] })
    }
  }
  return days
}

/** 0 for today, 1 for yesterday, and so on, by local calendar days. */
export function hqHistoryDaysAgo(dayStart: number, now: number): number {
  return Math.round((startOfDay(now) - dayStart) / DAY_MS)
}
