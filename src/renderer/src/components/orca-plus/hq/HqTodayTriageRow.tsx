// Custom build (hq-triage): one «New tasks» row — the task, a project picker, Take / Questions /
// Not now / Hide, and the questions panel: Claude's draft, edited by hand or by voice, sent on click.
import { useRef, useState } from 'react'
import type { ClickUpTaskSummary } from '../../../../../shared/clickup-types'
import type { HqTaskQuestionsResult } from '../../../../../shared/hq-triage'
import type { Repo } from '../../../../../shared/repo-types'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { HqCommandDictation } from './HqCommandDictation'

type Questions =
  | { status: 'closed' }
  | { status: 'drafting' }
  | { status: 'editing'; text: string; error: string | null }
  | { status: 'sending'; text: string }

function QuestionsPanel({
  identifier,
  questions,
  setQuestions,
  onSend
}: {
  identifier: string
  questions: Exclude<Questions, { status: 'closed' }>
  setQuestions: (next: Questions) => void
  onSend: (text: string) => Promise<string | null>
}): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  if (questions.status === 'drafting') {
    return (
      <p className="pl-22 text-xs text-muted-foreground">
        {translate('auto.hq.triage.drafting', 'Claude is reading the task and drafting questions…')}
      </p>
    )
  }
  const text = questions.text
  const sending = questions.status === 'sending'
  const send = async (): Promise<void> => {
    setQuestions({ status: 'sending', text })
    const error = await onSend(text.trim())
    setQuestions(error ? { status: 'editing', text, error } : { status: 'closed' })
  }
  return (
    <div className="flex flex-col gap-1.5 pl-22">
      <div className="flex items-start gap-2">
        <Textarea
          ref={textareaRef}
          className="min-h-24 flex-1"
          value={text}
          disabled={sending}
          onChange={(event) =>
            setQuestions({ status: 'editing', text: event.target.value, error: null })
          }
          aria-label={translate('auto.hq.triage.questionsFor', 'Questions for {{value0}}', {
            value0: identifier
          })}
        />
        <HqCommandDictation textareaRef={textareaRef} disabled={sending} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          disabled={sending || !text.trim()}
          onClick={() => void send()}
        >
          {sending
            ? translate('auto.hq.triage.sending', 'Sending…')
            : translate('auto.hq.triage.sendQuestions', 'Send to ClickUp')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={sending}
          onClick={() => setQuestions({ status: 'closed' })}
        >
          {translate('auto.hq.project.cancel', 'Cancel')}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {translate(
            'auto.hq.triage.sendHint',
            'Goes to the task as your comment; nothing is sent before you click.'
          )}
        </span>
      </div>
      {questions.status === 'editing' && questions.error ? (
        <p className="text-xs text-destructive">{questions.error}</p>
      ) : null}
    </div>
  )
}

export function HqTodayTriageRow({
  task,
  repos,
  suggested,
  busy,
  onOpen,
  onTake,
  onDraftQuestions,
  onSendQuestions,
  onSnooze,
  onHide
}: {
  task: ClickUpTaskSummary
  repos: Repo[]
  suggested: string | null
  busy: boolean
  onOpen: () => void
  onTake: (repoId: string) => void
  onDraftQuestions: () => Promise<HqTaskQuestionsResult>
  /** Resolves to an error to show, or null once the comment is in ClickUp. */
  onSendQuestions: (text: string) => Promise<string | null>
  onSnooze: () => void
  onHide: () => void
}): React.JSX.Element {
  const [repoId, setRepoId] = useState<string | null>(
    suggested && repos.some((repo) => repo.id === suggested) ? suggested : null
  )
  const [questions, setQuestions] = useState<Questions>({ status: 'closed' })
  const locked = busy || questions.status !== 'closed'
  const draft = async (): Promise<void> => {
    setQuestions({ status: 'drafting' })
    const result = await onDraftQuestions()
    // Why: a failed draft still opens the box, so the questions can be written by hand.
    setQuestions(
      result.ok
        ? { status: 'editing', text: result.questions, error: null }
        : { status: 'editing', text: '', error: result.error }
    )
  }
  return (
    <li className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-2 rounded-sm text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="w-20 shrink-0 truncate font-mono text-[11px] text-muted-foreground">
          {task.identifier}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{task.title}</span>
        {task.listName ? (
          <span className="max-w-32 shrink-0 truncate text-[11px] text-muted-foreground">
            {task.listName}
          </span>
        ) : null}
      </button>
      <div className="flex flex-wrap items-center gap-1.5 pl-22">
        <Select value={repoId ?? undefined} onValueChange={setRepoId} disabled={locked}>
          <SelectTrigger
            size="sm"
            className="w-48"
            aria-label={translate('auto.hq.triage.project', 'Project for {{value0}}', {
              value0: task.identifier
            })}
          >
            <SelectValue placeholder={translate('auto.hq.triage.pickProject', 'Pick a project')} />
          </SelectTrigger>
          <SelectContent>
            {repos.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                {repo.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="xs"
          disabled={!repoId || locked}
          onClick={() => (repoId ? onTake(repoId) : undefined)}
        >
          {busy
            ? translate('auto.hq.triage.taking', 'Starting…')
            : translate('auto.hq.triage.take', 'Take')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="xs"
          disabled={locked}
          onClick={() => void draft()}
        >
          {translate('auto.hq.triage.questions', 'Questions')}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={locked} onClick={onSnooze}>
          {translate('auto.hq.triage.snooze', 'Not now')}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={locked} onClick={onHide}>
          {translate('auto.hq.triage.hide', 'Hide')}
        </Button>
      </div>
      {questions.status === 'closed' ? null : (
        <QuestionsPanel
          identifier={task.identifier}
          questions={questions}
          setQuestions={setQuestions}
          onSend={onSendQuestions}
        />
      )}
    </li>
  )
}
