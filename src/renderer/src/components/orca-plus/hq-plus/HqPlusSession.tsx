// Custom build (hq-plus-ui): Сессия — the picked chat's state, its project card (the same card a new chat
// gets at start), the thread's history, and «give it work», which the dispatcher routes to the live
// chat, a new one, or the queue.
import { HqPlusReplyField } from './HqPlusReplyField'
import { useEffect, useState } from 'react'
import type { HqLiveSession } from '../../../../../shared/hq-sessions'
import type { HqJournalEntry } from '../../../../../shared/hq-journal'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { hqPlusCall } from './use-hq-plus-data'
import { hqResultField, isHqJournalEntries } from '../../../../../shared/hq-plus-rpc-readers'

export type HqPlusPick = {
  project: string | null
  address: string | null
  sessionId: string | null
  name: string | null
}

const HISTORY = 12

function readLines(value: unknown): string[] {
  const lines = hqResultField(value, 'lines')
  return Array.isArray(lines)
    ? lines.filter((line): line is string => typeof line === 'string')
    : []
}

function readEntries(value: unknown): HqJournalEntry[] {
  const entries = hqResultField(value, 'entries')
  return isHqJournalEntries(entries) ? entries : []
}

function readNote(value: unknown): string {
  const note = hqResultField(value, 'note')
  return typeof note === 'string' ? note : ''
}

const callerOf = (hqPath: string | null): { callerCwd?: string } =>
  hqPath ? { callerCwd: hqPath } : {}

export function HqPlusSession({
  pick,
  live,
  hqPath,
  now,
  scoped,
  onScope,
  onOpenChat,
  onDispatched,
  onBack
}: {
  pick: HqPlusPick | null
  live: HqLiveSession | null
  hqPath: string | null
  now: number
  scoped: boolean
  onScope: () => void
  onOpenChat: (() => void) | null
  onDispatched: () => void
  /** Custom build (hq-plus-ui-v3): back to the River or Graph this project was picked from. */
  onBack: { label: string; go: () => void } | null
}): React.JSX.Element {
  const [card, setCard] = useState<string[]>([])
  const [history, setHistory] = useState<HqJournalEntry[]>([])
  const [work, setWork] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const project = pick?.project ?? null
  const address = pick?.address ?? null

  useEffect(() => {
    setCard([])
    if (!project) {
      return
    }
    let alive = true
    void hqPlusCall('hq.context', { project, ...callerOf(hqPath) }).then((result) => {
      if (alive) {
        setCard(result.ok ? readLines(result.result) : [result.message])
      }
    })
    return () => {
      alive = false
    }
  }, [project, hqPath])

  useEffect(() => {
    setHistory([])
    if (!address) {
      return
    }
    let alive = true
    void hqPlusCall('hq.thread', { address, ...callerOf(hqPath) }).then((result) => {
      if (alive && result.ok) {
        setHistory(readEntries(result.result).slice(-HISTORY).toReversed())
      }
    })
    return () => {
      alive = false
    }
  }, [address, hqPath, live?.lastActivityAt])

  if (!pick) {
    return (
      <p className="hqp-empty hqp-quiet">
        {translate('auto.hqPlus.session.pick', 'Pick a chat on the left, or a lane in the River.')}
      </p>
    )
  }

  const dispatch = (): void => {
    if (!address || !work.trim() || busy) {
      return
    }
    setBusy(true)
    setNote(null)
    void hqPlusCall('hq.dispatch', { address, prompt: work.trim(), ...callerOf(hqPath) })
      .then((result) => {
        setNote(
          result.ok
            ? readNote(result.result) || translate('auto.hqPlus.session.sent', 'Handed over.')
            : result.message
        )
        if (result.ok) {
          setWork('')
          onDispatched()
        }
      })
      .finally(() => setBusy(false))
  }

  return (
    <div className="hqp-sess">
      {onBack ? (
        <button type="button" className="hqp-pill hqp-back" onClick={onBack.go}>
          ← {onBack.label}
        </button>
      ) : null}
      <div>
        <div className="hqp-mono">{address ?? project ?? ''}</div>
        <h2>{pick.name ?? project ?? address ?? '—'}</h2>
      </div>
      <div className="hqp-kv">
        <div>
          <span>{translate('auto.hqPlus.session.stateLabel', 'state')}</span>
          <b>
            {live
              ? live.midTurn
                ? translate('auto.hqPlus.session.midTurn', 'mid-turn')
                : live.state
              : '—'}
          </b>
        </div>
        <div>
          <span>{translate('auto.hqPlus.session.context', 'context')}</span>
          <b>{live?.contextPct == null ? '—' : `${Math.round(live.contextPct)}%`}</b>
        </div>
        <div>
          <span>{translate('auto.hqPlus.session.last', 'last')}</span>
          <b>{live ? formatRelativeTime(live.lastActivityAt, now) : '—'}</b>
        </div>
      </div>
      {card.length > 0 ? (
        <div className="hqp-lines">
          {card.map((text, position) =>
            /^#{1,3} /.test(text) ? (
              <p key={`${position}:${text}`} className="h">
                {text.replace(/^#{1,3} /, '')}
              </p>
            ) : (
              <p key={`${position}:${text}`}>{text}</p>
            )
          )}
        </div>
      ) : null}
      {history.length > 0 ? (
        <div>
          <div className="hqp-hl">{translate('auto.hqPlus.session.history', 'thread')}</div>
          <ul className="hqp-hist">
            {history.map((entry) => (
              <li key={entry.id}>
                {formatRelativeTime(entry.at, now)} · {entry.title}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {address ? (
        <form
          className="hqp-reply"
          onSubmit={(event) => {
            event.preventDefault()
            dispatch()
          }}
        >
          <label className="hqp-sr" htmlFor="hqp-dispatch">
            {translate('auto.hqPlus.session.work', 'Work for this thread')}
          </label>
          <HqPlusReplyField
            id="hqp-dispatch"
            placeholder={translate('auto.hqPlus.session.workHint', 'Give this thread work…')}
            value={work}
            disabled={busy}
            onChange={(event) => setWork(event.target.value)}
          />
          <span className="hqp-to">→ {address}</span>
          <button
            type="submit"
            className="hqp-go"
            disabled={busy || !work.trim()}
            aria-label={translate('auto.hqPlus.session.dispatch', 'Dispatch')}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </form>
      ) : null}
      {note ? <p className="hqp-text">{note}</p> : null}
      <div className="hqp-opts">
        <button type="button" className="hqp-opt" data-main="true" onClick={onScope}>
          {scoped
            ? translate('auto.hqPlus.session.unscope', 'Show the whole log')
            : translate('auto.hqPlus.session.scope', 'Only this thread in the log')}
        </button>
        {onOpenChat ? (
          <button type="button" className="hqp-opt" onClick={onOpenChat}>
            {translate('auto.hqPlus.openChat', 'Open chat')}
          </button>
        ) : null}
      </div>
    </div>
  )
}
