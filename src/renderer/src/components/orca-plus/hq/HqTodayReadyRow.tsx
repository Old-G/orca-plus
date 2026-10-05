// Custom build (hq-closing): one «Ready for you» row — a taken task whose agent finished: open the
// session, accept (push + MR), merge, check the spec, draft the ClickUp comment, rework, hours, check.
// The agent does the git work on the owner's click; HQ itself writes only to ClickUp.
import { useEffect, useState } from 'react'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import type { HqAutonomyLevel } from '../../../../../shared/hq-autonomy'
import {
  HQ_CLOSING_MESSAGES,
  hqCommentDraft,
  isHqAgentBusy,
  type HqClosingMessage
} from '../../../../../shared/hq-closing'
import type { HqTriageDecision } from '../../../../../shared/hq-triage'
import type { HostedReviewInfo } from '../../../../../shared/hosted-review'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { revealDashboardAgent } from '../../dashboard/reveal-dashboard-agent'
import { HqReadyHours, HqReadyTextPanel } from './hq-today-ready-panels'

export type HqReadyRowActions = {
  /** Resolves to an error to show, or null once the agent has the message. */
  tell: (text: string) => Promise<string | null>
  /** The agent's last answer in full, for the comment editor. */
  readAnswer: () => Promise<string | null>
  comment: (text: string) => Promise<string | null>
  setHours: (hours: number) => Promise<string | null>
  setCheck: () => Promise<string | null>
  stamp: (patch: Partial<HqTriageDecision>) => void
}

type Panel = 'none' | 'rework' | 'comment'

function agentNote(agent: DashboardCard | null): string {
  if (!agent) {
    return translate('auto.hq.ready.agentGone', 'Agent session closed')
  }
  return isHqAgentBusy(agent)
    ? translate('auto.hq.ready.agentWorking', 'Agent is working…')
    : translate('auto.hq.ready.agentDone', 'Agent finished')
}

function reviewNote(review: HostedReviewInfo): string {
  const label = `${review.provider === 'gitlab' ? '!' : '#'}${review.number}`
  return review.state === 'merged'
    ? translate('auto.hq.ready.reviewMerged', '{{value0}} merged', { value0: label })
    : translate('auto.hq.ready.reviewOpen', '{{value0}} {{value1}}', {
        value0: label,
        value1: review.state
      })
}

/** The MR/PR of the task's branch, looked up again after each agent turn. */
function useTaskReview(
  decision: HqTriageDecision,
  agent: DashboardCard | null
): HostedReviewInfo | null {
  const [review, setReview] = useState<HostedReviewInfo | null>(null)
  const worktree = useAppStore((s) =>
    decision.worktreeId && !decision.coordinator
      ? (Object.values(s.worktreesByRepo)
          .flat()
          .find((entry) => entry.id === decision.worktreeId) ?? null)
      : null
  )
  const repoPath = useAppStore(
    (s) => s.repos.find((repo) => repo.id === worktree?.repoId)?.path ?? null
  )
  const branch = worktree?.branch.replace(/^refs\/heads\//, '') ?? null
  const repoId = worktree?.repoId ?? null
  const finishedAt = agent?.finishedAt ?? null
  useEffect(() => {
    if (!repoPath || !branch || !repoId) {
      return
    }
    let live = true
    void useAppStore
      .getState()
      .fetchHostedReviewForBranch(repoPath, branch, { repoId, force: true })
      .then((found) => {
        if (live) {
          setReview(found)
        }
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [repoPath, branch, repoId, finishedAt])
  return review
}

export function HqTodayReadyRow({
  task,
  decision,
  agent,
  level,
  actions
}: {
  task: ClickUpTaskSummary
  decision: HqTriageDecision
  agent: DashboardCard | null
  level: HqAutonomyLevel
  actions: HqReadyRowActions
}): React.JSX.Element {
  const [panel, setPanel] = useState<Panel>('none')
  const [error, setError] = useState<string | null>(null)
  const [confirmMerge, setConfirmMerge] = useState(false)
  const [commentText, setCommentText] = useState<string | null>(null)
  const review = useTaskReview(decision, agent)
  const busy = isHqAgentBusy(agent)
  const draft = hqCommentDraft(decision, agent)
  const canTell = Boolean(agent) && !busy
  const writesCode = level > 0

  const tell = async (
    message: HqClosingMessage,
    patch: Partial<HqTriageDecision>
  ): Promise<void> => {
    const failure = await actions.tell(HQ_CLOSING_MESSAGES[message])
    setError(failure)
    if (!failure) {
      actions.stamp({ lastToldAt: patch.commentAskedAt ?? Date.now(), ...patch })
    }
  }
  const merge = (): void => {
    if (!confirmMerge) {
      setConfirmMerge(true)
      return
    }
    setConfirmMerge(false)
    void tell('merge', { mergeAskedAt: Date.now() })
  }
  const check = async (): Promise<void> => setError(await actions.setCheck())

  return (
    <li className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <div className="flex w-full items-center gap-2">
        <span className="w-20 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
          {task.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
        {review ? (
          <a
            href={review.url}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          >
            {reviewNote(review)}
          </a>
        ) : null}
        <span className="shrink-0 text-[11px] text-muted-foreground">{agentNote(agent)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 pl-22">
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={!agent}
          onClick={() => (agent ? revealDashboardAgent(agent) : undefined)}
        >
          {translate('auto.hq.ready.open', 'Report')}
        </Button>
        {writesCode ? (
          <Button
            type="button"
            size="xs"
            disabled={!canTell}
            onClick={() => void tell('accept', { acceptedAt: Date.now() })}
          >
            {decision.acceptedAt
              ? translate('auto.hq.ready.acceptAgain', 'Accept again')
              : translate('auto.hq.ready.accept', 'Accept')}
          </Button>
        ) : null}
        {writesCode && (decision.acceptedAt || review) && review?.state !== 'merged' ? (
          <Button
            type="button"
            variant={confirmMerge ? 'destructive' : 'outline'}
            size="xs"
            disabled={!canTell}
            onClick={merge}
            onBlur={() => setConfirmMerge(false)}
          >
            {confirmMerge
              ? translate('auto.hq.ready.mergeConfirm', 'Merge — sure?')
              : translate('auto.hq.ready.merge', 'Merge')}
          </Button>
        ) : null}
        {writesCode ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={!canTell}
            onClick={() => void tell('checkSpec', {})}
          >
            {translate('auto.hq.ready.checkSpec', 'Check spec')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="xs"
          disabled={!canTell}
          onClick={() => void tell('comment', { commentAskedAt: Date.now() })}
        >
          {decision.commentAskedAt
            ? translate('auto.hq.ready.redraftComment', 'Redraft comment')
            : translate('auto.hq.ready.draftComment', 'Draft comment')}
        </Button>
        {draft && !decision.commentedAt ? (
          <Button
            type="button"
            size="xs"
            onClick={() =>
              void actions.readAnswer().then((text) => {
                setCommentText(text ?? draft)
                setPanel('comment')
              })
            }
          >
            {translate('auto.hq.ready.reviewComment', 'Review comment')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!canTell}
          onClick={() => setPanel('rework')}
        >
          {translate('auto.hq.ready.rework', 'Rework')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={!decision.commentedAt}
          title={
            decision.commentedAt
              ? undefined
              : translate('auto.hq.ready.checkAfterComment', 'Send the comment first')
          }
          onClick={() => void check()}
        >
          {translate('auto.hq.ready.setCheck', 'Set «check»')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          title={translate('auto.hq.ready.dismissHint', 'Leaves ClickUp as it is')}
          onClick={() => actions.stamp({ decision: 'closed', at: Date.now() })}
        >
          {translate('auto.hq.ready.dismiss', 'Remove from HQ')}
        </Button>
      </div>
      <HqReadyHours identifier={task.identifier} hours={decision.hours} onSet={actions.setHours} />
      {panel === 'rework' ? (
        <HqReadyTextPanel
          label={translate('auto.hq.ready.reworkFor', 'What to redo in {{value0}}', {
            value0: task.identifier
          })}
          initial=""
          sendLabel={translate('auto.hq.ready.sendRework', 'Send to the agent')}
          hint={translate('auto.hq.ready.reworkHint', 'Goes to the same agent session.')}
          onSend={async (text) => {
            const failure = await actions.tell(text)
            if (!failure) {
              actions.stamp({ lastToldAt: Date.now() })
              setPanel('none')
            }
            return failure
          }}
          onCancel={() => setPanel('none')}
        />
      ) : null}
      {panel === 'comment' && commentText ? (
        <HqReadyTextPanel
          label={translate('auto.hq.ready.commentFor', 'Comment for {{value0}}', {
            value0: task.identifier
          })}
          initial={commentText}
          sendLabel={translate('auto.hq.triage.sendQuestions', 'Send to ClickUp')}
          hint={translate(
            'auto.hq.triage.sendHint',
            'Goes to the task as your comment; nothing is sent before you click.'
          )}
          onSend={async (text) => {
            const failure = await actions.comment(text)
            if (!failure) {
              setPanel('none')
            }
            return failure
          }}
          onCancel={() => setPanel('none')}
        />
      ) : null}
      {decision.commentedAt ? (
        <p className="pl-22 text-[11px] text-muted-foreground">
          {translate('auto.hq.ready.commented', 'Comment is in ClickUp.')}
        </p>
      ) : null}
      {error ? <p className="pl-22 text-xs text-destructive">{error}</p> : null}
    </li>
  )
}
