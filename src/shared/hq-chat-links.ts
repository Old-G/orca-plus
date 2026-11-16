// Custom build (hq-plus-chat-tree, owner 04.11): which chat started which — the facts HQ+'s «By work»
// tree is drawn from. A link is written when a chat runs `orca agent launch` or `orca chat send`; a
// handoff is the same chat going on, so it is a continuation, never a child.

export const HQ_CHAT_LINK_VIA = ['launch', 'send'] as const
export type HqChatLinkVia = (typeof HQ_CHAT_LINK_VIA)[number]

/** `sessionId` was started, or handed work, by `parentSessionId`. */
export type HqChatLink = {
  sessionId: string
  parentSessionId: string
  via: HqChatLinkVia
  at: number
}

/** `sessionId` continues `fromSessionId` after a handoff. */
export type HqChatContinuation = { sessionId: string; fromSessionId: string }

export type HqChatLinksResult = {
  links: HqChatLink[]
  continues: HqChatContinuation[]
}

export function isHqChatLinksResult(value: unknown): value is HqChatLinksResult {
  if (!value || typeof value !== 'object') {
    return false
  }
  const links = Reflect.get(value, 'links')
  const continues = Reflect.get(value, 'continues')
  return (
    Array.isArray(links) &&
    Array.isArray(continues) &&
    links.every(
      (link) =>
        link &&
        typeof link.sessionId === 'string' &&
        typeof link.parentSessionId === 'string' &&
        HQ_CHAT_LINK_VIA.includes(link.via)
    ) &&
    continues.every(
      (step) => step && typeof step.sessionId === 'string' && typeof step.fromSessionId === 'string'
    )
  )
}

// Custom build (hq-lead-reassign, owner 16.11): `orca hq reassign` — a Lead's chats go to another Lead.

/** A chat as `orca hq reassign` names it: its thread address when it has one, and its session now. */
export type HqLeadReassignChat = {
  address: string | null
  sessionId: string
  name: string | null
}

export type HqLeadReassignResult = {
  dryRun: boolean
  from: HqLeadReassignChat
  to: HqLeadReassignChat
  /** Moved under the new Lead (or, in a dry run, would be); `told` — the chat got the notice. */
  moved: (HqLeadReassignChat & { told: boolean })[]
  /** Under the old Lead and left there, with why. */
  kept: (HqLeadReassignChat & { why: string })[]
  /** Plan files whose `Lead chat:` line now names the new Lead. */
  plans: string[]
  /** Messages held for the old Lead that went to the new one with its notice. */
  heldHandedOver: number
  toldNewLead: boolean
  toldOldLead: boolean
}
