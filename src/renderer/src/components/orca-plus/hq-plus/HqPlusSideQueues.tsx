// Custom build (hq-plus-ui-v3): the left column's two queues as cards that act — what waits on the owner
// (open it, Done, Not now, a word to its chat) and what we wait for from people (open, Nudge, Got it).
// Every action goes the way the classic HQ does it: the bell, the waiting, the reminder through Approve.
// Custom build (hq-plus-side-blocks): each queue folds by its title and scrolls inside an equal height.
// Custom build (hq-plus-ui-v4): the whole text, formatted, with the actions under it; sections fold smoothly.
import { useState } from 'react'
import { HqPlusSideBlock } from './HqPlusSideBlock'
import { hqPlusWaitGroups } from './hq-plus-wait-groups'
import { HqPlusWeWaitCard } from './HqPlusWeWaitCard'
import { translate } from '@/i18n/i18n'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import { hqPlusLook } from '../../../../../shared/hq-plus-kinds'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusText } from './HqPlusText'
import { HqPlusThreadComposer } from './HqPlusThreadComposer'
import { canFinishHqPlusCard, finishHqPlusCard } from './hq-plus-actions'
import type { HqPlusLinkClick } from './hq-plus-link-open'

export type HqPlusOtherWait = {
  id: string
  who: string | null
  title: string
  /** What was saved with it: the message, the source line. */
  detail: string | null
  /** The thread or link it came from. */
  link: string | null
  project: string | null
  at: number
  /** The chat that asked, when there is one. */
  sessionId: string | null
  /** Custom build (hq-plus-round6): the tags HQ+ keeps in the detail; `detail` is the rest. */
  rawDetail: string | null
  task: string | null
  snoozedUntil: number | null
  checked: string | null
}

export type HqPlusQueueActions = {
  hqPath: string | null
  hqWorktreeId: string | null
  now: number
  onJump: (card: HqPlusCard) => void
  openChat: (sessionId: string | null) => (() => void) | null
  onNotNow: (card: HqPlusCard) => void
  onChanged: () => void
  /** Custom build (hq-plus-round6): a link opens in HQ+'s Browser tab. */
  openLink: (url: string, event?: HqPlusLinkClick) => void
}

function waitingText(card: HqPlusCard): string {
  switch (card.type) {
    case 'approve':
      return card.title.replace(/^Approve:\s*/, '')
    case 'report':
    case 'reply':
    case 'bell':
      return card.title
    case 'move':
    case 'wait':
      return `**${card.project ?? 'HQ'}:** ${card.report?.ask ?? card.title}`
  }
}

function WaitingCard({
  card,
  actions
}: {
  card: HqPlusCard
  actions: HqPlusQueueActions
}): React.JSX.Element {
  const [writing, setWriting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chat = card.type === 'approve' ? null : actions.openChat(card.sessionId)
  const done = (): void => {
    setError(null)
    void finishHqPlusCard(card)
      .then((result) => (result.ok ? actions.onChanged() : setError(result.message)))
      .catch((reason: unknown) => setError(String(reason)))
  }
  return (
    <div className="hqp-qcard">
      <button
        type="button"
        className="hqp-wq"
        onClick={() => {
          actions.onJump(card)
          chat?.()
        }}
      >
        <HqPlusBadges badges={hqPlusLook(card).badges} />
        <span className="hqp-qtext">
          <HqPlusText text={waitingText(card)} />
        </span>
      </button>
      <div className="hqp-qacts">
        {canFinishHqPlusCard(card) ? (
          <button type="button" className="hqp-link" onClick={done}>
            {translate('auto.hqPlus.queue.done', 'Done')}
          </button>
        ) : null}
        <button
          type="button"
          className="hqp-link"
          data-ghost="true"
          onClick={() => actions.onNotNow(card)}
        >
          {translate('auto.hqPlus.notNow', 'Not now')}
        </button>
        {card.sessionId || card.address ? (
          <button
            type="button"
            className="hqp-link"
            aria-expanded={writing}
            onClick={() => setWriting(!writing)}
          >
            {translate('auto.hqPlus.queue.tell', 'Tell the chat')}
          </button>
        ) : null}
      </div>
      <Collapsible open={writing} onOpenChange={setWriting}>
        <CollapsibleContent animation="height">
          <HqPlusThreadComposer
            target={{
              address: card.address,
              sessionId: card.sessionId,
              replyTo: card.entry?.id ?? null,
              about: card.title
            }}
            openQuestion={null}
            label={card.address ?? card.project ?? 'chat'}
            hqPath={actions.hqPath}
            onSent={actions.onChanged}
          />
        </CollapsibleContent>
      </Collapsible>
      {error ? <p className="hqp-error">{error}</p> : null}
    </div>
  )
}

export function HqPlusWaitingQueue({
  waiting,
  actions
}: {
  waiting: readonly HqPlusCard[]
  actions: HqPlusQueueActions
}): React.JSX.Element {
  return (
    <HqPlusSideBlock
      id="waiting"
      tone="move"
      title={translate('auto.hqPlus.side.waitingOnYou', 'waiting on you · {{count}}', {
        count: waiting.length
      })}
    >
      {waiting.length > 0 ? (
        waiting.map((card) => <WaitingCard key={card.id} card={card} actions={actions} />)
      ) : (
        <p className="hqp-empty">{translate('auto.hqPlus.side.allDone', 'all decided')}</p>
      )}
    </HqPlusSideBlock>
  )
}

export function HqPlusWeWaitQueue({
  waits,
  actions
}: {
  waits: readonly HqPlusOtherWait[]
  actions: HqPlusQueueActions
}): React.JSX.Element | null {
  if (waits.length === 0) {
    return null
  }
  // Custom build (hq-plus-round6): a linked task goes to Tracked (folded); a snooze sits last, quiet.
  const { chase, tracked, snoozed } = hqPlusWaitGroups(waits, actions.now)
  return (
    <>
      <HqPlusSideBlock
        id="weWait"
        title={translate('auto.hqPlus.side.weWait', 'we wait for · {{count}}', {
          count: chase.length
        })}
      >
        {chase.map((wait) => (
          <HqPlusWeWaitCard key={wait.id} wait={wait} actions={actions} />
        ))}
        {snoozed.length > 0 ? (
          <div className="hqp-snoozed">
            {snoozed.map((wait) => (
              <HqPlusWeWaitCard key={wait.id} wait={wait} actions={actions} />
            ))}
          </div>
        ) : null}
      </HqPlusSideBlock>
      {tracked.length > 0 ? (
        <HqPlusSideBlock
          id="tracked"
          startFolded
          title={translate('auto.hqPlus.side.tracked', 'tracked · {{count}}', {
            count: tracked.length
          })}
        >
          {tracked.map((wait) => (
            <HqPlusWeWaitCard key={wait.id} wait={wait} actions={actions} />
          ))}
        </HqPlusSideBlock>
      ) : null}
    </>
  )
}
