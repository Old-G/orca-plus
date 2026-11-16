// Custom build (hq-ledger-sources): the buttons of a ledger conversation no other card stands for.
// Custom build (hq-mr-comments, T14): moved out of HqPlusConversationCard with «Send to chat».
import { translate } from '@/i18n/i18n'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import {
  hqConversationChatPrompt,
  hqConversationNewSaid,
  hqUnsentMessagesOf
} from '../../../../../shared/hq-conversation-chat-prompt'
import { HqPlusCardButtons, useHqPlusRun, type HqPlusCardButton } from './HqPlusCardShell'
import type { HqPlusChatRef } from './HqPlusChatName'
import type { HqPlusLogContext } from './HqPlusLog'
import { hqPlusCall } from './use-hq-plus-data'
import { noteHqPlusTakeHint } from './hq-plus-take-hint'
import { sendHqRoutePrompt } from '../pulse-bell/hq-route-send'

/** Custom build (hq-ledger-sources): an MR or a mail thread no other card stands for — open it where
 *  it lives, or say it is done (the next message brings it back). */
export function HqPlusLedgerOnlyButtons({
  card,
  link,
  chat,
  ctx
}: {
  card: HqPlusCard
  link: string | null
  chat: HqPlusChatRef | null
  ctx: HqPlusLogContext
}): React.JSX.Element {
  const { busy, pending, error, run } = useHqPlusRun(ctx.onChanged)
  const key = card.conversation?.key ?? ''
  const yours = card.conversation?.ledgerState === 'you'
  // Custom build (hq-ledger-cutover, owner 03.11): a Slack talk goes to a project or chat from its
  // card, also when no reader raised a «To work» card for it.
  const slack = key.startsWith('slack:')
  // Custom build (hq-mr-comments, T14): an MR's comments go to the chat working on its branch — picked
  // already, sent only by the owner's click; the card is then done until the next comment.
  const conversation = card.conversation
  const chatItem = chat?.item ?? null
  const toChat =
    key.startsWith('gitlab:') && card.sessionId && chatItem && conversation
      ? hqConversationNewSaid(conversation.messages).length > 0
        ? { sessionId: card.sessionId, item: chatItem, conversation }
        : null
      : null
  const buttons: HqPlusCardButton[] = [
    ...(toChat
      ? [
          {
            id: 'to-chat',
            label: translate('auto.hqPlus.conv.toChat', 'Send to chat'),
            hint: translate(
              'auto.hqPlus.conv.toChatHint',
              'Send these comments to «{{chat}}», the chat working on this MR',
              { chat: chat?.name ?? toChat.item.worktreeName }
            ),
            main: true,
            disabled: busy,
            pending: pending === 'to-chat',
            onClick: () =>
              run(async () => {
                // Why from the main side: the card holds only the newest few; each one sent is
                // marked sent, so the chat gets every comment still owed (an older one too).
                const owed = await hqPlusCall('hq.conversationUnsent', { key })
                if (!owed.ok) {
                  return owed
                }
                const unsent = hqUnsentMessagesOf(owed.result)
                const said =
                  unsent.length > 0 ? unsent : hqConversationNewSaid(toChat.conversation.messages)
                const sent = await sendHqRoutePrompt(
                  {
                    kind: 'chat',
                    chat: {
                      sessionId: toChat.sessionId,
                      worktreeId: toChat.item.worktreeId,
                      title: chat?.name ?? toChat.item.worktreeName
                    }
                  },
                  hqConversationChatPrompt({
                    title: toChat.conversation.title,
                    link,
                    messages: said
                  })
                )
                if (!sent) {
                  return { ok: false as const, message: 'The chat did not take it' }
                }
                const done = await hqPlusCall('hq.conversationDone', {
                  key,
                  sentTo: {
                    sessionId: toChat.sessionId,
                    chat: (chat?.name ?? toChat.item.worktreeName).slice(0, 200),
                    upTo: Math.max(0, ...said.map((m) => m.at))
                  }
                })
                return done.ok ? { ok: true as const } : done
              }, 'to-chat')
          }
        ]
      : []),
    ...(slack
      ? [
          {
            id: 'to-work',
            label: translate('auto.hqPlus.conv.toWork', 'To work'),
            hint: translate(
              'auto.hqPlus.conv.toWorkHint',
              'Pick a project and a chat; the chat gets the whole thread'
            ),
            main: true,
            disabled: busy,
            pending: pending === 'to-work',
            onClick: () =>
              run(async () => {
                const taken = await hqPlusCall('hq.conversationToWork', { key })
                const item = taken.ok
                  ? (Reflect.get(Object(taken.result), 'item') as PulseInboxItem)
                  : null
                if (!taken.ok || !item) {
                  return taken.ok ? { ok: false as const, message: 'No card to take' } : taken
                }
                const proposed = card.conversation?.guess?.chat
                noteHqPlusTakeHint(item.id, {
                  project: card.project,
                  sessionId: card.sessionId ?? (proposed && proposed !== 'new' ? proposed : null),
                  key,
                  guess: card.conversation?.guess ?? null
                })
                ctx.toWork(item)
                return { ok: true as const }
              }, 'to-work')
          }
        ]
      : []),
    ...(link
      ? [
          {
            id: 'open',
            label: translate('auto.hqPlus.conv.open', 'Open ↗'),
            main: yours && !slack && !toChat,
            ghost: !yours || slack,
            onClick: (event: React.MouseEvent<HTMLButtonElement>) => ctx.openLink(link, event)
          }
        ]
      : []),
    {
      id: 'done',
      label: translate('auto.hqPlus.conv.done', 'Done'),
      hint: translate(
        'auto.hqPlus.conv.doneHint',
        'Nothing more to do here. A new message brings it back'
      ),
      ghost: true,
      disabled: busy,
      pending: pending === 'done',
      onClick: () =>
        run(
          () =>
            hqPlusCall('hq.conversationDone', { key }).then((result) =>
              result.ok ? { ok: true as const } : result
            ),
          'done'
        )
    }
  ]
  return (
    <>
      <HqPlusCardButtons buttons={buttons} />
      {error ? <p className="hqp-error">{error}</p> : null}
    </>
  )
}
