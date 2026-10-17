// Custom build (hq): the HQ «Today» tab — the morning briefing kept live: a command line to HQ's
// Claude (typed or dictated), agents and waitings that need a move, new ClickUp tasks and deadlines, open reviews and limits.
import { useId, useRef, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useLiveDashboardSnapshot } from '../../dashboard/useLiveDashboardSnapshot'
import { HqCommandDictation } from './HqCommandDictation'
import { askHq } from './hq-ask-chat'
import { findHqWorktreeId } from './hq-today-actions'
import { HqTodayAgents, HqTodayWaitings } from './HqTodayPeople'
import { HqTodayReviewRequests } from './HqTodayReviewRequests'
import { HqTodayTriage } from './HqTodayTriage'
import { HqTodayDeadlines, HqTodayLimits } from './HqTodayWork'
import { HqTodayReviews } from './HqTodayWorkspaceReviews'
import { HqTodaySlackDrafts } from './HqTodaySlackDrafts'
import { useHqPulse } from './use-hq-pulse'

const AGE_TICK_MS = 60_000

export function HqCommandBox({
  hqWorktreeId,
  compact = false
}: {
  hqWorktreeId: string | null
  /** Custom build (hq-today-inbox): a short hint for Today's narrow list column. */
  compact?: boolean
}): React.JSX.Element {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const inputId = useId()
  // Custom build (hq-ask): every question goes to the one standing «Ask HQ» chat.
  const submit = (): void => {
    const question = text
    if (!hqWorktreeId || !question.trim() || busy) {
      return
    }
    setBusy(true)
    setText('')
    setError(null)
    void askHq(hqWorktreeId, question)
      .then((result) => {
        if (!result.ok) {
          setText(question)
          setError(result.message)
        }
      })
      .finally(() => setBusy(false))
  }
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <div className="flex items-end gap-2">
        {/* Why: without a visible name the box read as an empty bar and the owner could not find it. */}
        <span className="flex h-9 shrink-0 items-center gap-1.5">
          <Sparkles className="size-4 text-primary" />
          <Label htmlFor={inputId}>{translate('auto.hq.today.ask', 'Ask HQ')}</Label>
        </span>
        <Textarea
          id={inputId}
          ref={textareaRef}
          className="min-h-9 flex-1 resize-none"
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              submit()
            }
          }}
          placeholder={
            compact
              ? translate('auto.hq.today.askShort', 'Ask HQ anything…')
              : translate(
                  'auto.hq.today.askPlaceholder',
                  'What did we decide about…, what did I write to…, a task — or a command'
                )
          }
          disabled={!hqWorktreeId}
        />
        <HqCommandDictation textareaRef={textareaRef} disabled={!hqWorktreeId} />
        <Button type="submit" disabled={!hqWorktreeId || !text.trim() || busy}>
          {translate('auto.hq.today.askButton', 'Ask')}
        </Button>
      </div>
      {hqWorktreeId ? null : (
        <p className="text-xs text-muted-foreground">
          {translate(
            'auto.hq.today.addHqProject',
            'Add the HQ folder as a project in Orca to run reminders and commands.'
          )}
        </p>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </form>
  )
}

export function HqTodayTab(): React.JSX.Element {
  const snapshot = useLiveDashboardSnapshot()
  const pulse = useHqPulse()
  const now = useNow(AGE_TICK_MS)
  const hqWorktreeId = useAppStore((s) =>
    findHqWorktreeId(s.settings?.hqPath, s.repos, s.worktreesByRepo)
  )
  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-6 overflow-y-auto p-4">
      <HqCommandBox hqWorktreeId={hqWorktreeId} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-6">
          <HqTodayAgents cards={snapshot.cards} now={now} />
          {pulse.status === 'ready' ? (
            <HqTodayWaitings
              waitings={pulse.pulse.waitings}
              people={pulse.pulse.people}
              hqWorktreeId={hqWorktreeId}
              now={now}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              {pulse.status === 'loading'
                ? translate('auto.hq.waiting.loading', 'Loading…')
                : translate('auto.hq.waiting.loadFailed', "Couldn't read waitings: {{value0}}", {
                    value0: pulse.message
                  })}
            </p>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <HqTodayTriage now={now} cards={snapshot.cards} />
          <HqTodaySlackDrafts />
          <HqTodayDeadlines now={now} />
          <HqTodayReviewRequests now={now} />
          <HqTodayReviews workspaces={snapshot.workspaces ?? []} />
          <HqTodayLimits />
        </div>
      </div>
    </div>
  )
}
