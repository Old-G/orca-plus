// Custom build (hq-router auto classes, router v2 T4, owner 28.11): which routes a 👾 sends by itself.
// A route signal code can name exactly falls into a class; a class sends by itself only once the router
// log shows the owner agreed with it often enough (n and share right over the last days, all three in
// the settings). The model's confidence never counts: a model pick has no class. The 👾 is the owner's
// consent, so no content check (money, prod, instructions) stands between a class and its send.
// No runtime imports: the offline eval runs this file as it is.
import type { HqRouterChat } from './hq-router'

export const HQ_ROUTER_AUTO_CLASSES = [
  'thread-choice',
  'work-crumb',
  'single-ref',
  'topic',
  'question'
] as const

/**
 * thread-choice — a thread the owner's own «Send» bound; work-crumb — an answer in a thread our Approve
 * bound to a work (our record, not a footer anyone can paste), to that work's live chat; single-ref — the
 * one DEV / MR the text names is one live work's; topic — the author's one open topic (T2); question —
 * the one chat waiting on the author. A text naming another chat's task gives none of them.
 */
export type HqRouterAutoClass = (typeof HQ_ROUTER_AUTO_CLASSES)[number]

export function isHqRouterAutoClass(value: unknown): value is HqRouterAutoClass {
  return (HQ_ROUTER_AUTO_CLASSES as readonly unknown[]).includes(value)
}

export type HqRouterAutoThresholds = {
  /** Decided cards of the class in the window. */
  minN: number
  /** Share of them that went to the offered chat, 0..1. */
  minRight: number
  days: number
}

export const HQ_ROUTER_AUTO_DEFAULTS: HqRouterAutoThresholds = {
  minN: 30,
  minRight: 0.98,
  days: 30
}

/** The settings' thresholds, each one that is missing or out of range taken from the defaults. */
export function hqRouterAutoThresholds(
  raw: Partial<HqRouterAutoThresholds> | null | undefined
): HqRouterAutoThresholds {
  const pick = (value: unknown, ok: (n: number) => boolean, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) && ok(value) ? value : fallback
  return {
    minN: pick(raw?.minN, (n) => n >= 1, HQ_ROUTER_AUTO_DEFAULTS.minN),
    minRight: pick(raw?.minRight, (n) => n > 0 && n <= 1, HQ_ROUTER_AUTO_DEFAULTS.minRight),
    days: pick(raw?.days, (n) => n >= 1, HQ_ROUTER_AUTO_DEFAULTS.days)
  }
}

/** A class's record in the window: decided cards and how many went to the offered chat. */
export type HqRouterAutoRecord = { n: number; right: number }

export type HqRouterAutoStatus = {
  autoClass: HqRouterAutoClass
  n: number
  right: number
  /** True: the class sends by itself now. */
  auto: boolean
}

export function hqRouterAutoStatus(
  autoClass: HqRouterAutoClass,
  record: HqRouterAutoRecord | undefined,
  thresholds: HqRouterAutoThresholds
): HqRouterAutoStatus {
  const n = record?.n ?? 0
  const right = record?.right ?? 0
  // Why in basis points: right / n against 0.98 in floats can tip on a rounding error.
  const auto =
    n >= thresholds.minN && right * 10_000 >= Math.round(thresholds.minRight * 10_000) * n
  return { autoClass, n, right, auto }
}

/** Every class's status, in the fixed order. */
export function hqRouterAutoStatuses(
  records: ReadonlyMap<string, HqRouterAutoRecord>,
  thresholds: HqRouterAutoThresholds
): HqRouterAutoStatus[] {
  return HQ_ROUTER_AUTO_CLASSES.map((autoClass) =>
    hqRouterAutoStatus(autoClass, records.get(autoClass), thresholds)
  )
}

/**
 * single-ref: the text names one DEV or MR and only one live work carries it — the picked chat, or it and
 * its own Lead (closed chats aside). A branch name does not count: a path in the text reads like one.
 */
export function hqRouterSingleLiveWork(
  refs: { tasks: readonly string[]; mrs: readonly string[]; branches: readonly string[] },
  chat: HqRouterChat,
  hits: readonly { chat: HqRouterChat }[]
): boolean {
  const live = (other: HqRouterChat): boolean => (other.state ?? 'open') !== 'closed'
  if (refs.tasks.length + refs.mrs.length !== 1 || refs.branches.length > 0 || !live(chat)) {
    return false
  }
  return hits.every(
    (hit) => hit.chat === chat || hit.chat.sessionId === chat.leadId || !live(hit.chat)
  )
}
