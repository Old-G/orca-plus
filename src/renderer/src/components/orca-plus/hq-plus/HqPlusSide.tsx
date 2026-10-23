// Custom build (hq-plus-ui): HQ+'s left column — what waits on the owner (with the same badge as its card
// in the feed), what we wait for from people, the FYI pile to clear in one go, the live chats (the same
// list the classic HQ shows, so a chat started a second ago is there), and three plain numbers.
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import { hqPlusLook } from '../../../../../shared/hq-plus-kinds'
import { HqPlusBadges } from './HqPlusBadge'
import type { HqPlusScreenStats } from '../../../../../shared/hq-plus-screen'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import type { HqChatGroup, HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'

// Why: the column can be dragged wider; CSS clamps the text to two lines.
const SHORT = 140
// Why: the oldest few are the ones to chase; the whole list lives in Notes.
const WE_WAIT_SHOWN = 6

function short(text: string): string {
  return text.length > SHORT ? `${text.slice(0, SHORT - 1)}\u2026` : text
}

function dotStyle(color: string): React.CSSProperties & Record<'--hqp-dot', string> {
  return { '--hqp-dot': color }
}

function waitingLabel(card: HqPlusCard): string {
  switch (card.type) {
    case 'approve':
      return short(card.title.replace(/^Approve:\s*/, ''))
    case 'report':
    case 'reply':
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

export type HqPlusTile = { letters: string; color: string | null }

function tileStyle(
  color: string | null
): (React.CSSProperties & Record<'--hqp-room', string>) | undefined {
  return color ? { '--hqp-room': color } : undefined
}

function ChatRow({
  item,
  picked,
  now,
  tile,
  onPick
}: {
  item: HqChatItem
  picked: boolean
  now: number
  tile: HqPlusTile
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
      <span className="hqp-tile" style={tileStyle(tile.color)} aria-hidden="true">
        {tile.letters}
      </span>
      <span className="t">
        <span className="hqp-dot" style={dotStyle(GROUP_COLOR[item.group])} />
        {title}
      </span>
      <span className="ag">{groupLabel(item.group)}</span>
      <span className="s">
        {[item.projectName, item.sortAt ? formatRelativeTime(item.sortAt, now) : null]
          .filter(Boolean)
          .join(' · ')}
      </span>
    </button>
  )
}

export type HqPlusOtherWait = { id: string; who: string; title: string; at: number }

export function HqPlusSide({
  waiting,
  fyi,
  waitsOnThem,
  chats,
  stats,
  picked,
  now,
  tileOf,
  onJump,
  onPickChat,
  onClearFyi
}: {
  waiting: HqPlusCard[]
  /** Open items for the owner's information only. */
  fyi: HqPlusCard[]
  /** What we wait for from people, oldest first. */
  waitsOnThem: HqPlusOtherWait[]
  chats: HqChatItem[]
  stats: HqPlusScreenStats | null
  /** The key of the chat open on the right. */
  picked: string | null
  now: number
  tileOf: (item: HqChatItem) => HqPlusTile
  onJump: (card: HqPlusCard) => void
  onPickChat: (item: HqChatItem) => void
  onClearFyi: () => void
}): React.JSX.Element {
  return (
    <aside
      className="hqp-side"
      aria-label={translate('auto.hqPlus.side.label', 'Waiting on you and chats')}
    >
      <div className="hqp-side-sec" data-list="waiting">
        <div className="hqp-hl hqp-side-h" data-tone="move">
          {translate('auto.hqPlus.side.waitingOnYou', 'waiting on you · {{count}}', {
            count: waiting.length
          })}
        </div>
        {waiting.length > 0 ? (
          waiting.map((card) => (
            <button key={card.id} type="button" className="hqp-wq" onClick={() => onJump(card)}>
              <HqPlusBadges badges={hqPlusLook(card).badges} />
              <span>{waitingLabel(card)}</span>
            </button>
          ))
        ) : (
          <p className="hqp-empty">{translate('auto.hqPlus.side.allDone', 'all decided')}</p>
        )}
      </div>
      {waitsOnThem.length > 0 ? (
        <div className="hqp-side-sec">
          <div className="hqp-hl hqp-side-h">
            {translate('auto.hqPlus.side.weWait', 'we wait for · {{count}}', {
              count: waitsOnThem.length
            })}
          </div>
          {waitsOnThem.slice(0, WE_WAIT_SHOWN).map((wait) => (
            <div key={wait.id} className="hqp-wf" title={wait.title}>
              <span>
                {wait.who} · {wait.title}
              </span>
              <span className="ag">{formatRelativeTime(wait.at, now)}</span>
            </div>
          ))}
          {waitsOnThem.length > WE_WAIT_SHOWN ? (
            <p className="hqp-empty hqp-quiet">
              {translate('auto.hqPlus.side.weWaitMore', '+{{count}} more in Notes', {
                count: waitsOnThem.length - WE_WAIT_SHOWN
              })}
            </p>
          ) : null}
        </div>
      ) : null}
      {fyi.length > 0 ? (
        <div className="hqp-fyi">
          <span>
            {translate('auto.hqPlus.side.fyi', 'FYI · {{count}} — shown in the feed', {
              count: fyi.length
            })}
          </span>
          <button type="button" className="hqp-pill" onClick={onClearFyi}>
            {translate('auto.hqPlus.side.clearFyi', 'Clear all')}
          </button>
        </div>
      ) : null}
      <div className="hqp-side-sec">
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
            tile={tileOf(item)}
            onPick={onPickChat}
          />
        ))}
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
