// Custom build (hq-plus-ui): HQ+'s left column — what waits on the owner, numbered as it stands in the
// log; the chats the dispatcher keeps; and three plain numbers about the day.
import type { HqPlusCard } from '../../../../../shared/hq-plus-log'
import type { HqLiveSession } from '../../../../../shared/hq-sessions'
import type { HqPlusScreenStats } from '../../../../../shared/hq-plus-screen'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'

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
    case 'move':
    case 'wait':
      return `${card.project ?? 'HQ'}: ${short(card.report?.ask ?? card.title)}`
  }
}

const STATE_COLOR: Record<HqLiveSession['state'], string> = {
  working: 'var(--hqp-green)',
  waiting: 'var(--hqp-amber)',
  done: 'var(--hqp-ice)',
  closed: 'var(--hqp-faint)'
}

function stateLabel(session: HqLiveSession): string {
  if (session.midTurn && session.state === 'waiting') {
    return translate('auto.hqPlus.side.prompt', 'asks permission')
  }
  switch (session.state) {
    case 'working':
      return translate('auto.hqPlus.side.working', 'working')
    case 'waiting':
      return translate('auto.hqPlus.side.waiting', 'waits on you')
    case 'done':
      return translate('auto.hqPlus.side.done', 'done')
    case 'closed':
      return translate('auto.hqPlus.side.closed', 'closed')
  }
}

export function HqPlusSide({
  waiting,
  sessions,
  stats,
  picked,
  now,
  roomColor,
  onJump,
  onPickSession
}: {
  waiting: HqPlusCard[]
  sessions: HqLiveSession[]
  stats: HqPlusScreenStats | null
  picked: string | null
  now: number
  roomColor: (room: string) => string | null
  onJump: (card: HqPlusCard) => void
  onPickSession: (session: HqLiveSession) => void
}): React.JSX.Element {
  return (
    <aside
      className="hqp-side"
      aria-label={translate('auto.hqPlus.side.label', 'Waiting on you and chats')}
    >
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
      <div>
        <div className="hqp-hl hqp-side-h">
          {translate('auto.hqPlus.side.sessions', 'HQ chats')}
        </div>
        {sessions.length === 0 ? (
          <p className="hqp-empty hqp-quiet">
            {translate('auto.hqPlus.side.noSessions', 'no live chats')}
          </p>
        ) : null}
        {sessions.map((session) => (
          <button
            key={session.sessionId}
            type="button"
            className="hqp-qi ses"
            aria-current={picked === session.sessionId ? 'true' : undefined}
            onClick={() => onPickSession(session)}
          >
            <span className="hqp-dot" style={dotStyle(STATE_COLOR[session.state])} />
            <span className="t">{session.name ?? session.address ?? session.project ?? '—'}</span>
            <span className="ag">{stateLabel(session)}</span>
            <span className="s">
              {[session.address ?? session.project, formatRelativeTime(session.lastActivityAt, now)]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </button>
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
                : translate('auto.hqPlus.stat.manualHintBare', 'hand-offs, checks, «what next» today')}
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
