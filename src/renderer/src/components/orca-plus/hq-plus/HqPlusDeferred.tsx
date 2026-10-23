// Custom build (hq-plus-ui-v5): chats that went quiet with their work unfinished (classic HQ's
// «Deferred»), as one feed line that unfolds into the list, and as a section of the Agents tab.
// Each row: Open in Session, Resume (continue, or the waiting handoff), Close for this quiet spell.
import { useState } from 'react'
import { launchClaudeHandoffOffer } from '@/app-shell/use-claude-handoff-offers'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { useLiveDashboardSnapshot } from '../../dashboard/useLiveDashboardSnapshot'
import { hqDeferredReasonLabel, revealHqDeferredCard } from '../hq/HqDeferredStrip'
import type { HqDeferredSession } from '../hq/hq-deferred-sessions'
import { sendHqAgentMessage, type HqActionResult } from '../hq/hq-today-actions'
import { useHqDeferredSessions } from '../hq/use-hq-deferred-sessions'
import type { HqPlusTile } from './HqPlusSide'

export function useHqPlusDeferred(): ReturnType<typeof useHqDeferredSessions> {
  return useHqDeferredSessions(useLiveDashboardSnapshot().cards)
}

export function hqPlusDeferredTitle(count: number): string {
  return count === 0
    ? translate('auto.hqPlus.deferred.none', 'No chat is left with unfinished work')
    : count === 1
      ? translate('auto.hqPlus.deferred.one', '1 chat went quiet with unfinished work')
      : translate('auto.hqPlus.deferred.many', '{{count}} chats went quiet with unfinished work', {
          count
        })
}

function tileStyle(
  color: string | null
): (React.CSSProperties & Record<'--hqp-room', string>) | undefined {
  return color ? { '--hqp-room': color } : undefined
}

function DeferredRow({
  session,
  now,
  tileOf,
  onOpen,
  onClose
}: {
  session: HqDeferredSession
  now: number
  tileOf: (repoName: string) => HqPlusTile
  onOpen: (paneKey: string) => (() => void) | null
  onClose: (session: HqDeferredSession) => void
}): React.JSX.Element {
  const { card, handoffId } = session
  const [result, setResult] = useState<HqActionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const tile = tileOf(card.repoName)
  const resume = (): void => {
    if (handoffId) {
      void launchClaudeHandoffOffer(handoffId)
      return
    }
    setBusy(true)
    sendHqAgentMessage(card, translate('auto.hq.today.continueText', 'Continue'))
      .then(setResult)
      .finally(() => setBusy(false))
  }
  return (
    <li className="hqp-dfr">
      <span className="hqp-tile" style={tileStyle(tile.color)} aria-hidden="true">
        {tile.letters}
      </span>
      <span className="hqp-dfr-main">
        <span className="hqp-dfr-h">
          <strong>{card.conversationName || card.task || card.agentType}</strong>
          <span className="hqp-dfr-when">
            {translate('auto.hq.deferred.quiet', 'quiet {{value0}}', {
              value0: formatShortTimeAgo(session.silentSince, now)
            })}
          </span>
        </span>
        <span className="hqp-dfr-meta">
          {card.repoName}
          {session.reasons.map((reason) => (
            <span key={reason.kind} className="hqp-chip">
              {hqDeferredReasonLabel(reason)}
            </span>
          ))}
        </span>
        {result && !result.ok ? <span className="hqp-err">{result.message}</span> : null}
      </span>
      <span className="hqp-dfr-acts">
        <button
          type="button"
          className="hqp-pill"
          onClick={() => (onOpen(card.paneKey) ?? (() => revealHqDeferredCard(card)))()}
        >
          {translate('auto.hqPlus.open', 'Open')}
        </button>
        <button
          type="button"
          className="hqp-pill"
          disabled={busy || result?.ok === true}
          onClick={resume}
        >
          {result?.ok
            ? translate('auto.hq.today.sent', 'Sent.')
            : translate('auto.hqPlus.deferred.resume', 'Resume')}
        </button>
        <button type="button" className="hqp-pill" onClick={() => onClose(session)}>
          {translate('auto.hq.deferred.close', 'Close')}
        </button>
      </span>
    </li>
  )
}

export function HqPlusDeferredList({
  sessions,
  close,
  now,
  tileOf,
  onOpen
}: {
  sessions: readonly HqDeferredSession[]
  close: (session: HqDeferredSession) => void
  now: number
  tileOf: (repoName: string) => HqPlusTile
  onOpen: (paneKey: string) => (() => void) | null
}): React.JSX.Element {
  return (
    <ul className="hqp-dfr-list">
      {sessions.map((session) => (
        <DeferredRow
          key={session.card.paneKey}
          session={session}
          now={now}
          tileOf={tileOf}
          onOpen={onOpen}
          onClose={close}
        />
      ))}
    </ul>
  )
}
