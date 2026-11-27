// Custom build (hq-router T0, owner 28.11): what `orca hq router-stats` reports — per route class, how the
// cards that went to a chat ended. T4 reads these to decide which class may send by itself.
import type { HqRouterAutoStatus, HqRouterAutoThresholds } from './hq-router-auto'

export type RouterClassStats = {
  how: string
  /** Cards that went to a chat. */
  n: number
  /** Went to the chat the router offered first. */
  chatRight: number
  /** Went to a chat of the same task as the offered one (counts the chat hits too). */
  workRight: number
  /** Went to one of the first three offered. */
  top3: number
  skipped: number
  gone: number
  open: number
  /** The class's part of all cards that went to a chat. */
  share: number
}

export type HqRouterStats = {
  days: number
  classes: RouterClassStats[]
  /** Router v2 T4: each auto class — sends by itself, or gathers n of the thresholds' minN. */
  auto?: { thresholds: HqRouterAutoThresholds; classes: HqRouterAutoStatus[] }
}
