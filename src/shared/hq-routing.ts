// Custom build (hq-plus-routing): HQ's routing.yaml — «an event of this kind → this action», which
// Orca+ carries out by itself and notes in the journal. The first kind it acts on is the evening
// Codex review: serious findings open a fixing chat per project, the minor ones wait.
import type { HqReplyRouteAction, HqReplyRule } from './hq-reply-routing'

export const HQ_ROUTING_FILE = 'routing.yaml'

/** Journal kinds and sources the routing writes. */
export const HQ_ROUTING_KIND = {
  action: 'routing.action',
  settled: 'entry.settled'
} as const
export const HQ_ROUTING_SOURCE = 'hq-routing'

export const HQ_ROUTING_DO = ['open_session', 'collect'] as const
export type HqRoutingDo = (typeof HQ_ROUTING_DO)[number]

export type HqFindingRule = {
  /** Severity levels it covers: 0 for P0, 1 for P1… */
  sev: number[]
  /** Local time of day it acts from, as minutes after midnight; null acts at once. */
  atMinute: number | null
  do: HqRoutingDo
  /** Findings recorded before this moment are not its business (epoch ms); null takes all. */
  since: number | null
}

export type HqRouting = {
  findings: HqFindingRule[]
  /** Custom build (hq-plus-person-replies): what a person's answer does; null leaves every answer a card. */
  replies: HqReplyRule | null
  /** The share of the Claude limit that must stay free before a chat is started by itself. */
  minFreePercent: number
  /** What in the file was not understood; such a line acts on nothing. */
  problems: string[]
}

export const HQ_ROUTING_DEFAULT_MIN_FREE = 20

/** open a fixing chat · hand more to today's chat · ask the owner (level 0) · wait (limit, retry) */
export type HqRouteActionKind = 'open' | 'continue' | 'suggest' | 'wait'

export type HqRouteAction = {
  kind: HqRouteActionKind
  project: string
  workspace: string
  /** Journal ids of the findings it covers. */
  findings: string[]
  level: number | null
  address: string | null
  sessionId: string | null
  /** Why it waits, or what went wrong carrying it out. */
  note: string | null
}

/** Custom build (hq-fix-now-all): a finding «Fix now» left alone — a chat already has it. */
export type HqRouteHandled = {
  project: string
  title: string
  /** The thread that took it. */
  address: string | null
  /** The commit it was closed with, when the chat named one. */
  commit: string | null
}

export type HqRouteResult = {
  dryRun: boolean
  actions: HqRouteAction[]
  /** Custom build (hq-fix-now-all): with a report given, its findings some chat already took. */
  handled?: HqRouteHandled[]
  /** Custom build (hq-plus-person-replies): answers passed on, or left for the owner, and why. */
  replies?: HqReplyRouteAction[]
  problems: string[]
}

export type HqSettleResult = { settled: boolean; entryId: string; status: 'done' | 'dropped' }

/** Custom build (hq-fix-now-all): `hq.mergeSlot` — the slot taken, refused (held by someone else) or given back. */
export type HqMergeSlotResult =
  | { project: string; action: 'status'; slot: { holder: string; since: number } | null }
  | { project: string; action: 'take'; holder: string; ok: true }
  | { project: string; action: 'take'; holder: string; ok: false; since: number }
  | { project: string; action: 'release'; holder: string; ok: boolean }
