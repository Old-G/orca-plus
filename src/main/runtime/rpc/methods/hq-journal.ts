import { defineMethod } from '../core'
import {
  ChatSendParams,
  HqContextParams,
  HqDispatchParams,
  HqEventsParams,
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
import { getHqThreads, type HqThreads } from '../../../hq-journal/hq-journal-threads'
import { getHqJournalService, type HqJournalService } from '../../../hq-journal/hq-journal-service'
import { getHqRouting } from '../../../hq-routing/hq-routing'
import { getHqContext, type HqContextService } from '../../../hq-context/hq-context'
import { getHqSessions, type HqSessionsService } from '../../../hq-sessions/hq-sessions'

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
        manual: params.run === true || params.now === true,
        since: params.since
      })
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
  defineMethod({
    name: 'hq.sessions',

    permission: 'workspace',
    params: HqSessionsParams,
    handler: async (params) => sessions().sweep({ run: params.run === true })
  })
]
