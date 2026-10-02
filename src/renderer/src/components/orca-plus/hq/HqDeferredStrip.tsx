// Custom build (hq): the «Deferred» strip over HQ's agent board — sessions that went quiet with
// their work unfinished, each with Open, Continue (or a new session from its handoff) and Close.
import { useState } from 'react'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import { Button } from '@/components/ui/button'
import { launchClaudeHandoffOffer } from '@/app-shell/use-claude-handoff-offers'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import { revealDashboardAgent } from '../../dashboard/reveal-dashboard-agent'
import type { HqDeferredReason, HqDeferredSession } from './hq-deferred-sessions'
import { sendHqAgentMessage, type HqActionResult } from './hq-today-actions'
import { ColumnHeader } from './hq-waiting-parts'

function reasonLabel(reason: HqDeferredReason): string {
  switch (reason.kind) {
    case 'changes':
      return translate('auto.hq.deferred.changes', '{{value0}} uncommitted', {
        value0: String(reason.count)
      })
    case 'ahead':
      return translate('auto.hq.deferred.ahead', '{{value0}} unpushed', {
        value0: String(reason.count)
      })
    case 'asks':
      return translate('auto.hq.deferred.asks', 'asks you')
    case 'interrupted':
      return translate('auto.hq.deferred.interrupted', 'interrupted')
    case 'limit':
      return translate('auto.hq.deferred.limit', 'hit a limit')
    case 'handoff':
      return translate('auto.hq.deferred.handoff', 'handoff ready')
  }
}

function reveal(card: DashboardCard): void {
  revealDashboardAgent({
    repoId: card.repoId,
    worktreeId: card.worktreeId,
    executionHostId: card.executionHostId,
    tabId: card.tabId,
    leafId: card.leafId
  })
}

function DeferredCard({
  session,
  now,
  onClose
}: {
  session: HqDeferredSession
  now: number
  onClose: (session: HqDeferredSession) => void
}): React.JSX.Element {
  const { card, handoffId } = session
  const [result, setResult] = useState<HqActionResult | null>(null)
  const [busy, setBusy] = useState(false)
  const nudge = (): void => {
    setBusy(true)
    sendHqAgentMessage(card, translate('auto.hq.today.continueText', 'Continue'))
      .then(setResult)
      .finally(() => setBusy(false))
  }
  return (
    <li className="flex w-72 shrink-0 flex-col @max-md/hq:w-full gap-1.5 rounded-lg border border-border bg-card p-3 text-card-foreground">
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-sm">
          {card.conversationName || card.task || card.agentType}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {translate('auto.hq.deferred.quiet', 'quiet {{value0}}', {
            value0: formatShortTimeAgo(session.silentSince, now)
          })}
        </span>
      </div>
      <span className="truncate text-xs text-muted-foreground">
        {card.repoName} · {card.worktreeName}
      </span>
      {card.lastAgentMessage ? (
        <p className="truncate text-xs text-muted-foreground" title={card.lastAgentMessage}>
          {card.lastAgentMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {session.reasons.map((reason) => (
          <span
            key={reason.kind}
            className="rounded-full border border-border px-1.5 py-px text-[11px] text-muted-foreground"
          >
            {reasonLabel(reason)}
          </span>
        ))}
      </div>
      {result && !result.ok ? <p className="text-xs text-destructive">{result.message}</p> : null}
      <div className="mt-auto flex items-center justify-end gap-1">
        <Button type="button" size="xs" variant="ghost" onClick={() => onClose(session)}>
          {translate('auto.hq.deferred.close', 'Close')}
        </Button>
        {handoffId ? (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            onClick={() => void launchClaudeHandoffOffer(handoffId)}
          >
            {translate('auto.hq.deferred.newSession', 'New session')}
          </Button>
        ) : (
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={busy || result?.ok === true}
            onClick={nudge}
          >
            {result?.ok
              ? translate('auto.hq.today.sent', 'Sent.')
              : translate('auto.hq.today.continue', 'Continue')}
          </Button>
        )}
        <Button type="button" size="xs" variant="secondary" onClick={() => reveal(card)}>
          {translate('auto.hq.project.open', 'Open')}
        </Button>
      </div>
    </li>
  )
}

export function HqDeferredStrip({
  sessions,
  now,
  onClose
}: {
  sessions: readonly HqDeferredSession[]
  now: number
  onClose: (session: HqDeferredSession) => void
}): React.JSX.Element | null {
  if (sessions.length === 0) {
    return null
  }
  const title = translate('auto.hq.deferred.title', 'Deferred')
  return (
    <section className="flex flex-col gap-2 border-b border-border px-4 py-3" aria-label={title}>
      <ColumnHeader title={title} count={sessions.length} />
      <ul className="scrollbar-sleek flex gap-2 overflow-x-auto pb-1 @max-md/hq:max-h-60 @max-md/hq:flex-col @max-md/hq:overflow-x-hidden @max-md/hq:overflow-y-auto">
        {sessions.map((session) => (
          <DeferredCard key={session.card.paneKey} session={session} now={now} onClose={onClose} />
        ))}
      </ul>
    </section>
  )
}
