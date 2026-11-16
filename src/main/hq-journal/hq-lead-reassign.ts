// Custom build (hq-lead-reassign, owner 16.11): `orca hq reassign --from <Lead> [--to <chat>]` hands a
// Lead's chats to another chat. The chats hang under the new Lead in HQ+, what they send the old Lead
// goes to the new one, the plan's `Lead chat:` line names the new Lead, the new Lead gets the Lead role
// and the messages held for the old one, and the new Lead, the moved chats and the old Lead are told.
// A handoff needs none of this: the new chat keeps the Lead's thread address.
import type { HqJournalInput, HqSession } from '../../shared/hq-journal'
import type {
  HqChatLinksResult,
  HqLeadReassignChat,
  HqLeadReassignResult
} from '../../shared/hq-chat-links'
import type { HqChatRole } from '../../shared/hq-chat-role'
import type { HqLiveSession } from '../../shared/hq-sessions'
import type { HqLeadMoveInput } from '../orca-plus/pulse/pulse-chat-lead-moves'
import type { HqCaller, HqCallerScope } from './hq-journal-rooms'
import type { HqLeadBatch } from './hq-lead-batch'
import type { HqPlanLead } from './hq-lead-plan-line'
import {
  hqReassignNotices,
  hqReassignRef as refOf,
  hqReassignRow
} from './hq-lead-reassign-notices'

const MAX_HOPS = 64

export type HqLeadReassignDeps = {
  enabled: () => boolean
  scope: (caller: HqCaller) => Promise<HqCallerScope>
  pulse: {
    getSession: (sessionId: string) => HqSession | null
    listSessionsByAddress: (address: string) => HqSession[]
    record: (inputs: HqJournalInput[]) => unknown
    roleOf: (sessionId: string) => HqChatRole | null
    setRole: (input: { sessionId: string; role: HqChatRole; at: number }) => void
  }
  chats: {
    links: () => HqChatLinksResult
    moveLead: (input: HqLeadMoveInput) => void
  }
  /** The chats now; `tabOpen` tells an open chat from one in History. */
  live: () => Promise<HqLiveSession[]>
  /** True once the chat took the prompt, sent or queued. */
  deliver: (sessionId: string, prompt: string) => Promise<boolean>
  leadBatch?: HqLeadBatch
  /** Rewrites the `Lead chat:` lines naming `from`; returns the plan files changed. */
  rewritePlans: (
    from: HqPlanLead,
    to: { address: string | null; sessionId: string },
    at: number,
    dryRun: boolean
  ) => Promise<string[]>
  now: () => number
}

export type HqLeadReassignRequest = {
  from: string
  /** Absent: the chat that runs the command. */
  to?: string
  /** Absent: every open chat under the old Lead. */
  chats?: readonly string[]
  dryRun?: boolean
}

export type HqLeadReassign = {
  reassign: (caller: HqCaller, request: HqLeadReassignRequest) => Promise<HqLeadReassignResult>
}

/** A chat and its key — its thread address, else its session id: what a handoff keeps. */
type Spot = HqLeadReassignChat & { key: string }
type Live = ReadonlyMap<string, HqLiveSession>

function strip(chat: HqLeadReassignChat): HqLeadReassignChat {
  return { address: chat.address, sessionId: chat.sessionId, name: chat.name }
}

function isOpen(chat: HqLiveSession | undefined): boolean {
  return chat !== undefined && chat.tabOpen && chat.state !== 'closed'
}

function under(parentOf: ReadonlyMap<string, string>, key: string, above: string): boolean {
  let current: string | undefined = key
  for (let hop = 0; current && hop < MAX_HOPS; hop += 1) {
    if (current === above) {
      return true
    }
    current = parentOf.get(current)
  }
  return false
}

export function createHqLeadReassign(deps: HqLeadReassignDeps): HqLeadReassign {
  const keyOf = (sessionId: string): string =>
    deps.pulse.getSession(sessionId)?.address ?? sessionId
  const newestOn = (key: string): string =>
    key.includes('/') ? (deps.pulse.listSessionsByAddress(key)[0]?.sessionId ?? key) : key

  /** The chat a ref names: a thread's newest chat, or a session (its thread's newest when it has one). */
  const locate = (ref: string, live: Live): Spot => {
    const wanted = ref.trim()
    const byAddress = wanted.includes('/')
    const address = byAddress ? wanted : (deps.pulse.getSession(wanted)?.address ?? null)
    const sessionId = address ? newestOn(address) : wanted
    if (byAddress && sessionId === wanted) {
      throw new Error(`No chat works on ${wanted}; \`orca hq sessions --json\` lists the chats.`)
    }
    if (!address && !live.has(sessionId)) {
      throw new Error(`No chat ${wanted}; \`orca hq sessions --json\` lists the chats.`)
    }
    return {
      key: address ?? sessionId,
      address,
      sessionId,
      name: live.get(sessionId)?.name ?? null
    }
  }

  /** Each chat line's parent line, by key; the earliest fact wins, as in HQ+'s tree. */
  const parents = (): Map<string, string> => {
    const parentOf = new Map<string, string>()
    for (const link of [...deps.chats.links().links].sort((a, b) => a.at - b.at)) {
      const child = keyOf(link.sessionId)
      const parent = keyOf(link.parentSessionId)
      if (child !== parent && !parentOf.has(child)) {
        parentOf.set(child, parent)
      }
    }
    return parentOf
  }

  /** The old Lead's chats: which move, and which stay with why. */
  const sort = (from: Spot, to: Spot, asked: ReadonlySet<string> | null, live: Live) => {
    const parentOf = parents()
    // Why: sorted, so a listing and a retry read the same.
    const children = [...parentOf.entries()]
      .filter(([, up]) => up === from.key)
      .map(([key]) => key)
      .sort()
    for (const key of asked ?? []) {
      if (!children.includes(key)) {
        throw new Error(
          `${key} is not a chat of ${refOf(from)}; \`orca hq reassign --dry-run\` lists them.`
        )
      }
    }
    const moved: (Spot & { open: boolean })[] = []
    const kept: HqLeadReassignResult['kept'] = []
    for (const key of children) {
      const sessionId = newestOn(key)
      const chat = live.get(sessionId)
      const spot = {
        key,
        address: key.includes('/') ? key : null,
        sessionId,
        name: chat?.name ?? null
      }
      const why =
        asked && !asked.has(key)
          ? 'not asked for'
          : key === to.key
            ? 'it is the new Lead'
            : under(parentOf, to.key, key)
              ? 'the new Lead works under it'
              : !isOpen(chat) && !asked
                ? 'closed'
                : null
      if (why) {
        kept.push({ ...strip(spot), why })
      } else {
        moved.push({ ...spot, open: isOpen(chat) })
      }
    }
    return { moved, kept }
  }

  return {
    async reassign(caller, request) {
      if (!deps.enabled()) {
        throw new Error('The HQ+ journal is off (Settings → Workspace → HQ+ journal).')
      }
      const scope = await deps.scope(caller)
      const toRef = request.to?.trim() || scope.sessionId
      if (!toRef) {
        throw new Error('Name the new Lead with --to <project>/<task>|<session id>.')
      }
      const live: Live = new Map((await deps.live()).map((chat) => [chat.sessionId, chat]))
      const from = locate(request.from, live)
      const to = locate(toRef, live)
      if (from.key === to.key) {
        throw new Error(`${refOf(to)} is that Lead already.`)
      }
      const asked = request.chats?.length
        ? new Set(request.chats.map((ref) => locate(ref, live).key))
        : null
      const { moved, kept } = sort(from, to, asked, live)
      const whole = asked === null
      const at = deps.now()
      const fromLead: HqPlanLead = {
        address: from.address,
        sessionIds: from.address
          ? deps.pulse.listSessionsByAddress(from.address).map((session) => session.sessionId)
          : [from.sessionId]
      }
      const result = (
        done: Partial<HqLeadReassignResult> & { told?: ReadonlyMap<string, boolean> }
      ) => ({
        dryRun: request.dryRun === true,
        from: strip(from),
        to: strip(to),
        moved: moved.map((chat) => ({
          ...strip(chat),
          told: done.told?.get(chat.sessionId) ?? false
        })),
        kept,
        plans: done.plans ?? [],
        heldHandedOver: done.heldHandedOver ?? 0,
        toldNewLead: done.toldNewLead ?? false,
        toldOldLead: done.toldOldLead ?? false
      })
      if (moved.length === 0) {
        return result({})
      }
      if (request.dryRun) {
        return result({ plans: whole ? await deps.rewritePlans(fromLead, to, at, true) : [] })
      }

      for (const chat of moved) {
        deps.chats.moveLead({
          chat: chat.key,
          sessionId: chat.sessionId,
          fromLead: from.key,
          toLead: to.key,
          toSessionId: to.sessionId,
          at
        })
      }
      const toRole = deps.pulse.roleOf(to.sessionId)
      if (toRole !== 'lead' && toRole !== 'sublead') {
        const role = deps.pulse.roleOf(from.sessionId) === 'sublead' ? 'sublead' : 'lead'
        deps.pulse.setRole({ sessionId: to.sessionId, role, at })
      }
      // Why: a team moved in part leaves the plan with the old Lead; the forward catches strays.
      const plans = whole ? await deps.rewritePlans(fromLead, to, at, false) : []
      await deps.leadBatch?.ready
      // Why: what the old Lead had not read yet came from the chats that moved — the whole team.
      const held = whole && from.address ? (deps.leadBatch?.take(from.address) ?? null) : null
      const by = scope.sessionId ? keyOf(scope.sessionId) : 'the owner'
      const notices = hqReassignNotices({ from, to, moved, by, plans, whole, held })

      const told = new Map<string, boolean>()
      for (const chat of moved) {
        // Why: a chat in History learns it from the plan and the forward; a notice would reopen it.
        const ok = chat.open
          ? await deps.deliver(chat.sessionId, notices.chat).catch(() => false)
          : false
        told.set(chat.sessionId, ok)
      }
      const toldNewLead = await deps.deliver(to.sessionId, notices.lead).catch(() => false)
      if (held) {
        if (toldNewLead) {
          deps.leadBatch?.delivered(held)
        } else {
          deps.leadBatch?.restore(held)
        }
      }
      const toldOldLead = isOpen(live.get(from.sessionId))
        ? await deps.deliver(from.sessionId, notices.oldLead).catch(() => false)
        : false

      const rowOf = (chat: HqLeadReassignChat, title: string, body: string) =>
        hqReassignRow(deps.pulse.getSession(chat.sessionId), chat, { title, body }, at)
      const rows = [
        rowOf(
          to,
          `Lead change: took over ${moved.length} chat(s) from ${refOf(from)}`,
          notices.lead
        ),
        rowOf(from, `Lead change: ${moved.length} chat(s) went to ${refOf(to)}`, notices.oldLead),
        ...moved.map((chat) =>
          rowOf(
            chat,
            `Lead change: ${refOf(to)} leads this chat now, not ${refOf(from)}`,
            notices.chat
          )
        )
      ].filter((entry): entry is HqJournalInput => entry !== null)
      if (rows.length > 0) {
        deps.pulse.record(rows)
      }
      return result({
        plans,
        told,
        heldHandedOver: held && toldNewLead ? held.prompts.length : 0,
        toldNewLead,
        toldOldLead
      })
    }
  }
}

let provided: HqLeadReassign | null = null

export function provideHqLeadReassign(service: HqLeadReassign | null): void {
  provided = service
}

export function getHqLeadReassign(): HqLeadReassign | null {
  return provided
}
