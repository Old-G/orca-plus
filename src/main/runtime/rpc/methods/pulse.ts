import { defineMethod } from '../core'
import {
  PulseAddDraftParams,
  PulseAddInboxItemParams,
  PulseAddWaitingParams,
  PulseCloseWaitingParams,
  PulseEventsParams,
  PulseInboxItemRef,
  PulseListDecisionsParams,
  PulseListDraftsParams,
  PulseListInboxParams,
  PulseListPeopleParams,
  PulseListWaitingsParams,
  PulseLogDecisionParams,
  PulseUpsertPersonParams
} from '../../../../shared/rpc-contract/pulse-params'
import { OUTGOING_APPROVAL_BELL_KIND } from '../../../../shared/outgoing-approval/outgoing-approval-bell'

// Custom build (pulse): records behind Orca+'s headquarters views. No method here approves a
// draft or reports its delivery — see pulse-params.ts.
export const PULSE_METHODS = [
  defineMethod({
    name: 'pulse.snapshot',
    params: null,
    handler: async (_params, { runtime }) => runtime.pulseSnapshot()
  }),
  defineMethod({
    name: 'pulse.events',
    params: PulseEventsParams,
    handler: async (params, { runtime }) => runtime.pulseEvents(params.afterSeq, params.limit)
  }),
  defineMethod({
    name: 'pulse.upsertPerson',
    params: PulseUpsertPersonParams,
    handler: async (params, { runtime }) => runtime.pulseUpsertPerson(params)
  }),
  defineMethod({
    name: 'pulse.listPeople',
    params: PulseListPeopleParams,
    handler: async (params, { runtime }) => runtime.pulseListPeople(params?.query)
  }),
  defineMethod({
    name: 'pulse.addWaiting',
    params: PulseAddWaitingParams,
    handler: async (params, { runtime }) => runtime.pulseAddWaiting(params)
  }),
  defineMethod({
    name: 'pulse.closeWaiting',
    params: PulseCloseWaitingParams,
    handler: async (params, { runtime }) =>
      runtime.pulseCloseWaiting(params.id, params.status, params.resolution)
  }),
  defineMethod({
    name: 'pulse.listWaitings',
    params: PulseListWaitingsParams,
    handler: async (params, { runtime }) => runtime.pulseListWaitings(params ?? {})
  }),
  defineMethod({
    name: 'pulse.addDraft',
    params: PulseAddDraftParams,
    handler: async (params, { runtime }) => runtime.pulseAddDraft(params)
  }),
  defineMethod({
    name: 'pulse.listDrafts',
    params: PulseListDraftsParams,
    handler: async (params, { runtime }) => runtime.pulseListDrafts(params?.status)
  }),
  defineMethod({
    name: 'pulse.logDecision',
    params: PulseLogDecisionParams,
    handler: async (params, { runtime }) => runtime.pulseLogDecision(params)
  }),
  defineMethod({
    name: 'pulse.listDecisions',
    params: PulseListDecisionsParams,
    handler: async (params, { runtime }) => runtime.pulseListDecisions(params?.limit)
  }),
  defineMethod({
    name: 'pulse.addInboxItem',
    params: PulseAddInboxItemParams,
    handler: async (params, { runtime }) => {
      // Why: an approval card's text is what the owner approves, and agents call this RPC; only the gate raises one.
      if (params.kind === OUTGOING_APPROVAL_BELL_KIND) {
        throw new Error('Approval cards come only from the outgoing gate.')
      }
      return runtime.pulseAddInboxItem(params)
    }
  }),
  defineMethod({
    name: 'pulse.listInbox',
    params: PulseListInboxParams,
    handler: async (params, { runtime }) => runtime.pulseListInbox(params?.includeDone)
  }),
  defineMethod({
    name: 'pulse.markInboxRead',
    params: PulseInboxItemRef,
    handler: async (params, { runtime }) => runtime.pulseMarkInboxRead(params.id)
  }),
  defineMethod({
    name: 'pulse.markInboxDone',
    params: PulseInboxItemRef,
    handler: async (params, { runtime }) => runtime.pulseMarkInboxDone(params.id, params.action)
  })
]
