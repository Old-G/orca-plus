// Custom build (hq-slack-scout): the «Today» tab's «From Slack» — task drafts the Slack scout found.
// The owner edits a draft and creates the ClickUp task, or rejects it for good; nothing goes out alone.
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { HqCommandDictation } from './HqCommandDictation'
import { ColumnHeader } from './hq-waiting-parts'

// Why: the scout runs every 30 minutes; a minute keeps the block fresh without a watcher.
const REFRESH_MS = 60_000

type Drafts =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; drafts: HqSlackScoutDraft[]; failedAt: string | null }

function useSlackDrafts(): { state: Drafts; refresh: () => void; drop: (id: string) => void } {
  const [state, setState] = useState<Drafts>({ status: 'loading' })
  const refresh = useCallback(() => {
    void window.api.hqProjects
      .slackDrafts()
      .then((result) =>
        setState(
          !result.ok
            ? { status: 'error', message: result.error }
            : !result.configured && result.drafts.length === 0
              ? { status: 'hidden' }
              : { status: 'ready', drafts: result.drafts, failedAt: result.failedAt }
        )
      )
      .catch((error: unknown) => setState({ status: 'error', message: String(error) }))
  }, [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])
  const drop = (id: string): void =>
    setState((current) =>
      current.status === 'ready'
        ? { ...current, drafts: current.drafts.filter((draft) => draft.id !== id) }
        : current
    )
  return { state, refresh, drop }
}

function DraftEditor({
  draft,
  onCreated,
  onCancel
}: {
  draft: HqSlackScoutDraft
  onCreated: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [title, setTitle] = useState(draft.title)
  const [description, setDescription] = useState(draft.description)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const create = async (): Promise<void> => {
    setBusy(true)
    const result = await window.api.hqProjects
      .createSlackDraftTask({ id: draft.id, title: title.trim(), description })
      .catch((failure: unknown) => ({ ok: false as const, error: String(failure) }))
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    toast.success(translate('auto.hq.slack.created', 'Task created in ClickUp'), {
      action: {
        label: translate('auto.hq.slack.open', 'Open'),
        onClick: () => void window.api.shell.openUrl(result.taskUrl)
      }
    })
    onCreated()
  }
  return (
    <div className="flex flex-col gap-1.5 pl-22">
      <Input
        value={title}
        disabled={busy}
        onChange={(event) => setTitle(event.target.value)}
        aria-label={translate('auto.hq.slack.titleLabel', 'Task title')}
      />
      <div className="flex items-start gap-2">
        <Textarea
          ref={textareaRef}
          className="min-h-40 flex-1"
          value={description}
          disabled={busy}
          onChange={(event) => setDescription(event.target.value)}
          aria-label={translate('auto.hq.slack.descriptionLabel', 'Task description')}
        />
        <HqCommandDictation textareaRef={textareaRef} disabled={busy} />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="xs"
          disabled={busy || !title.trim()}
          onClick={() => void create()}
        >
          {busy
            ? translate('auto.hq.slack.creating', 'Creating…')
            : translate('auto.hq.slack.create', 'Create task')}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onCancel}>
          {translate('auto.hq.project.cancel', 'Cancel')}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {translate(
            'auto.hq.slack.createHint',
            'Goes to the list in slack-scout/config.yaml; nothing is created before you click.'
          )}
        </span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function DraftRow({
  draft,
  onDone
}: {
  draft: HqSlackScoutDraft
  onDone: () => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const reject = async (): Promise<void> => {
    const result = await window.api.hqProjects
      .rejectSlackDraft({ id: draft.id })
      .catch((failure: unknown) => ({ ok: false as const, error: String(failure) }))
    if (result.ok) {
      onDone()
    } else {
      toast.error(result.error)
    }
  }
  return (
    <li className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <div className="flex w-full items-center gap-2">
        <span className="w-20 shrink-0 truncate text-[11px] text-muted-foreground">
          {draft.channelName}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px]">{draft.title}</span>
        <span className="max-w-32 shrink-0 truncate text-[11px] text-muted-foreground">
          {draft.author}
        </span>
      </div>
      {draft.quote ? (
        <p className="line-clamp-2 pl-22 text-xs text-muted-foreground">«{draft.quote}»</p>
      ) : null}
      {editing ? (
        <DraftEditor draft={draft} onCreated={onDone} onCancel={() => setEditing(false)} />
      ) : (
        <div className="flex flex-wrap items-center gap-1.5 pl-22">
          <Button type="button" size="xs" onClick={() => setEditing(true)}>
            {translate('auto.hq.slack.review', 'Review draft')}
          </Button>
          {draft.permalink ? (
            <Button
              type="button"
              variant="secondary"
              size="xs"
              onClick={() => void window.api.shell.openUrl(draft.permalink)}
            >
              {translate('auto.hq.slack.thread', 'Slack thread')}
            </Button>
          ) : null}
          <Button type="button" variant="ghost" size="xs" onClick={() => void reject()}>
            {translate('auto.hq.slack.reject', 'Reject')}
          </Button>
        </div>
      )}
    </li>
  )
}

function formatScoutTime(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function HqTodaySlackDrafts(): React.JSX.Element | null {
  const { state, drop } = useSlackDrafts()
  if (state.status === 'hidden' || state.status === 'loading') {
    return null
  }
  const title = translate('auto.hq.slack.title', 'From Slack')
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <ColumnHeader title={title} count={state.status === 'ready' ? state.drafts.length : 0} />
      {state.status === 'ready' && state.failedAt ? (
        <p className="text-xs text-destructive">
          {translate(
            'auto.hq.slack.runFailed',
            'The scout did not run at {{time}} (Slack or ClickUp connector missing?). It retries the window next run; log: ~/Library/Logs/slack-scout.log',
            { time: formatScoutTime(state.failedAt) }
          )}
        </p>
      ) : null}
      {state.status === 'error' ? (
        <p className="text-xs text-destructive">
          {translate('auto.hq.slack.failed', "Couldn't read the Slack scout: {{value0}}", {
            value0: state.message
          })}
        </p>
      ) : state.drafts.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.slack.empty', 'Nothing new from Slack.')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {state.drafts.map((draft) => (
            <DraftRow key={draft.id} draft={draft} onDone={() => drop(draft.id)} />
          ))}
        </ul>
      )}
    </section>
  )
}
