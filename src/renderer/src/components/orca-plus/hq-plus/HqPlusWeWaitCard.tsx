// Custom build (hq-plus-round6): one thing we wait for, in the left column — a line until opened;
// open, it shows where it came from and what can be done: ask, link a task, re-check, snooze, close.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import {
  hqWaitingSnoozeDay,
  hqWaitingSourceUrl,
  hqWaitingTaskRef,
  withHqWaitingTag
} from '../../../../../shared/hq-waiting-tags'
import { HqPlusText } from './HqPlusText'
import { hqPlusSourceLabel } from './hq-plus-source-label'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'
import { closeHqWaiting, updateHqWaitingDetail } from '../hq/use-hq-pulse'
import { startHqChatWithPrompt } from '../hq/hq-ask-chat'
import { hqReminderPrompt } from '../hq/hq-today'

const SNOOZES = [
  ['tomorrow', 'auto.hqPlus.wait.snoozeTomorrow', 'Tomorrow'],
  ['monday', 'auto.hqPlus.wait.snoozeMonday', 'Monday'],
  ['week', 'auto.hqPlus.wait.snoozeWeek', 'A week']
] as const

function taskUrl(task: string): string | null {
  return task.startsWith('https://') ? task : null
}

/** Custom build (hq-plus-round6): one line until opened; open, it shows where it came from and acts. */
export function HqPlusWeWaitCard({
  wait,
  actions
}: {
  wait: HqPlusOtherWait
  actions: HqPlusQueueActions
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'link' | 'snooze' | null>(null)
  const [taskText, setTaskText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chat = actions.openChat(wait.sessionId)
  const snoozed = wait.snoozedUntil !== null && wait.snoozedUntil > actions.now
  const fail = (reason: unknown): void => setError(String(reason))
  const inHqChat = (prompt: string, name: string, done: string): void => {
    if (!actions.hqWorktreeId) {
      return
    }
    setError(null)
    void startHqChatWithPrompt(actions.hqWorktreeId, prompt, name).then((result) =>
      result.ok ? setNote(done) : setError(result.message)
    )
  }
  const ask = (): void =>
    // Why: an HQ chat writes the reminder; it reaches the person only through Approve.
    inHqChat(
      hqReminderPrompt(wait.who, wait.title),
      translate('auto.hqPlus.queue.nudgeChat', 'Nudge · {{who}}', { who: wait.who ?? 'HQ' }),
      translate(
        'auto.hqPlus.wait.askStarted',
        'An HQ chat drafts the reminder; it waits for your Approve.'
      )
    )
  const recheck = (): void =>
    inHqChat(
      [
        'Перепроверь одно ожидание по скиллу hq-waiting-digest, режим «одно ожидание».',
        `id: ${wait.id}`,
        `Кого ждём: ${wait.who ?? '—'} — ${wait.title}`,
        wait.link ? `Где спрашивали: ${wait.link}` : null,
        wait.task ? `Задача: ${wait.task}` : null,
        'Людям ничего не пиши.'
      ]
        .filter((line): line is string => line !== null)
        .join('\n'),
      translate('auto.hqPlus.wait.recheckChat', 'Re-check · {{who}}', { who: wait.who ?? 'HQ' }),
      translate(
        'auto.hqPlus.wait.recheckStarted',
        'Checking — the result lands under this waiting.'
      )
    )
  const saveDetail = (detail: string | null): void => {
    setError(null)
    updateHqWaitingDetail(wait.id, detail)
      .then(() => {
        setMode(null)
        actions.onChanged()
      })
      .catch(fail)
  }
  const linkTask = (): void => {
    const ref = hqWaitingTaskRef(taskText)
    if (!ref) {
      setError(translate('auto.hqPlus.wait.badTask', 'A task id like DEV-123 or a link'))
      return
    }
    saveDetail(withHqWaitingTag(wait.rawDetail, 'task', ref))
  }
  const close = (): void => {
    setError(null)
    closeHqWaiting(wait.id, 'resolved').then(actions.onChanged).catch(fail)
  }
  const sourceUrl = hqWaitingSourceUrl(wait.link)
  const linked = wait.task ? taskUrl(wait.task) : null
  return (
    <div className="hqp-qcard" data-kind="wait" data-open={open} data-snoozed={snoozed}>
      <button type="button" className="hqp-wf" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="hqp-qtext">
          <HqPlusText text={`**${wait.who ?? '—'}** · ${wait.title}`} />
        </span>
        <span className="ag">{formatRelativeTime(wait.at, actions.now)}</span>
      </button>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleContent animation="height">
          <div className="hqp-qmore">
            <div className="hqp-qmeta">
              {wait.project ? <span className="hqp-chip">{wait.project}</span> : null}
              {wait.task ? (
                linked ? (
                  <button
                    type="button"
                    className="hqp-chip"
                    onClick={(event) => actions.openLink(linked, event)}
                  >
                    {wait.task.replace(/^https:\/\/app\.clickup\.com\/t\/(?:\d+\/)?/, '')} ↗
                  </button>
                ) : (
                  <span className="hqp-chip">{wait.task}</span>
                )
              ) : null}
              {snoozed && wait.snoozedUntil !== null ? (
                <span className="hqp-chip">
                  {translate('auto.hqPlus.wait.snoozedUntil', 'snoozed until {{day}}', {
                    day: new Date(wait.snoozedUntil).toLocaleDateString(undefined, {
                      weekday: 'short',
                      day: 'numeric',
                      month: 'short'
                    })
                  })}
                </span>
              ) : null}
            </div>
            {wait.detail ? <HqPlusText text={wait.detail} /> : null}
            {wait.checked ? (
              <span className="hqp-qcheck">
                {translate('auto.hqPlus.wait.checked', 'Checked {{what}}', { what: wait.checked })}
              </span>
            ) : null}
            <div className="hqp-qacts">
              <button
                type="button"
                className="hqp-link"
                disabled={!actions.hqWorktreeId}
                title={translate(
                  'auto.hqPlus.queue.nudgeHint',
                  'HQ drafts a reminder; it goes out through Approve'
                )}
                onClick={ask}
              >
                {translate('auto.hqPlus.wait.ask', 'Ask')}
              </button>
              <button
                type="button"
                className="hqp-link"
                aria-expanded={mode === 'link'}
                onClick={() => setMode(mode === 'link' ? null : 'link')}
              >
                {translate('auto.hqPlus.wait.linkTask', 'Link task')}
              </button>
              <button
                type="button"
                className="hqp-link"
                disabled={!actions.hqWorktreeId}
                onClick={recheck}
              >
                {translate('auto.hqPlus.wait.recheck', 'Re-check')}
              </button>
              <button
                type="button"
                className="hqp-link"
                aria-expanded={mode === 'snooze'}
                onClick={() => setMode(mode === 'snooze' ? null : 'snooze')}
              >
                {translate('auto.hqPlus.wait.snooze', 'Snooze')} ▾
              </button>
              {chat ? (
                <button type="button" className="hqp-link" onClick={chat}>
                  {translate('auto.hqPlus.wait.toChat', 'To chat')}
                </button>
              ) : null}
              <button type="button" className="hqp-link" data-ghost="true" onClick={close}>
                {translate('auto.hqPlus.wait.close', 'Close')}
              </button>
              {sourceUrl ? (
                <button
                  type="button"
                  className="hqp-link"
                  data-ghost="true"
                  onClick={(event) => actions.openLink(sourceUrl, event)}
                >
                  {hqPlusSourceLabel(sourceUrl)} ↗
                </button>
              ) : null}
            </div>
            {mode === 'link' ? (
              <form
                className="hqp-qform"
                onSubmit={(event) => {
                  event.preventDefault()
                  linkTask()
                }}
              >
                <input
                  value={taskText}
                  onChange={(event) => setTaskText(event.target.value)}
                  placeholder={translate('auto.hqPlus.wait.taskPlaceholder', 'DEV-123 or a link')}
                  aria-label={translate('auto.hqPlus.wait.linkTask', 'Link task')}
                />
                <button type="submit" className="hqp-link">
                  {translate('auto.hqPlus.wait.save', 'Save')}
                </button>
                {wait.task ? (
                  <button
                    type="button"
                    className="hqp-link"
                    data-ghost="true"
                    onClick={() => saveDetail(withHqWaitingTag(wait.rawDetail, 'task', null))}
                  >
                    {translate('auto.hqPlus.wait.unlink', 'Unlink')}
                  </button>
                ) : null}
              </form>
            ) : null}
            {mode === 'snooze' ? (
              <div className="hqp-qacts">
                {SNOOZES.map(([choice, key, label]) => (
                  <button
                    key={choice}
                    type="button"
                    className="hqp-link"
                    onClick={() =>
                      saveDetail(
                        withHqWaitingTag(
                          wait.rawDetail,
                          'snoozedUntil',
                          hqWaitingSnoozeDay(choice, actions.now)
                        )
                      )
                    }
                  >
                    {translate(key, label)}
                  </button>
                ))}
                {snoozed ? (
                  <button
                    type="button"
                    className="hqp-link"
                    data-ghost="true"
                    onClick={() =>
                      saveDetail(withHqWaitingTag(wait.rawDetail, 'snoozedUntil', null))
                    }
                  >
                    {translate('auto.hqPlus.wait.wake', 'Wake now')}
                  </button>
                ) : null}
              </div>
            ) : null}
            {note ? <span className="hqp-qcheck">{note}</span> : null}
          </div>
        </CollapsibleContent>
      </Collapsible>
      {error ? <p className="hqp-error">{error}</p> : null}
    </div>
  )
}
