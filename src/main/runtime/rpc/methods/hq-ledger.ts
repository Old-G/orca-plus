// Custom build (hq-ledger-sources): the owner's word on a request-ledger conversation from its card in
// HQ+ — «Done» on an MR or a mail thread no other card stands for.
import { defineMethod } from '../core'
import {
  HqAccuracyParams,
  HqAttributionSkipParams,
  HqAttributionTakeParams,
  HqConversationDoneParams,
  HqConversationNotInWorkParams,
  HqConversationToWorkParams,
  HqConversationUnsentParams
} from '../../../../shared/rpc-contract/hq-journal-params'
import { hqIntakeBellItem } from '../../../../shared/hq-slack-intake'
import { hqIntakeOfConversation } from '../../../hq-today/hq-ledger-cards'
import { HQ_SEND_TO_CHAT_MAX, hqRecordSentToChat } from '../../../hq-today/hq-ledger-sent-to-chat'

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
      if (params.sentTo) {
        return hqRecordSentToChat(
          {
            ingest: (signal) => runtime.pulseIngestLedger(signal),
            lastDirection: (key) => runtime.pulseLastLedgerDirection(key),
            close: (key) => runtime.pulseCloseLedgerConversation(key),
            now: Date.now
          },
          params.key,
          params.sentTo
        )
      }
      return { closed: runtime.pulseCloseLedgerConversation(params.key) }
    }
  }),
  defineMethod({
    name: 'hq.conversationUnsent',

    permission: 'workspace',
    params: HqConversationUnsentParams,
    handler: (params, { runtime, caller }) => {
      // Why owner only: the people's words go on from here into a chat, and only his click sends them.
      if (caller?.kind !== 'desktop' && caller?.kind !== 'paired-device') {
        throw new Error('Only the owner sends comments to a chat, from HQ+.')
      }
      return { messages: runtime.pulseListLedgerUnsent(params.key, HQ_SEND_TO_CHAT_MAX) }
    }
  }),
  // Custom build (hq-ledger-cutover, owner 03.11): a Slack conversation with no card of its own still
  // goes to a project or chat — its «To work» card is made, or the one already there is given.
  defineMethod({
    name: 'hq.conversationToWork',

    permission: 'workspace',
    params: HqConversationToWorkParams,
    handler: (params, { runtime, caller }) => {
      if (caller?.kind !== 'desktop' && caller?.kind !== 'paired-device') {
        throw new Error('Only the owner takes a conversation to work, from HQ+.')
      }
      const row = runtime.pulseAttribution().card(params.key)
      const intake = row
        ? hqIntakeOfConversation(row, runtime.pulseAttribution().drafts.of(row.id))
        : null
      if (!intake) {
        throw new Error('This conversation has no Slack message to take to work.')
      }
      return { item: runtime.pulseAddInboxItem(hqIntakeBellItem(intake)).record }
    }
  }),
  // Custom build (hq-in-work, plan 20.11): «Not in work» brings the card back and counts the guess as
  // wrong — the owner's word, so only from his window or paired phone.
  defineMethod({
    name: 'hq.conversationNotInWork',

    permission: 'workspace',
    params: HqConversationNotInWorkParams,
    handler: (params, { runtime, caller }) => {
      if (caller?.kind !== 'desktop' && caller?.kind !== 'paired-device') {
        throw new Error('Only the owner says a conversation is not in work, from HQ+.')
      }
      return { back: runtime.pulseClearConversationInWork(params.conversationId) }
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
