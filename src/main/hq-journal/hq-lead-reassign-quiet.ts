// Custom build (hq-task-lock, D1 28.11): which chats `orca hq reassign` moves without a notice. A notice
// reopens a closed chat, and it is an empty launch's first prompt (398e3060, 28.11, woke a closed empty
// A3 launch). Chats asked for by name (`--chats`, `--from none`) are meant; a team's chat that holds no
// plan row (A3's lock) is not.
import type { HqLiveSession } from '../../shared/hq-sessions'

export type HqReassignQuiet = 'closed' | 'no plan row'

/** An open chat: its tab is open and it is not closed (a closed one lives in History). */
export function hqReassignIsOpen(chat: HqLiveSession | undefined): boolean {
  return chat !== undefined && chat.tabOpen && chat.state !== 'closed'
}

/** The live chats on a plan row — each row holder followed through its handoffs; null when not known.
 *  Custom build (hq-dispatcher-cleanup, A5): the sweep's cleanup closes no chat in it. */
export function hqOnPlanRowNow(
  rowHolders: (() => readonly string[]) | undefined,
  liveSessionOf: ((sessionId: string) => string) | undefined
): Set<string> | null {
  if (!rowHolders) {
    return null
  }
  try {
    return new Set(rowHolders().map((id) => liveSessionOf?.(id) ?? id))
  } catch {
    // Why: an unreadable lock table tells as before rather than stopping a Lead's handover.
    return null
  }
}

/** Why a moved chat gets no notice, or null to tell it. Row holders are read once per reassign; with
 *  none known (an older host, an unreadable table) every open chat is told, as before D1. */
export function hqReassignQuietOf(
  rowHolders: (() => readonly string[]) | undefined,
  liveSessionOf: ((sessionId: string) => string) | undefined
): (chat: { open: boolean; asked: boolean; sessionId: string }) => HqReassignQuiet | null {
  const onRow = hqOnPlanRowNow(rowHolders, liveSessionOf)
  return ({ open, asked, sessionId }) =>
    !open ? 'closed' : !asked && onRow && !onRow.has(sessionId) ? 'no plan row' : null
}
