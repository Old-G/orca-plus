// Custom build (hq-ledger-sources): the owner's word on a request-ledger conversation from its card in
// HQ+ — «Done» on an MR or a mail thread no other card stands for.
import { defineMethod } from '../core'
import { HqConversationDoneParams } from '../../../../shared/rpc-contract/hq-journal-params'

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
  })
]
