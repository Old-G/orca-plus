import { defineMethod } from '../core'
import {
  ChatSendParams,
  HqContextParams,
  HqDispatchParams,
  HqEventsParams,
  HqFeedParams,
  HqMergeSlotParams,
  HqReportParams,
  HqRouteParams,
  HqSessionsParams,
  HqSettleParams,
  HqStepParams,
  HqThreadParams,
  HqWhereParams,
  HqWhoamiParams,
  HqWorkspaceAddParams
} from '../../../../shared/rpc-contract/hq-journal-params'
import { HQ_JOURNAL_MAX_LIMIT } from '../../../../shared/hq-journal'
import {
  HQ_FEED_DEFAULT_LIMIT,
  HQ_PLUS_FEED_WINDOW_MS,
  type HqPlusScreenStats
} from '../../../../shared/hq-plus-screen'
import { HQ_PLUS_WORK_KINDS, hqPlusLaneSlotMs } from '../../../../shared/hq-plus-river-graph'
import { HQ_PLUS_CARD_KINDS, isHqPlusOwnerMessage } from '../../../../shared/hq-plus-log'
import { getHqThreads, type HqThreads } from '../../../hq-journal/hq-journal-threads'
import { getHqJournalService, type HqJournalService } from '../../../hq-journal/hq-journal-service'
import { getHqRouting } from '../../../hq-routing/hq-routing'
import { getHqMergeSlots } from '../../../hq-routing/hq-merge-slot'
import { getHqPlusStats } from '../../../hq-plus-ui/hq-plus-screen-stats'
import { getHqContext, type HqContextService } from '../../../hq-context/hq-context'
import { getHqSessions, type HqSessionsService } from '../../../hq-sessions/hq-sessions'

const DAY_MS = 24 * 60 * 60_000

function context(): HqContextService {
  const provided = getHqContext()
  if (!provided) {
    throw new Error('HQ+ project cards are not available on this host.')
  }
  return provided
}

function sessions(): HqSessionsService {
  const provided = getHqSessions()
  if (!provided) {
    throw new Error('The HQ+ session dispatcher is not available on this host.')
  }
  return provided
}

function journal(): HqJournalService {
  const service = getHqJournalService()
  if (!service) {
    throw new Error('The HQ+ journal is not available on this host.')
  }
  return service
}

function threads(): HqThreads {
  const provided = getHqThreads()
  if (!provided) {
    throw new Error('HQ+ threads are not available on this host.')
  }
  return provided
}

const callerOf = (params: {
  callerSessionId?: string
  callerWorktreeId?: string
  callerCwd?: string
}) => ({
  sessionId: params.callerSessionId,
  worktreeId: params.callerWorktreeId,
  cwd: params.callerCwd
})

// Custom build (hq-plus-journal): HQ+'s journal for agents. A chat reads only its own room; a chat
// in the HQ repo (HQ+) reads every room's headings, and one room in full with `room`.
// Why caller fields come from params: rooms keep each chat's context clean, they are not a security
// boundary — agents run as the owner and can read the database itself (same as pulse.addWaiting).
export const HQ_JOURNAL_METHODS = [
  defineMethod({
    name: 'hq.events',

    permission: 'workspace',
    params: HqEventsParams,
    handler: async (params) =>
      journal().events({
        sessionId: params.callerSessionId,
        worktreeId: params.callerWorktreeId,
        cwd: params.callerCwd,
        since: params.since,
        project: params.project,
        needs: params.needs,
        kind: params.kind,
        limit: params.limit,
        room: params.room,
        text: params.query
      })
  }),
  // Custom build (hq-plus-reports): a turn's report, a thread, a message into another chat's thread.
  defineMethod({
    name: 'hq.report',

    permission: 'workspace',
    params: HqReportParams,
    handler: async ({ callerSessionId, callerWorktreeId, callerCwd, ...report }) =>
      threads().report(callerOf({ callerSessionId, callerWorktreeId, callerCwd }), report)
  }),
  defineMethod({
    name: 'hq.thread',

    permission: 'workspace',
    params: HqThreadParams,
    handler: async (params) => threads().thread(callerOf(params), params.address)
  }),
  defineMethod({
    name: 'chat.send',

    permission: 'workspace',
    params: ChatSendParams,
    handler: async (params) =>
      threads().send(callerOf(params), {
        address: params.address,
        text: params.text,
        replyTo: params.replyTo
      })
  }),
  defineMethod({
    name: 'hq.whoami',

    permission: 'workspace',
    params: HqWhoamiParams,
    handler: async (params) =>
      journal().whoami({
        sessionId: params.callerSessionId,
        worktreeId: params.callerWorktreeId,
        cwd: params.callerCwd
      })
  }),
  // Custom build (hq-plus-routing): what HQ/routing.yaml does now, and a chat closing a row it was handed.
  defineMethod({
    name: 'hq.route',

    permission: 'workspace',
    params: HqRouteParams,
    handler: async (params) => {
      const routing = getHqRouting()
      if (!routing) {
        throw new Error('HQ+ routing is not available on this host.')
      }
      return routing.run({
        dryRun: params.run !== true,
        manual: params.run === true || params.now === true || params.report !== undefined,
        since: params.since,
        report: params.report
      })
    }
  }),
  // Custom build (hq-fix-now-all): a fixing chat takes the project's merge slot before merging.
  defineMethod({
    name: 'hq.mergeSlot',

    permission: 'workspace',
    params: HqMergeSlotParams,
    handler: async ({ project, action, ...caller }) => {
      const slots = getHqMergeSlots()
      if (!slots) {
        throw new Error('HQ+ merge slots are not available on this host.')
      }
      if (action === 'status') {
        return { project, action, slot: slots.status(project) }
      }
      const me = await journal().whoami({
        sessionId: caller.callerSessionId,
        worktreeId: caller.callerWorktreeId,
        cwd: caller.callerCwd
      })
      // Why: a handoff and the chat it resumed share an address; the slot belongs to one session.
      const holder = me.sessionId ?? me.address ?? caller.callerWorktreeId ?? caller.callerCwd
      if (!holder) {
        throw new Error('Run it from an agent chat: the slot is held by the chat that takes it.')
      }
      return action === 'take'
        ? { project, action, holder, ...slots.take(project, holder) }
        : { project, action, holder, ok: slots.release(project, holder) }
    }
  }),
  defineMethod({
    name: 'hq.settle',

    permission: 'workspace',
    params: HqSettleParams,
    handler: async ({ callerSessionId, callerWorktreeId, callerCwd, ...input }) =>
      threads().settle(callerOf({ callerSessionId, callerWorktreeId, callerCwd }), input)
  }),
  // Custom build (hq-plus-context): a project's card, a new chat's start, plan steps, the knowledge map, rooms.
  defineMethod({
    name: 'hq.context',

    permission: 'workspace',
    params: HqContextParams,
    handler: async (params) =>
      params.sessionStart
        ? context().sessionStart(callerOf(params))
        : context().context(callerOf(params), params.project)
  }),
  defineMethod({
    name: 'hq.step',

    permission: 'workspace',
    params: HqStepParams,
    handler: async (params) =>
      context().step(callerOf(params), {
        project: params.project,
        id: params.id,
        done: params.done
      })
  }),
  defineMethod({
    name: 'hq.where',

    permission: 'workspace',
    params: HqWhereParams,
    handler: async (params) => context().where(params.question)
  }),
  defineMethod({
    name: 'hq.workspaceAdd',

    permission: 'workspace',
    params: HqWorkspaceAddParams,
    handler: async ({ callerSessionId: _s, callerWorktreeId: _w, callerCwd: _c, ...input }) =>
      context().addRoom(input)
  }),
  // Custom build (hq-plus-sessions): hand work to a thread; the chats and what the dispatcher would do.
  defineMethod({
    name: 'hq.dispatch',

    permission: 'workspace',
    params: HqDispatchParams,
    handler: async (params) =>
      sessions().dispatch(callerOf(params), {
        address: params.address,
        prompt: params.prompt,
        dryRun: params.dryRun
      })
  }),
  // Custom build (hq-plus-ui): the owner's screen — every room's rows with their threads' chats;
  // not an agent's read, so nothing is journaled for it.
  defineMethod({
    name: 'hq.feed',

    permission: 'workspace',
    params: HqFeedParams,
    handler: async (params, { runtime }) => {
      const recent = runtime.pulseListJournal({
        since: params.since,
        limit: Math.min(params.limit ?? HQ_FEED_DEFAULT_LIMIT, HQ_JOURNAL_MAX_LIMIT)
      })
      // Why: what waits on the owner stays on his screen however old it is.
      const yours = runtime.pulseListJournal({
        needs: 'owner',
        status: 'open',
        limit: HQ_JOURNAL_MAX_LIMIT
      })
      // Why: a decision raised before the newest rows and settled since keeps its card in place.
      const decided = runtime.pulseListJournal({
        needs: 'owner',
        since: params.since,
        limit: HQ_JOURNAL_MAX_LIMIT
      })
      // Why: an older question the owner answered since is settled, yet its card stays in place.
      const seen = new Set(recent.map((entry) => entry.id))
      const answered = recent.flatMap((entry) => {
        const asked =
          isHqPlusOwnerMessage(entry) && entry.replyTo && !seen.has(entry.replyTo)
            ? runtime.pulseGetJournalEntry(entry.replyTo)
            : null
        return asked?.needs.startsWith('owner:') ? [asked] : []
      })
      const entries = [...recent]
      for (const entry of [...yours, ...decided, ...answered]) {
        if (!seen.has(entry.id)) {
          seen.add(entry.id)
          entries.push(entry)
        }
      }
      const addresses = [
        ...new Set(entries.flatMap((entry) => (entry.address ? [entry.address] : [])))
      ]
      const open = runtime.pulseListInbox(false).filter((item) => HQ_PLUS_CARD_KINDS.has(item.kind))
      const openIds = new Set(open.map((item) => item.id))
      const settled = runtime
        .pulseListInbox(true, params.since === undefined ? {} : { since: params.since })
        .filter((item) => HQ_PLUS_CARD_KINDS.has(item.kind) && !openIds.has(item.id))
      return {
        entries,
        sessions: addresses.flatMap((address) => runtime.pulseListSessionsByAddress(address)),
        inbox: [...open, ...settled],
        now: Date.now()
      }
    }
  }),
  // Custom build (hq-plus-ui): the screen's numbers the journal does not hold.
  defineMethod({
    name: 'hq.screenStats',

    permission: 'workspace',
    params: HqFeedParams,
    handler: async (params, { runtime }): Promise<HqPlusScreenStats> => {
      const stats = getHqPlusStats()
      const now = Date.now()
      const since = params.since ?? now - HQ_PLUS_FEED_WINDOW_MS
      return {
        ...(stats ? await stats.read() : { plan: null, manual: null }),
        journalDay: runtime.pulseCountJournal(now - DAY_MS),
        activity: runtime.pulseJournalActivity({
          since,
          slotMs: hqPlusLaneSlotMs(),
          kinds: [...HQ_PLUS_WORK_KINDS]
        })
      }
    }
  }),
  defineMethod({
    name: 'hq.sessions',

    permission: 'workspace',
    params: HqSessionsParams,
    handler: async (params) => sessions().sweep({ run: params.run === true })
  })
]
