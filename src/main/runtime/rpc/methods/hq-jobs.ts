// Custom build (hq-closed-loop): `orca hq job` — a background job (launchd script, automation, the
// ship) tells HQ+ what it found, what it needs the owner to decide and what it did by itself.
import { defineMethod } from '../core'
import { HqJobParams, HqJobReplyParams } from '../../../../shared/rpc-contract/hq-journal-params'
import { getHqJournalService } from '../../../hq-journal/hq-journal-service'
import { hqPlaceOf } from '../../../hq-journal/hq-journal-rooms'
import { hqJobAddress, hqJobReplyRows, hqJobRow } from '../../../hq-journal/hq-journal-jobs'
import { HQ_JOURNAL_ALL_ROOMS } from '../../../../shared/hq-journal'

export const HQ_JOB_METHODS = [
  defineMethod({
    name: 'hq.job',

    permission: 'workspace',
    params: HqJobParams,
    handler: async (params, { runtime }) => {
      const service = getHqJournalService()
      if (!service) {
        throw new Error('The HQ+ journal is not available on this host.')
      }
      // Why: a job of no project (the Slack scout, a rollup) is everyone's; HQ+ shows it in All.
      const place = params.project
        ? hqPlaceOf(await service.sources(), { project: params.project })
        : { room: HQ_JOURNAL_ALL_ROOMS, project: null, firm: false }
      const row = hqJobRow(params, place, Date.now())
      const recorded = runtime.pulseRecordJournal([row])
      return { address: hqJobAddress(params.job), needs: row.needs, room: row.workspace, recorded }
    }
  }),
  defineMethod({
    name: 'hq.jobReply',

    permission: 'workspace',
    params: HqJobReplyParams,
    handler: (params, { runtime }) => {
      const entry = runtime.pulseGetJournalEntry(params.entryId)
      if (!entry) {
        throw new Error(`No journal entry ${params.entryId}.`)
      }
      const recorded = runtime.pulseRecordJournal(hqJobReplyRows(entry, params.text, Date.now()))
      return { address: entry.address, recorded }
    }
  })
]
