// Custom build (hq-router T4, owner 26.11): what «👾 Router» lists — every open Router card (a 👾 mark,
// a pasted link or text), newest first. A mention or a ledger conversation stays only in the feed.
import {
  HQ_INTAKE_KIND,
  hqIntakeIsRouterCard,
  readHqIntake,
  type HqIntake
} from '../../../../../shared/hq-slack-intake'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'

export type HqPlusRouterCard = { item: PulseInboxItem; intake: HqIntake }

/** An open Router card, or null. Why (T7 routes every To work card): only the router's own kind. */
export function hqPlusRouterCardOf(
  item: PulseInboxItem | null | undefined
): HqPlusRouterCard | null {
  if (!item || item.kind !== HQ_INTAKE_KIND || item.doneAt !== null) {
    return null
  }
  const intake = readHqIntake(item.refId)
  return intake && hqIntakeIsRouterCard(intake) ? { item, intake } : null
}

export function hqPlusRouterCards(items: readonly PulseInboxItem[]): HqPlusRouterCard[] {
  return items
    .flatMap((item) => hqPlusRouterCardOf(item) ?? [])
    .sort((a, b) => b.item.createdAt - a.item.createdAt)
}

/** «Send» goes straight to the router's pick; a new chat, or no pick, needs the owner's choice. */
export function hqPlusRouterSendsTo(intake: HqIntake): string | null {
  const target = intake.route?.target
  return target && target !== 'new' ? target : null
}

/** Where the chat sits, so a closed one can be reopened: the worktree whose tab holds the session. */
export function hqPlusWorktreeOfSession(
  tabsByWorktree: Readonly<
    Record<string, readonly { contentType?: string; entityId?: string | null }[] | undefined>
  >,
  sessionId: string
): string | null {
  for (const [worktreeId, tabs] of Object.entries(tabsByWorktree)) {
    if (tabs?.some((tab) => tab.contentType === 'agent-session' && tab.entityId === sessionId)) {
      return worktreeId
    }
  }
  return null
}

/** Custom build (hq-router T4, owner 26.11): where to reopen a done or closed chat for «Send» — its tab,
 *  else the worktree the router read it in; '' leaves it unopened. */
export function hqPlusRouterChatWorktree(
  tabsByWorktree: Parameters<typeof hqPlusWorktreeOfSession>[0],
  sessionId: string,
  known: string | null | undefined
): string {
  return hqPlusWorktreeOfSession(tabsByWorktree, sessionId) ?? known ?? ''
}
