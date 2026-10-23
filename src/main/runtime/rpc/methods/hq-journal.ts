import { defineMethod } from '../core'
import { HqEventsParams, HqWhoamiParams } from '../../../../shared/rpc-contract/hq-journal-params'
import { getHqJournalService, type HqJournalService } from '../../../hq-journal/hq-journal-service'

function journal(): HqJournalService {
  const service = getHqJournalService()
  if (!service) {
    throw new Error('The HQ+ journal is not available on this host.')
  }
  return service
}

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
