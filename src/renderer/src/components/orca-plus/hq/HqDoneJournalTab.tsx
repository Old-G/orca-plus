// Custom build (hq-done-journal): HQ's «Done for you» — what Orca+ did in the owner's name over the
// last week, with links to the task or thread; a skipped request can be brought back.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import type { HqSlackScoutDone } from '../../../../../shared/hq-slack-scout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useNow } from '@/hooks/use-now'
import { translate } from '@/i18n/i18n'
import { formatShortTimeAgo } from '@/lib/short-time-ago'
import {
  buildHqDoneJournal,
  hqDoneProjects,
  type HqDoneEntry,
  type HqDoneLink,
  type HqDoneWhat
} from './hq-done-journal'
import type { HqChatItem } from './hq-chat-list'
import { HqDoneSentDetails } from './HqDoneSentDetails'
import { hqSentNames } from './hq-sent-names'
import { useHqChatList } from './use-hq-chat-list'
import { useHqPulse } from './use-hq-pulse'

const AGE_TICK_MS = 60_000
// Why: decisions come from clicks in this app; a minute keeps the page fresh without a watcher.
const REFRESH_MS = 60_000

function whatLabel(what: HqDoneWhat): string {
  switch (what) {
    case 'task-created':
      return translate('auto.hq.done.taskCreated', 'Task created')
    case 'task-taken':
      return translate('auto.hq.done.taskTaken', 'Task taken')
    case 'replied':
      return translate('auto.hq.done.replied', 'Replied')
    case 'skipped':
      return translate('auto.hq.done.skipped', 'Skipped')
    case 'sent':
      return translate('auto.hq.done.sent', 'Sent')
    case 'sent-edited':
      return translate('auto.hq.done.sentEdited', 'Sent with your edits')
    case 'not-sent':
      return translate('auto.hq.done.notSent', 'Not sent')
  }
}

function linkLabel(kind: HqDoneLink['kind']): string {
  return kind === 'task'
    ? translate('auto.hq.done.task', 'Task')
    : kind === 'clickup'
      ? translate('auto.hq.done.clickup', 'ClickUp')
      : translate('auto.hq.done.thread', 'Thread')
}

function useHqRequestDecisions(): {
  requests: HqSlackScoutDone[]
  error: string | null
  refresh: () => void
} {
  const [requests, setRequests] = useState<HqSlackScoutDone[]>([])
  const [error, setError] = useState<string | null>(null)
  const refresh = useCallback(() => {
    void window.api.hqProjects
      .slackDrafts()
      .then((result) => {
        if (result.ok) {
          setRequests(result.done ?? [])
          setError(null)
        } else {
          setError(result.error)
        }
      })
      .catch((failure: unknown) => setError(String(failure)))
  }, [])
  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])
  return { requests, error, refresh }
}

/** Custom build (hq-sent-history): «Slack → DM with Петя» instead of «Slack · send message». */
function entryTitle(entry: HqDoneEntry): string {
  if (!entry.sent) {
    return entry.title
  }
  const target = hqSentNames(entry.sent).target
  const service = entry.sent.service ?? entry.title.split(' · ')[0] ?? entry.title
  return target ? `${service} → ${target}` : entry.title
}

function JournalRow({
  entry,
  now,
  chats,
  onRestored
}: {
  entry: HqDoneEntry
  now: number
  chats: readonly HqChatItem[]
  onRestored: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const restore = async (id: string): Promise<void> => {
    setBusy(true)
    const result = await window.api.hqProjects
      .restoreSlackDraft({ id })
      .catch((failure: unknown) => ({ ok: false as const, error: String(failure) }))
    setBusy(false)
    if (result.ok) {
      toast.success(translate('auto.hq.done.restored', 'The request is back in Today.'))
      onRestored()
    } else {
      toast.error(result.error)
    }
  }
  return (
    <li className="flex flex-col gap-1 border-b border-border py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <Badge
          variant={entry.what === 'skipped' || entry.what === 'not-sent' ? 'outline' : 'secondary'}
          className="shrink-0"
        >
          {whatLabel(entry.what)}
        </Badge>
        <span
          data-sent={Boolean(entry.sent)}
          className="min-w-0 flex-1 truncate text-[13px] data-[sent=true]:font-semibold"
          title={entryTitle(entry)}
        >
          {entryTitle(entry)}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
          {formatShortTimeAgo(entry.at, now)}
        </span>
      </div>
      {entry.sent ? (
        <HqDoneSentDetails sent={entry.sent} message={entry.message ?? null} chats={chats} />
      ) : entry.detail ? (
        <p className="line-clamp-2 text-xs text-muted-foreground">{entry.detail}</p>
      ) : null}
      {entry.links.length > 0 || entry.restoreId ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {entry.links.map((link) => (
            <Button
              key={link.kind}
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => void window.api.shell.openUrl(link.url)}
            >
              {linkLabel(link.kind)}
            </Button>
          ))}
          {entry.restoreId ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() => void restore(entry.restoreId ?? '')}
            >
              {translate('auto.hq.done.bringBack', 'Bring back')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

export function HqDoneJournalTab(): React.JSX.Element {
  const now = useNow(AGE_TICK_MS)
  const pulse = useHqPulse()
  const { requests, error, refresh } = useHqRequestDecisions()
  const decisions = pulse.status === 'ready' ? pulse.pulse.decisions : null
  const { items: chats } = useHqChatList()
  const [project, setProject] = useState<string | null>(null)
  const all = useMemo(
    () => buildHqDoneJournal(requests, decisions ?? [], now),
    [requests, decisions, now]
  )
  const projects = useMemo(() => hqDoneProjects(all), [all])
  const entries = project ? all.filter((entry) => entry.sent?.project === project) : all
  return (
    <div className="scrollbar-sleek flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-4">
      <p className="text-xs text-muted-foreground">
        {translate(
          'auto.hq.done.hint',
          'What Orca+ did in your name over the last week: tasks it made or took, replies, and messages sent after your Approve.'
        )}
      </p>
      {projects.length > 0 ? (
        <div
          className="flex flex-wrap gap-1.5"
          aria-label={translate('auto.hq.done.byProject', 'By project')}
        >
          <Button
            type="button"
            size="xs"
            variant={project === null ? 'secondary' : 'ghost'}
            onClick={() => setProject(null)}
          >
            {translate('auto.hq.done.allProjects', 'All')}
          </Button>
          {projects.map((name) => (
            <Button
              key={name}
              type="button"
              size="xs"
              variant={project === name ? 'secondary' : 'ghost'}
              onClick={() => setProject(project === name ? null : name)}
            >
              {name}
            </Button>
          ))}
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('auto.hq.done.empty', 'Nothing done for you yet this week.')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {entries.map((entry) => (
            <JournalRow
              key={entry.key}
              entry={entry}
              now={now}
              chats={chats}
              onRestored={refresh}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
