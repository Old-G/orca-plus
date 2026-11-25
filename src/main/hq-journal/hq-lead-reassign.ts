// Custom build (hq-lead-reassign, owner 16.11): `orca hq reassign --from <Lead> [--to <chat>]` hands a
// Lead's chats to another chat. The chats hang under the new Lead in HQ+, what they send the old Lead
// goes to the new one, the plan's `Lead chat:` line names the new Lead, the new Lead gets the Lead role
// and the messages held for the old one, and the new Lead, the moved chats and the old Lead are told.
// A handoff needs none of this: the new chat keeps the Lead's thread address.
// T13 (25.11): `--from none --chats …` takes chats that have no Lead (ones the owner started) under the
// new Lead; `--to none` gives such a chat back to no Lead — the undo it prints.
import type { HqJournalInput, HqSession } from '../../shared/hq-journal'
import {
  HQ_REASSIGN_NO_LEAD,
  type HqChatLinksResult,
  type HqLeadReassignChat,
  type HqLeadReassignResult
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
  hqReassignRows
} from './hq-lead-reassign-notices'
import { hqReassignCheckAsked, hqReassignNoLeadSides } from './hq-lead-reassign-checks'

const MAX_HOPS = 64

export type HqLeadReassignDeps = {
  enabled: () => boolean
  scope: (caller: HqCaller) => Promise<HqCallerScope>
  pulse: {
    getSession: (sessionId: string) => HqSession | null
    listSessionsByAddress: (address: string) => HqSession[]
    /** Custom build (hq-handoff-parked, T7): the live end of a chat's handoff chain. */
    liveSessionOf?: (sessionId: string) => string
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
  /** Rewrites the `Lead chat:` lines naming `from` (in `only` of the plan files, when given);
   *  returns the plan files changed. */
  rewritePlans: (
    from: HqPlanLead,
    to: { address: string | null; sessionId: string },
    at: number,
    dryRun: boolean,
    only?: readonly string[]
  ) => Promise<string[]>
  now: () => number
}

export type HqLeadReassignRequest = {
  /** Absent or `none`: the chats in `chats` have no Lead. */
  from?: string
  /** Absent: the chat that runs the command. `none`: the chats have no Lead now (the undo of `--from none`). */
  to?: string
  /** Absent: every open chat under the old Lead. */
  chats?: readonly string[]
  /** Plan files (names in HQ/runs) whose Lead line moves even with `chats` — what an undo of a whole
   *  team's move gives back, so the plans the new Lead led before stay its own. */
  plans?: readonly string[]
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
  const newestOn = (key: string): string => {
    if (!key.includes('/')) {
      return key
    }
    const top = deps.pulse.listSessionsByAddress(key)[0]?.sessionId
    return top ? (deps.pulse.liveSessionOf?.(top) ?? top) : key
  }

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

  /** The old Lead's chats (with no old Lead, the asked chats that have none): which move, and which
   *  stay with why. */
  const sort = (
    from: Spot | null,
    to: Spot | null,
    asked: ReadonlySet<string> | null,
    live: Live
  ) => {
    const parentOf = parents()
    // Why: sorted, so a listing and a retry read the same.
    const children = from
      ? [...parentOf.entries()]
          .filter(([, up]) => up === from.key)
          .map(([key]) => key)
          .sort()
      : [...(asked ?? [])].sort()
    hqReassignCheckAsked({
      asked,
      from: from?.key ?? null,
      children,
      leadOf: (key) => parentOf.get(key)
    })
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
          : to && key === to.key
            ? 'it is the new Lead'
            : to && under(parentOf, to.key, key)
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
      const { fromNone, toNone } = hqReassignNoLeadSides(request)
      const toRef = toNone ? null : request.to?.trim() || scope.sessionId
      if (!toNone && !toRef) {
        throw new Error('Name the new Lead with --to <project>/<task>|<session id>.')
      }
      const live: Live = new Map((await deps.live()).map((chat) => [chat.sessionId, chat]))
      const from = fromNone ? null : locate(request.from ?? '', live)
      const to = toRef ? locate(toRef, live) : null
      if (from && to && from.key === to.key) {
        throw new Error(`${refOf(to)} is that Lead already.`)
      }
      const asked = request.chats?.length
        ? new Set(request.chats.map((ref) => locate(ref, live).key))
        : null
      const { moved, kept } = sort(from, to, asked, live)
      const whole = asked === null
      const only = !whole && request.plans?.length ? request.plans : null
      const at = deps.now()
      const fromLead: HqPlanLead | null = from
        ? {
            address: from.address,
            sessionIds: from.address
              ? deps.pulse.listSessionsByAddress(from.address).map((session) => session.sessionId)
              : [from.sessionId]
          }
        : null
      const rewrite = (dryRun: boolean): Promise<string[]> =>
        !fromLead || !to
          ? Promise.resolve([])
          : whole
            ? deps.rewritePlans(fromLead, to, at, dryRun)
            : only
              ? deps.rewritePlans(fromLead, to, at, dryRun, only)
              : Promise.resolve([])
      const result = (
        done: Partial<HqLeadReassignResult> & { told?: ReadonlyMap<string, boolean> }
      ): HqLeadReassignResult => ({
        dryRun: request.dryRun === true,
        from: from ? strip(from) : null,
        to: to ? strip(to) : null,
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
        return result({ plans: await rewrite(true) })
      }

      for (const chat of moved) {
        deps.chats.moveLead({
          chat: chat.key,
          sessionId: chat.sessionId,
          fromLead: from?.key ?? HQ_REASSIGN_NO_LEAD,
          toLead: to?.key ?? HQ_REASSIGN_NO_LEAD,
          toSessionId: to?.sessionId ?? '',
          at
        })
      }
      const toRole = to ? deps.pulse.roleOf(to.sessionId) : null
      if (to && toRole !== 'lead' && toRole !== 'sublead') {
        const role = from && deps.pulse.roleOf(from.sessionId) === 'sublead' ? 'sublead' : 'lead'
        deps.pulse.setRole({ sessionId: to.sessionId, role, at })
      }
      // Why: a team moved in part leaves the plan with the old Lead; the forward catches strays.
      const plans = await rewrite(false)
      await deps.leadBatch?.ready
      // Why: what the old Lead had not read yet came from the chats that moved — the whole team.
      const held = whole && from?.address ? (deps.leadBatch?.take(from.address) ?? null) : null
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
      const toldNewLead =
        to && notices.lead !== null
          ? await deps.deliver(to.sessionId, notices.lead).catch(() => false)
          : false
      if (held) {
        if (toldNewLead) {
          deps.leadBatch?.delivered(held)
        } else {
          deps.leadBatch?.restore(held)
        }
      }
      const toldOldLead =
        from && notices.oldLead !== null && isOpen(live.get(from.sessionId))
          ? await deps.deliver(from.sessionId, notices.oldLead).catch(() => false)
          : false

      const rows = hqReassignRows({
        from,
        to,
        moved,
        notices,
        sessionOf: (sessionId) => deps.pulse.getSession(sessionId),
        at
      })
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
