import { defineMethod } from '../core'
import {
  ChatSendParams,
  HqEventsParams,
  HqReportParams,
  HqThreadParams,
  HqWhoamiParams
} from '../../../../shared/rpc-contract/hq-journal-params'
import { getHqThreads, type HqThreads } from '../../../hq-journal/hq-journal-threads'
import { getHqJournalService, type HqJournalService } from '../../../hq-journal/hq-journal-service'

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
        room: params.room
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
  })
]
