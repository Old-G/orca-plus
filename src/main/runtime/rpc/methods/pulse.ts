import { defineMethod } from '../core'
import {
  PulseAddDraftParams,
  PulseAddInboxItemParams,
  PulseAddWaitingParams,
  PulseUpdateWaitingParams,
  PulseCloseWaitingParams,
  PulseEventsParams,
  PulseFeedParams,
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

    permission: 'workspace',
    params: null,
    handler: async (_params, { runtime }) => runtime.pulseSnapshot()
  }),
  defineMethod({
    name: 'pulse.events',

    permission: 'workspace',
    params: PulseEventsParams,
    handler: async (params, { runtime }) => runtime.pulseEvents(params.afterSeq, params.limit)
  }),
  defineMethod({
    name: 'pulse.feed',

    permission: 'workspace',
    params: PulseFeedParams,
    handler: async (params, { runtime }) => runtime.pulseFeed(params)
  }),
  defineMethod({
    name: 'pulse.upsertPerson',

    permission: 'workspace',
    params: PulseUpsertPersonParams,
    handler: async (params, { runtime }) => runtime.pulseUpsertPerson(params)
  }),
  defineMethod({
    name: 'pulse.listPeople',

    permission: 'workspace',
    params: PulseListPeopleParams,
    handler: async (params, { runtime }) => runtime.pulseListPeople(params?.query)
  }),
  defineMethod({
    name: 'pulse.addWaiting',

    permission: 'workspace',
    params: PulseAddWaitingParams,
    handler: async (params, { runtime }) => {
      // Custom build (hq-waiting-replies): only a chat this host knows may receive the answer later.
      const record = params.agentSessionId
        ? runtime.openedAgentSessionRecordStore()?.getRecord(params.agentSessionId)
        : undefined
      return runtime.pulseAddWaiting({
        ...params,
        agentSessionId: record ? params.agentSessionId : null,
        worktreeId: record?.location.workspaceId ?? null
      })
    }
  }),
  defineMethod({
    // Custom build (hq-notes-dedup)
    name: 'pulse.updateWaiting',

    permission: 'workspace',
    params: PulseUpdateWaitingParams,
    handler: async ({ id, ...patch }, { runtime }) => runtime.pulseUpdateWaiting(id, patch)
  }),
  defineMethod({
    name: 'pulse.closeWaiting',

    permission: 'workspace',
    params: PulseCloseWaitingParams,
    handler: async (params, { runtime }) =>
      runtime.pulseCloseWaiting(params.id, params.status, params.resolution)
  }),
  defineMethod({
    name: 'pulse.listWaitings',

    permission: 'workspace',
    params: PulseListWaitingsParams,
    handler: async (params, { runtime }) => runtime.pulseListWaitings(params ?? {})
  }),
  defineMethod({
    name: 'pulse.addDraft',

    permission: 'workspace',
    params: PulseAddDraftParams,
    handler: async (params, { runtime }) => runtime.pulseAddDraft(params)
  }),
  defineMethod({
    name: 'pulse.listDrafts',

    permission: 'workspace',
    params: PulseListDraftsParams,
    handler: async (params, { runtime }) => runtime.pulseListDrafts(params?.status)
  }),
  defineMethod({
    name: 'pulse.logDecision',

    permission: 'workspace',
    params: PulseLogDecisionParams,
    handler: async (params, { runtime }) => runtime.pulseLogDecision(params)
  }),
  defineMethod({
    name: 'pulse.listDecisions',

    permission: 'workspace',
    params: PulseListDecisionsParams,
    handler: async (params, { runtime }) => runtime.pulseListDecisions(params?.limit)
  }),
  defineMethod({
    name: 'pulse.addInboxItem',

    permission: 'workspace',
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

    permission: 'workspace',
    params: PulseListInboxParams,
    handler: async (params, { runtime }) =>
      runtime.pulseListInbox(params?.includeDone, { kind: params?.kind, since: params?.since })
  }),
  defineMethod({
    name: 'pulse.markInboxRead',

    permission: 'workspace',
    params: PulseInboxItemRef,
    handler: async (params, { runtime }) => runtime.pulseMarkInboxRead(params.id)
  }),
  defineMethod({
    name: 'pulse.markInboxDone',

    permission: 'workspace',
    params: PulseInboxItemRef,
    handler: async (params, { runtime }) => {
      // Why: closing an approval card over RPC would hide a held call without deciding it.
      const item = runtime.pulseListInbox(true).find((entry) => entry.id === params.id)
      if (item?.kind === OUTGOING_APPROVAL_BELL_KIND) {
        throw new Error('Approval cards close only when the owner decides them in Orca+.')
      }
      return runtime.pulseMarkInboxDone(params.id, params.action)
    }
  })
]
