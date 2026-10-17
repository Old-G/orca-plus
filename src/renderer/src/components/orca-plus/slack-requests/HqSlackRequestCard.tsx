// Custom build (hq-slack-requests): one Slack request in HQ's «From Slack» — who asks, what, for which
// project — with Do / Just reply / Edit / Skip. Edit corrects what the scout guessed; nothing goes out alone.
import { useEffect, useRef, useState } from 'react'
import {
  HQ_SLACK_REQUEST_KINDS,
  hqSlackRequestKind,
  type HqSlackRequestKind,
  type HqSlackScoutDraft
} from '../../../../../shared/hq-slack-scout'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { HqCommandDictation } from '../hq/HqCommandDictation'
import { HqClickUpReplyComposer } from './HqClickUpReplyComposer'
import {
  answerHqSlackRequest,
  doHqSlackRequest,
  skipHqSlackRequest,
  type HqSlackRequestOpenMode
} from './hq-slack-request-actions'

export type HqSlackRequestProject = { slug: string; name: string }

const NO_PROJECT = '__none'

function kindLabel(kind: HqSlackRequestKind): string {
  return kind === 'do'
    ? translate('auto.hq.slack.kind.do', 'Do')
    : kind === 'answer'
      ? translate('auto.hq.slack.kind.answer', 'Reply')
      : translate('auto.hq.slack.kind.fyi', 'FYI')
}

function RequestEditor({
  draft,
  projects,
  onSaved,
  onCancel
}: {
  draft: HqSlackScoutDraft
  projects: readonly HqSlackRequestProject[]
  onSaved: () => void
  onCancel: () => void
}): React.JSX.Element {
  const [kind, setKind] = useState<HqSlackRequestKind>(hqSlackRequestKind(draft))
  const [project, setProject] = useState(draft.project ?? NO_PROJECT)
  const [ask, setAsk] = useState(draft.ask ?? '')
  const [title, setTitle] = useState(draft.title)
  const [description, setDescription] = useState(draft.description)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const save = async (): Promise<void> => {
    setBusy(true)
    const result = await window.api.hqProjects
      .editSlackDraft({
        id: draft.id,
        kind,
        project: project === NO_PROJECT ? null : project,
        ask: ask.trim(),
        title: title.trim(),
        description
      })
      .catch((failure: unknown) => ({ ok: false as const, error: String(failure) }))
    setBusy(false)
    if (result.ok) {
      onSaved()
    } else {
      setError(result.error)
    }
  }
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Select
          value={kind}
          disabled={busy}
          onValueChange={(value) => {
            const next = HQ_SLACK_REQUEST_KINDS.find((entry) => entry === value)
            if (next) {
              setKind(next)
            }
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-28"
            aria-label={translate('auto.hq.slack.kindLabel', 'Kind')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {HQ_SLACK_REQUEST_KINDS.map((entry) => (
              <SelectItem key={entry} value={entry}>
                {kindLabel(entry)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={project} disabled={busy} onValueChange={setProject}>
          <SelectTrigger
            size="sm"
            className="w-48"
            aria-label={translate('auto.hq.slack.projectLabel', 'Project')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_PROJECT}>
              {translate('auto.hq.slack.noProject', 'No project')}
            </SelectItem>
            {projects.map((entry) => (
              <SelectItem key={entry.slug} value={entry.slug}>
                {entry.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        value={ask}
        disabled={busy}
        onChange={(event) => setAsk(event.target.value)}
        placeholder={translate('auto.hq.slack.askPlaceholder', 'What they want from you')}
        aria-label={translate('auto.hq.slack.askLabel', 'What they ask')}
      />
      <Input
        value={title}
        disabled={busy}
        onChange={(event) => setTitle(event.target.value)}
        aria-label={translate('auto.hq.slack.titleLabel', 'Task title')}
      />
      <div className="flex items-start gap-2">
        <Textarea
          ref={textareaRef}
          className="min-h-32 flex-1"
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
          onClick={() => void save()}
        >
          {translate('auto.hq.slack.save', 'Save')}
        </Button>
        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={onCancel}>
          {translate('auto.hq.project.cancel', 'Cancel')}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

type ActionKey = 'do' | 'answer' | 'edit' | 'skip'

/** The suggested answer first, as in the bell. */
const ACTION_ORDER: Record<HqSlackRequestKind, ActionKey[]> = {
  do: ['do', 'answer', 'edit', 'skip'],
  answer: ['answer', 'do', 'edit', 'skip'],
  fyi: ['skip', 'do', 'answer', 'edit']
}

export function HqSlackRequestCard({
  draft,
  projects,
  openRequested,
  onOpenHandled,
  onDone,
  onChanged
}: {
  draft: HqSlackScoutDraft
  projects: readonly HqSlackRequestProject[]
  /** The bell or a toast asked for this request's editor or ClickUp reply composer. */
  openRequested: HqSlackRequestOpenMode | null
  onOpenHandled: () => void
  onDone: () => void
  onChanged: () => void
}): React.JSX.Element {
  const [panelHere, setPanelHere] = useState<HqSlackRequestOpenMode | null>(null)
  const panel = panelHere ?? openRequested
  const setPanel = (next: HqSlackRequestOpenMode | null): void => {
    setPanelHere(next)
    if (!next && openRequested) {
      onOpenHandled()
    }
  }
  const editing = panel === 'edit'
  const isClickUp = draft.source === 'clickup'
  const [busy, setBusy] = useState(false)
  const rowRef = useRef<HTMLLIElement>(null)
  const kind = hqSlackRequestKind(draft)
  const projectName = draft.project
    ? (projects.find((entry) => entry.slug === draft.project)?.name ?? draft.project)
    : null

  useEffect(() => {
    if (openRequested) {
      rowRef.current?.scrollIntoView({ block: 'center' })
    }
  }, [openRequested])

  const decide = async (run: () => Promise<boolean>): Promise<void> => {
    setBusy(true)
    const done = await run()
    setBusy(false)
    if (done) {
      onDone()
    }
  }
  const labels: Record<ActionKey, string> = {
    do: translate('auto.hq.slack.do', 'Do'),
    answer: translate('auto.hq.slack.answer', 'Just reply'),
    edit: translate('auto.hq.slack.edit', 'Edit'),
    skip:
      kind === 'fyi'
        ? translate('auto.hq.slack.gotIt', 'Got it')
        : translate('auto.hq.slack.skip', 'Skip')
  }
  const handlers: Record<ActionKey, () => void> = {
    do: () => void decide(() => doHqSlackRequest(draft)),
    answer: isClickUp
      ? () => setPanel('reply')
      : () => void decide(() => answerHqSlackRequest(draft)),
    edit: () => setPanel('edit'),
    skip: () => void decide(() => skipHqSlackRequest(draft.id))
  }
  const actions = ACTION_ORDER[kind].filter(
    (key) => (key !== 'edit' || !editing) && (key !== 'answer' || panel !== 'reply')
  )

  return (
    <li ref={rowRef} className="flex flex-col gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent/50">
      <div className="flex w-full items-center gap-2">
        <Badge variant="secondary" className="shrink-0">
          {kindLabel(kind)}
        </Badge>
        <span className="min-w-0 flex-1 truncate text-sm">
          {draft.author ? <span className="font-medium">{draft.author}: </span> : null}
          {draft.ask || draft.title}
        </span>
        <span className="max-w-48 shrink-0 truncate text-[11px] text-muted-foreground">
          {[projectName ?? translate('auto.hq.slack.projectUnknown', 'project?'), draft.channelName]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      {/* Custom build (hq-scout-context): why the scout thinks this needs the owner. */}
      {draft.why ? <p className="text-xs text-foreground">→ {draft.why}</p> : null}
      {draft.quote ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">«{draft.quote}»</p>
      ) : null}
      {editing ? (
        <RequestEditor
          draft={draft}
          projects={projects}
          onSaved={() => {
            setPanel(null)
            onChanged()
          }}
          onCancel={() => setPanel(null)}
        />
      ) : null}
      {panel === 'reply' && isClickUp ? (
        <HqClickUpReplyComposer
          id={draft.id}
          onSent={() => {
            setPanel(null)
            onDone()
          }}
          onCancel={() => setPanel(null)}
        />
      ) : null}
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((key, index) => (
          <Button
            key={key}
            type="button"
            size="xs"
            variant={index === 0 ? 'default' : 'outline'}
            disabled={busy}
            onClick={handlers[key]}
          >
            {labels[key]}
          </Button>
        ))}
        {draft.permalink ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={() => void window.api.shell.openUrl(draft.permalink)}
          >
            <ExternalLink />
            {isClickUp
              ? translate('auto.hq.clickup.task', 'ClickUp task')
              : translate('auto.hq.slack.thread', 'Slack thread')}
          </Button>
        ) : null}
      </div>
    </li>
  )
}
