// Custom build (hq-plus-ui): HQ+'s left column — the live chats (the same list the classic HQ shows, so a
// chat started a second ago is there); what waits on the owner, numbered as it stands in the log; and
// three plain numbers about the day.
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import type { HqPlusScreenStats } from '../../../../../shared/hq-plus-screen'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import type { HqChatGroup, HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'

const SHORT = 30

function short(text: string): string {
  return text.length > SHORT ? `${text.slice(0, SHORT - 1)}…` : text
}

function dotStyle(color: string): React.CSSProperties & Record<'--hqp-dot', string> {
  return { '--hqp-dot': color }
}

function waitingLabel(card: HqPlusCard): string {
  switch (card.type) {
    case 'approve':
      return translate('auto.hqPlus.side.approve', 'Approve · {{what}}', {
        what: short(card.title.replace(/^Approve:\s*/, ''))
      })
    case 'report':
      return translate('auto.hqPlus.side.report', 'Report · {{what}}', { what: short(card.title) })
    case 'reply':
      return translate('auto.hqPlus.side.reply', 'Answer · {{what}}', { what: short(card.title) })
    case 'bell':
      return short(card.title)
    case 'move':
    case 'wait':
      return `${card.project ?? 'HQ'}: ${short(card.report?.ask ?? card.title)}`
  }
}

const GROUP_COLOR: Record<HqChatGroup, string> = {
  needs: 'var(--hqp-amber)',
  working: 'var(--hqp-green)',
  done: 'var(--hqp-ice)',
  quiet: 'var(--hqp-faint)'
}

function groupLabel(group: HqChatGroup): string {
  switch (group) {
    case 'needs':
      return translate('auto.hqPlus.side.waiting', 'waits on you')
    case 'working':
      return translate('auto.hqPlus.side.working', 'working')
    case 'done':
      return translate('auto.hqPlus.side.done', 'done')
    case 'quiet':
      return translate('auto.hqPlus.side.quiet', 'quiet')
  }
}

function ChatRow({
  item,
  picked,
  now,
  onPick
}: {
  item: HqChatItem
  picked: boolean
  now: number
  onPick: (item: HqChatItem) => void
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  return (
    <button
      type="button"
      className="hqp-qi ses"
      aria-current={picked ? 'true' : undefined}
      onClick={() => onPick(item)}
    >
      <span className="hqp-dot" style={dotStyle(GROUP_COLOR[item.group])} />
      <span className="t">{title}</span>
      <span className="ag">{groupLabel(item.group)}</span>
      <span className="s">
        {[item.projectName, item.sortAt ? formatRelativeTime(item.sortAt, now) : null]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </button>
  )
}

export function HqPlusSide({
  waiting,
  chats,
  stats,
  picked,
  now,
  roomColor,
  onJump,
  onPickChat
}: {
  waiting: HqPlusCard[]
  chats: HqChatItem[]
  stats: HqPlusScreenStats | null
  /** The key of the chat open on the right. */
  picked: string | null
  now: number
  roomColor: (room: string) => string | null
  onJump: (card: HqPlusCard) => void
  onPickChat: (item: HqChatItem) => void
}): React.JSX.Element {
  return (
    <aside
      className="hqp-side"
      aria-label={translate('auto.hqPlus.side.label', 'Waiting on you and chats')}
    >
      <div>
        <div className="hqp-hl hqp-side-h">
          {translate('auto.hqPlus.side.chats', 'chats · {{count}}', { count: chats.length })}
        </div>
        {chats.length === 0 ? (
          <p className="hqp-empty hqp-quiet">
            {translate('auto.hqPlus.side.noSessions', 'no live chats')}
          </p>
        ) : null}
        {chats.map((item) => (
          <ChatRow
            key={item.key}
            item={item}
            picked={picked === item.key}
            now={now}
            onPick={onPickChat}
          />
        ))}
      </div>
      <div>
        <div className="hqp-hl hqp-side-h">
          {translate('auto.hqPlus.side.waitingOnYou', 'waiting on you · {{count}}', {
            count: waiting.length
          })}
        </div>
        {waiting.length > 0 ? (
          waiting.map((card, index) => (
            <button key={card.id} type="button" className="hqp-qi" onClick={() => onJump(card)}>
              <span className="n">{index + 1}</span>
              <span
                className="t"
                style={dotStyle(
                  card.type === 'report' || card.type === 'reply'
                    ? 'var(--hqp-violet)'
                    : card.type === 'approve'
                      ? 'var(--hqp-rose)'
                      : (roomColor(card.room) ?? 'var(--hqp-ice)')
                )}
              >
                <i aria-hidden="true" />
                {waitingLabel(card)}
              </span>
              <span className="ag">{formatRelativeTime(card.at, now)}</span>
            </button>
          ))
        ) : (
          <p className="hqp-empty">{translate('auto.hqPlus.side.allDone', 'all decided')}</p>
        )}
      </div>
      <div className="hqp-stats">
        <div className="hqp-st">
          <span>
            {translate('auto.hqPlus.stat.journal', 'Journal, 24 hours')}
            <small>{translate('auto.hqPlus.stat.journalHint', 'every event in every room')}</small>
          </span>
          <b>{stats ? stats.journalDay.toLocaleString() : '—'}</b>
        </div>
        <div className="hqp-st">
          <span>
            {translate('auto.hqPlus.stat.manual', 'Done by you by hand')}
            <small>
              {stats?.manual?.perDay
                ? translate(
                    'auto.hqPlus.stat.manualHint',
                    'hand-offs, checks, «what next» today; was ~{{perDay}} a day',
                    { perDay: Math.round(stats.manual.perDay) }
                  )
                : translate(
                    'auto.hqPlus.stat.manualHintBare',
                    'hand-offs, checks, «what next» today'
                  )}
            </small>
          </span>
          <b>{stats?.manual ? stats.manual.today : '—'}</b>
        </div>
        <div className="hqp-st">
          <span>
            {translate('auto.hqPlus.stat.plan', 'HQ+ plan')}
            <small>
              {stats?.plan?.next
                ? translate('auto.hqPlus.stat.planNext', 'next: {{step}}', {
                    step: stats.plan.next
                  })
                : translate('auto.hqPlus.stat.planHint', 'steps of the plan in HQ/hq-plus.yaml')}
            </small>
          </span>
          <b>
            {stats?.plan
              ? translate('auto.hqPlus.stat.planCount', '{{done}} of {{total}}', {
                  done: stats.plan.done,
                  total: stats.plan.total
                })
              : '—'}
          </b>
        </div>
      </div>
    </aside>
  )
}
