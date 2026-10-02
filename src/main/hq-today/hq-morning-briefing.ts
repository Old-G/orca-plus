// Custom build (hq-screen): once a day from 10:00 local time, a bell item that leads to HQ's Today
// tab — the briefing itself is live there, so no agent spends a run writing it.
import {
  HQ_BRIEFING_HOUR,
  HQ_BRIEFING_KIND,
  HQ_BRIEFING_OPEN_ACTION,
  hqLocalDay
} from '../../shared/hq-morning-briefing'
import type { PulseInboxInput, PulseInboxItem } from '../../shared/pulse-types'

const CHECK_INTERVAL_MS = 60_000

export type HqMorningBriefingDeps = {
  now: () => number
  /** Done items too, so a dismissed briefing is not raised again the same day. */
  listInbox: () => PulseInboxItem[]
  addInboxItem: (input: PulseInboxInput) => void
  markInboxDone: (id: string, action: string) => void
}

function dedupeKey(day: string): string {
  return `${HQ_BRIEFING_KIND}:${day}`
}

export function hqBriefingInput(day: string): PulseInboxInput {
  return {
    kind: HQ_BRIEFING_KIND,
    title: 'Morning briefing',
    body: 'Agents, waitings, ClickUp deadlines, reviews and limits for today — on HQ → Today.',
    actions: [{ id: HQ_BRIEFING_OPEN_ACTION, label: 'Open' }],
    dedupeKey: dedupeKey(day)
  }
}

/** Raises today's item once it is past the hour; returns the day it last raised or found. */
export function raiseHqMorningBriefing(
  deps: HqMorningBriefingDeps,
  lastDay: string | null
): string | null {
  const now = deps.now()
  const day = hqLocalDay(now)
  if (lastDay === day || new Date(now).getHours() < HQ_BRIEFING_HOUR) {
    return lastDay
  }
  const briefings = deps.listInbox().filter((item) => item.kind === HQ_BRIEFING_KIND)
  if (briefings.some((item) => item.dedupeKey === dedupeKey(day))) {
    return day
  }
  // Why: yesterday's briefing describes a day that is over.
  for (const item of briefings) {
    if (item.doneAt === null) {
      deps.markInboxDone(item.id, 'superseded')
    }
  }
  deps.addInboxItem(hqBriefingInput(day))
  return day
}

export function startHqMorningBriefing(deps: HqMorningBriefingDeps): () => void {
  let lastDay: string | null = null
  const check = (): void => {
    try {
      lastDay = raiseHqMorningBriefing(deps, lastDay)
    } catch (error) {
      console.warn('[hq-briefing] could not raise the morning briefing:', error)
    }
  }
  check()
  const timer = setInterval(check, CHECK_INTERVAL_MS)
  return () => clearInterval(timer)
}
