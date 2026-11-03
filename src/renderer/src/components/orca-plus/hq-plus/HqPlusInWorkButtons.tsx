// Custom build (hq-in-work, owner 03.11, plan 20.11): the buttons of a conversation a chat already does.
import { translate } from '@/i18n/i18n'
import { HqPlusCardButtons, useHqPlusRun, type HqPlusCardButton } from './HqPlusCardShell'
import { hqPlusCall } from './use-hq-plus-data'
import type { HqPlusLogContext } from './HqPlusLog'

/** Custom build (hq-in-work, plan 20.11): a chat already does this — open it, or say it does not and
 *  get the card back (the guess then counts as wrong). */
export function HqPlusInWorkButtons({
  conversationId,
  openChat,
  ctx
}: {
  conversationId: string
  openChat: (() => void) | null
  ctx: HqPlusLogContext
}): React.JSX.Element {
  const { busy, pending, error, run } = useHqPlusRun(ctx.onChanged)
  const buttons: HqPlusCardButton[] = [
    ...(openChat
      ? [
          {
            id: 'chat',
            label: translate('auto.hqPlus.conv.inWorkOpen', 'Open chat'),
            main: true,
            onClick: () => openChat()
          }
        ]
      : []),
    {
      id: 'not-in-work',
      label: translate('auto.hqPlus.conv.notInWork', 'Not in work'),
      hint: translate(
        'auto.hqPlus.conv.notInWorkHint',
        'No chat is doing this yet. The card comes back as your move'
      ),
      ghost: true,
      disabled: busy,
      pending: pending === 'not-in-work',
      onClick: () =>
        run(
          () =>
            hqPlusCall('hq.conversationNotInWork', { conversationId }).then((result) =>
              result.ok ? { ok: true as const } : result
            ),
          'not-in-work'
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
