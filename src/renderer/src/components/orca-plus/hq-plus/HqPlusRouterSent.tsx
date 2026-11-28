// Custom build (hq-router send first, router v2 T5, owner 28.11): a Router card the router already sent by
// itself (the middle zone) — «OK» keeps it there, a runner-up or «Other chat…» is «Wrong chat»: the
// message goes there and the chat that had it is told to ignore it. Chats that answered «не моё» are named.
import type { HqIntake } from '../../../../../shared/hq-slack-intake'
import type { HqIntakeSent } from '../../../../../shared/hq-router-send-first'
import { translate } from '@/i18n/i18n'
import { hqPlusRouterOthers, type HqPlusRouterCard } from './hq-plus-router'

type Other = NonNullable<HqIntake['route']>['alternatives'][number]

export function HqPlusRouterNotMine({ intake }: { intake: HqIntake }): React.JSX.Element | null {
  const refused = intake.notMine ?? []
  if (refused.length === 0) {
    return null
  }
  return (
    <>
      {refused.map((no) => (
        <p key={no.chat} className="hqr-why">
          {translate('auto.hqPlus.router.notMine', '«{{chat}}» said it is not theirs', {
            chat: (no.title ?? no.chat).slice(0, 60)
          })}
          {no.reason ? `: ${no.reason.slice(0, 160)}` : ''}
        </p>
      ))}
    </>
  )
}

export function HqPlusRouterSentActions({
  card,
  sent,
  busy,
  run,
  onOther,
  onPick
}: {
  card: HqPlusRouterCard
  sent: HqIntakeSent
  busy: boolean
  run: (work: () => Promise<void>) => void
  onOther: (other: Other) => Promise<void>
  onPick: () => void
}): React.JSX.Element {
  const title = sent.title ?? sent.chat
  // Why with the chat: «OK» is the owner's word that it went right — it binds the thread there.
  const onOk = (): void =>
    run(() =>
      window.api.pulseBell.closeIntake(card.item.id, 'sent', `Sent to «${title}»`, sent.chat)
    )
  return (
    <div className="hqr-acts">
      <button
        type="button"
        className="hqp-opt"
        data-main="true"
        disabled={busy}
        title={translate('auto.hqPlus.router.sentOkTip', 'It went to the right chat: {{chat}}', {
          chat: title
        })}
        onClick={onOk}
      >
        {translate('auto.hqPlus.router.sentOk', 'OK')}
      </button>
      <span className="hqr-why">{translate('auto.hqPlus.router.wrongChat', 'Wrong chat:')}</span>
      {hqPlusRouterOthers(card.intake).map((other) => (
        <button
          key={other.sessionId}
          type="button"
          className="hqp-opt"
          disabled={busy}
          title={translate(
            'auto.hqPlus.router.wrongChatTip',
            'Send it here; the chat that has it is told to ignore it'
          )}
          onClick={() => run(() => onOther(other))}
        >
          {other.title.slice(0, 40)}
        </button>
      ))}
      <button type="button" className="hqp-opt" disabled={busy} onClick={onPick}>
        {translate('auto.hqPlus.router.other', 'Other chat…')}
      </button>
    </div>
  )
}
