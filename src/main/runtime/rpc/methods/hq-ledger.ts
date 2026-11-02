// Custom build (hq-ledger-sources): the owner's word on a request-ledger conversation from its card in
// HQ+ — «Done» on an MR or a mail thread no other card stands for.
import { defineMethod } from '../core'
import {
  HqAccuracyParams,
  HqAttributionSkipParams,
  HqAttributionTakeParams,
  HqConversationDoneParams
} from '../../../../shared/rpc-contract/hq-journal-params'

/** Why: Slack and ClickUp conversations settle through their own cards until the switch (19.6). */
const CLOSED_FROM_CARD = /^(?:gitlab|gmail):/

export const HQ_LEDGER_METHODS = [
  defineMethod({
    name: 'hq.conversationDone',

    permission: 'workspace',
    params: HqConversationDoneParams,
    handler: (params, { runtime, caller }) => {
      // Why: Done is the owner's; only his own window or paired phone gives it, never the CLI or a chat.
      if (caller?.kind !== 'desktop' && caller?.kind !== 'paired-device') {
        throw new Error('Only the owner closes a conversation, from HQ+ on the Mac or the phone.')
      }
      if (!CLOSED_FROM_CARD.test(params.key)) {
        throw new Error('Only GitLab and mail conversations are closed from their card.')
      }
      return { closed: runtime.pulseCloseLedgerConversation(params.key) }
    }
  }),
  // Custom build (hq-attribution-log, owner 03.11): the owner's own choices are what get counted, so
  // only his window or paired phone writes them.
  defineMethod({
    name: 'hq.attributionTake',

    permission: 'workspace',
    params: HqAttributionTakeParams,
    handler: (params, { runtime, caller }) => {
      if (caller?.kind !== 'desktop' && caller?.kind !== 'paired-device') {
        throw new Error('Only the owner records what he chose, from HQ+ on the Mac or the phone.')
      }
      runtime.pulseNoteAttributionTake(params)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'hq.attributionSkip',

    permission: 'workspace',
    params: HqAttributionSkipParams,
    handler: (params, { runtime, caller }) => {
      if (caller?.kind !== 'desktop' && caller?.kind !== 'paired-device') {
        throw new Error('Only the owner records what he chose, from HQ+ on the Mac or the phone.')
      }
      runtime.pulseNoteAttributionSkip(params.key)
      return { ok: true }
    }
  }),
  defineMethod({
    name: 'hq.accuracy',

    permission: 'workspace',
    params: HqAccuracyParams,
    handler: (params, { runtime }) =>
      runtime.pulseAttributionAccuracy(Date.now() - (params.days ?? 14) * 24 * 60 * 60_000)
  })
]
