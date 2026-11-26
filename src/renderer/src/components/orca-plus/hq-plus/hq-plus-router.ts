// Custom build (hq-router T4, owner 26.11): what «👾 Router» lists — every open «To work» card the router
// routed (a 👾 mark, a pasted link or text), newest first. A card the router did not route (a mention, a
// ledger conversation) stays only in the feed.
import {
  HQ_INTAKE_KIND,
  HQ_ROUTER_KEY_PREFIX,
  readHqIntake,
  type HqIntake
} from '../../../../../shared/hq-slack-intake'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'

export type HqPlusRouterCard = { item: PulseInboxItem; intake: HqIntake }

export function hqPlusRouterCards(items: readonly PulseInboxItem[]): HqPlusRouterCard[] {
  return items
    .flatMap((item) => {
      if (item.kind !== HQ_INTAKE_KIND || item.doneAt !== null) {
        return []
      }
      const intake = readHqIntake(item.refId)
      const routed =
        !!intake &&
        (!!intake.route || (!!item.dedupeKey?.startsWith(HQ_ROUTER_KEY_PREFIX) && !!intake.pasted))
      return intake && routed ? [{ item, intake }] : []
    })
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
