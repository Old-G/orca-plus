// Custom build (router v2 T1, owner 28.11): the work an outgoing message binds to, offered on its
// Approve card as «Work: X». A work is a task's chain of chats (handoffs, Lead→Lead), named by its first
// chat. The sender's own work comes first; a one-off chat with no role and no parent has none, so the
// router suggests one — the work this thread is bound to, else the open chat the text names a task, MR
// or branch of. The owner's Approve confirms it, a pick on the card rebinds it, and the message's footer
// carries its id (`w 1a2b3c4d`), so an answer finds the work's chat now, or its Lead once it closed.
import { hqRouterRefMatches, type HqRouterChat } from '../../../shared/hq-router'
import { readInputString } from '../../../shared/outgoing-approval/outgoing-action'
import type { PulseDraft } from '../../../shared/pulse-types'

/** Why 5: the sender's, the router's guess and a few open Leads — more is a list, not a choice. */
const WORK_CHOICES_MAX = 5
const LEADS_OFFERED = 2

export type OutgoingWorkSources = {
  /** The work the chat writes for; `known` false for a one-off chat with no role and no parent. */
  senderWork: (sessionId: string) => { work: string; known: boolean }
  /** The work a Slack thread of ours is bound to. */
  threadWork: (channel: string, threadTs: string) => string | null
  /** Open chats, as the router reads them. */
  chats: () => readonly HqRouterChat[]
  /** The work a chat is part of. */
  workOfChat: (sessionId: string) => string
  /** The chat carrying a work now. */
  liveChat: (work: string) => string
  /** A chat's name; null when Orca+ has none. */
  title: (sessionId: string) => string | null
}

export type OutgoingWork = { id: string; title: string; why: string }

export type OutgoingWorkPlan = {
  current: string
  suggested: boolean
  choices: OutgoingWork[]
}

/** The works the card offers for a held call; null when it has no sending chat. */
export function outgoingWorkPlan(
  draft: PulseDraft,
  sources: OutgoingWorkSources
): OutgoingWorkPlan | null {
  const sender = draft.call?.agentSessionId
  if (!sender) {
    return null
  }
  const own = sources.senderWork(sender)
  const chats = sources.chats()
  const offered: OutgoingWork[] = []
  const offer = (work: string | null, why: string): void => {
    if (!work || offered.some((entry) => entry.id === work)) {
      return
    }
    const live = sources.liveChat(work)
    offered.push({ id: work, title: sources.title(live) ?? sources.title(work) ?? work, why })
  }
  const channel = /slack/i.test(draft.call?.service ?? '')
    ? draft.target?.split(',')[0]?.trim()
    : null
  const threadTs = readInputString(draft.call?.toolInput, 'thread_ts')
  const threadWork = channel && threadTs ? sources.threadWork(channel, threadTs) : null
  const refs = hqRouterRefMatches(draft.body ?? '', chats).map((hit) => ({
    work: sources.workOfChat(hit.chat.sessionId),
    ref: hit.ref
  }))
  if (own.known) {
    offer(own.work, 'this chat’s work')
  }
  offer(threadWork, 'this thread’s work')
  for (const hit of refs.slice(0, 2)) {
    offer(hit.work, `works on ${hit.ref}`)
  }
  if (!own.known) {
    offer(own.work, 'this chat on its own')
  }
  const leads = [...chats]
    .filter((chat) => chat.role === 'lead' || chat.role === 'sublead')
    .sort((a, b) => b.lastActivityAt - a.lastActivityAt)
    .slice(0, LEADS_OFFERED)
  for (const lead of leads) {
    offer(sources.workOfChat(lead.sessionId), 'an open Lead')
  }
  const choices = offered.slice(0, WORK_CHOICES_MAX)
  return { current: choices[0].id, suggested: !own.known && choices[0].id !== own.work, choices }
}

/** What the router's records answer for the card; `PulseDb['router']` fits. */
export type OutgoingWorkRouter = {
  senderWork: (sessionId: string) => { work: string; known: boolean }
  binding: (input: {
    channel: string
    threadTs: string | null
    linked: null
    at: number
  }) => { task: string } | null
  taskOf: (sessionId: string) => string
  liveChat: (work: string) => string
  leadOf: (sessionId: string) => string | null
}

/** The card's works, worked out once per held call so Approve binds to what the owner saw. */
export function createOutgoingWorkPlans(deps: {
  router: () => OutgoingWorkRouter
  chats: () => readonly HqRouterChat[]
  title: (sessionId: string) => string | null
}): {
  planOf: (draft: PulseDraft) => OutgoingWorkPlan | null
  leadName: (work: string) => string | null
  /** Forgets the cards no longer held. */
  keep: (live: ReadonlySet<string>) => void
} {
  const plans = new Map<string, OutgoingWorkPlan | null>()
  return {
    planOf: (draft) => {
      if (!plans.has(draft.id)) {
        const router = deps.router()
        let plan: OutgoingWorkPlan | null = null
        try {
          plan = outgoingWorkPlan(draft, {
            senderWork: (id) => router.senderWork(id),
            threadWork: (channel, threadTs) =>
              router.binding({ channel, threadTs, linked: null, at: Date.now() })?.task ?? null,
            chats: deps.chats,
            workOfChat: (id) => router.taskOf(id),
            liveChat: (work) => router.liveChat(work),
            title: deps.title
          })
        } catch (error) {
          console.warn('[outgoing-approval] work choices failed:', error)
        }
        plans.set(draft.id, plan)
      }
      return plans.get(draft.id) ?? null
    },
    leadName: (work) => {
      const router = deps.router()
      const chat = router.liveChat(work)
      const lead = router.leadOf(chat)
      return lead && lead !== chat ? deps.title(lead) : null
    },
    keep: (live) => {
      for (const id of plans.keys()) {
        if (!live.has(id)) {
          plans.delete(id)
        }
      }
    }
  }
}
