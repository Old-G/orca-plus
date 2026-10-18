// Custom build (hq-slack-scout): the «Today» tab's «From Slack» — the requests the Slack scout found,
// each decided on its card; nothing goes out alone.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { HqSlackScoutDraft } from '../../../../../shared/hq-slack-scout'
import { hqProjectShortName } from '../../../../../shared/hq-slack-request-bell'
import { translate } from '@/i18n/i18n'
import { ColumnHeader } from './hq-waiting-parts'
import { useHqProjectPages } from './use-hq-project-pages'
import { HqSlackRequestCard } from '../slack-requests/HqSlackRequestCard'
import type { HqSlackQuietItem } from '../../../../../shared/hq-slack-digest'
import { useHqSlackRequestEditTarget } from '../slack-requests/hq-slack-request-actions'

// Why: the scout runs every 10 minutes; a minute keeps the block fresh without a watcher.
const REFRESH_MS = 60_000

type Drafts =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error'; message: string }
  | {
      status: 'ready'
      drafts: HqSlackScoutDraft[]
      failedAt: string | null
      /** Custom build (hq-scout-digest): what the scout set aside as quiet. */
      quiet: HqSlackQuietItem[]
    }

export function useHqSlackDrafts(): {
  state: Drafts
  refresh: () => void
  drop: (id: string) => void
} {
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
              : {
                  status: 'ready',
                  drafts: result.drafts,
                  failedAt: result.failedAt,
                  quiet: result.quiet ?? []
                }
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

function formatScoutTime(iso: string): string {
  const at = new Date(iso)
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function SlackRequestList({
  drafts,
  onDone,
  onChanged
}: {
  drafts: readonly HqSlackScoutDraft[]
  onDone: (id: string) => void
  onChanged: () => void
}): React.JSX.Element {
  const pages = useHqProjectPages()
  const projects = useMemo(
    () =>
      pages.status === 'ready'
        ? pages.pages
            .map((page) => ({ slug: page.slug, name: hqProjectShortName(page) }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : [],
    [pages]
  )
  const editTarget = useHqSlackRequestEditTarget()
  return (
    <ul className="flex flex-col gap-1">
      {drafts.map((draft) => (
        <HqSlackRequestCard
          key={draft.id}
          draft={draft}
          projects={projects}
          openRequested={editTarget.id === draft.id ? editTarget.mode : null}
          onOpenHandled={editTarget.clear}
          onDone={() => onDone(draft.id)}
          onChanged={onChanged}
        />
      ))}
    </ul>
  )
}

export function HqTodaySlackDrafts(): React.JSX.Element | null {
  const { state, refresh, drop } = useHqSlackDrafts()
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
        <SlackRequestList drafts={state.drafts} onDone={drop} onChanged={refresh} />
      )}
    </section>
  )
}
