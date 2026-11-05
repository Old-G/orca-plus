// Custom build (hq-plus-brain): HQ+'s «Brain» screen (owner 05.11, mockup approved) — one feed of every
// mention of a task, an MR, a person or a project: chats, what went out through Approve, waits, Slack,
// ClickUp, MRs, documents — by day, newest first; the search on top (⌘K), chips by source, «Open chat»
// on a row said in a chat. It covers the feed like an opened file; «←» goes back.
import { useEffect, useMemo, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import {
  HQ_BRAIN_GROUPS,
  hqBrainDays,
  hqBrainGroupCounts,
  hqBrainVisibleRows,
  type HqBrainChatRef,
  type HqBrainGroup,
  type HqBrainResult,
  type HqBrainRow
} from '../../../../../shared/hq-brain'
import { HqPlusText } from './HqPlusText'
import { HqPlusBrainLink } from './HqPlusBrainLink'
import { useHqPlusBrain } from './use-hq-plus-brain'
import {
  HQ_BRAIN_CHIP_LABEL,
  HQ_BRAIN_HEAD_LABEL,
  hqBrainClock,
  hqBrainDayLabel,
  hqBrainFileTarget,
  hqBrainRowTitle,
  hqBrainSourceLabel,
  hqBrainStatusTag
} from './hq-plus-brain-view'
import { hqPlusSourceLabel } from './hq-plus-source-label'
import type { HqPlusLinkClick } from './hq-plus-link-open'
import './hq-plus-brain.css'

const SHOWN_FIRST = 60

export type HqPlusBrainActions = {
  /** Brings the chat up on the right (a closed one is reopened first). */
  openChat: (chat: HqBrainChatRef) => void
  openLink: (url: string, event?: HqPlusLinkClick) => void
  /** A page of HQ or a project's file, by its absolute path. */
  openFile: (path: string) => void
}

function Row({
  row,
  actions
}: {
  row: HqBrainRow
  actions: HqPlusBrainActions
}): React.JSX.Element {
  const tag = hqBrainStatusTag(row.status)
  const title = hqBrainRowTitle(row)
  const web = row.link !== null && /^https?:\/\//.test(row.link)
  // A file opens only when it is a document by an absolute path (see hqBrainFileTarget).
  const link = web || (row.link && hqBrainFileTarget(row.link, null)) ? row.link : null
  const resolution = row.status?.kind === 'wait' ? row.status.resolution : null
  return (
    <div className="hqp-brain-item" data-group={row.group}>
      <div className="t">{hqBrainClock(row.at)}</div>
      <div className="body">
        <div className="src">
          <span>{hqBrainSourceLabel(row)}</span>
          {tag ? (
            <span className="tag" data-tone={tag.tone} title={resolution ?? undefined}>
              {tag.text}
            </span>
          ) : null}
          {row.mentions > 1 ? <span className="n">×{row.mentions}</span> : null}
        </div>
        {title ? <div className="ttl">{title}</div> : null}
        {row.text ? (
          <div className="txt">
            <HqPlusText text={row.text} maxLines={4} />
          </div>
        ) : null}
        {row.chat || link ? (
          <div className="acts">
            {row.chat ? (
              <button
                type="button"
                className="hqp-link"
                onClick={() => row.chat && actions.openChat(row.chat)}
              >
                {translate('auto.hqPlus.brain.openChat', 'Open chat →')}
              </button>
            ) : null}
            {link ? (
              <button
                type="button"
                className="hqp-link"
                data-ghost={row.chat ? 'true' : undefined}
                title={link}
                onClick={(event) => (web ? actions.openLink(link, event) : actions.openFile(link))}
              >
                {web
                  ? `${hqPlusSourceLabel(link)} ↗`
                  : translate('auto.hqPlus.brain.openFile', 'Open file')}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Summary({
  result,
  actions
}: {
  result: HqBrainResult
  actions: HqPlusBrainActions
}): React.JSX.Element {
  return (
    <div className="hqp-brain-summary">
      {/* The model's short summary («Summary») comes in a later version; its line stays here. */}
      <div className="later">
        <b>{translate('auto.hqPlus.brain.summary', 'Summary')}:</b>{' '}
        {translate('auto.hqPlus.brain.summaryLater', 'next version')}
      </div>
      <div>
        <b>{translate('auto.hqPlus.brain.waiting', 'Waiting')}:</b>{' '}
        {result.waiting.length === 0 ? (
          <span className="mute">
            {result.closedWaits > 0
              ? translate(
                  'auto.hqPlus.brain.waitingNoneClosed',
                  'nothing — the last {{count}} waits are closed',
                  { count: result.closedWaits }
                )
              : translate('auto.hqPlus.brain.waitingNone', 'nothing')}
          </span>
        ) : (
          <ul className="waits">
            {result.waiting.map((wait) => (
              <li key={wait.id}>
                {wait.person ? (
                  <HqPlusBrainLink entity={wait.person} strong>
                    {wait.person}
                  </HqPlusBrainLink>
                ) : null}
                <span className="mute">
                  {wait.direction === 'on-me'
                    ? translate('auto.hqPlus.brain.waitsOnYou', ' waits on you · ')
                    : ' · '}
                </span>
                <HqPlusText text={wait.title} maxLines={2} />
                {wait.chat ? (
                  <button
                    type="button"
                    className="hqp-link"
                    onClick={() => wait.chat && actions.openChat(wait.chat)}
                  >
                    {translate('auto.hqPlus.brain.openChat', 'Open chat →')}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <b>{translate('auto.hqPlus.brain.people', 'People')}:</b>{' '}
        {result.people.length === 0 ? (
          <span className="mute">{translate('auto.hqPlus.brain.peopleNone', 'nobody yet')}</span>
        ) : (
          result.people.map((person, at) => (
            <span key={person.name}>
              {at > 0 ? <span className="mute"> · </span> : null}
              <HqPlusBrainLink entity={person.name}>{person.name}</HqPlusBrainLink>
              <span className="mute"> {person.count}</span>
            </span>
          ))
        )}
      </div>
    </div>
  )
}

function Head({ result }: { result: HqBrainResult }): React.JSX.Element {
  const { head } = result
  const idLike = head.kind === 'task' || head.kind === 'mr'
  const kind =
    result.mode === 'search'
      ? translate('auto.hqPlus.brain.searchKind', 'Search · {{count}} matches', {
          count: result.rows.length
        })
      : HQ_BRAIN_HEAD_LABEL[head.kind]
  return (
    <div className="hqp-brain-head">
      <div className="meta">
        {idLike ? <span className="id">{result.query}</span> : null}
        <span>
          {[kind, head.kind === 'project' ? null : head.project].filter(Boolean).join(' · ')}
        </span>
      </div>
      <h1>{head.title ?? result.query}</h1>
    </div>
  )
}

export function HqPlusBrain({
  query,
  backLabel,
  onQuery,
  onBack,
  actions,
  now,
  focusSearch
}: {
  query: string
  /** Grows by one each time ⌘K is pressed while Brain is open. */
  focusSearch: number
  /** Where «←» goes: the previous query, the feed, the map. */
  backLabel: string
  onQuery: (query: string) => void
  onBack: () => void
  actions: HqPlusBrainActions
  now: number
}): React.JSX.Element {
  const state = useHqPlusBrain(query)
  const [draft, setDraft] = useState(query)
  const [group, setGroup] = useState<HqBrainGroup | 'all'>('all')
  const [showCommands, setShowCommands] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(query)
    setGroup('all')
    setShowCommands(false)
    setShowAll(false)
    if (!query) {
      inputRef.current?.focus()
    }
  }, [query])

  // ⌘K again, with Brain already open, goes to the search box.
  useEffect(() => {
    if (focusSearch > 0) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [focusSearch])

  const result = state.status === 'ready' ? state.result : null
  const rows = useMemo(() => result?.rows ?? [], [result])
  const counts = useMemo(() => hqBrainGroupCounts(rows, showCommands), [rows, showCommands])
  const visible = useMemo(
    () => hqBrainVisibleRows(rows, group, showCommands),
    [rows, group, showCommands]
  )
  const shown = showAll ? visible : visible.slice(0, SHOWN_FIRST)
  const days = useMemo(() => hqBrainDays(shown), [shown])
  const commands = rows.filter((row) => row.command).length
  const chips: (HqBrainGroup | 'all')[] = [
    'all',
    ...HQ_BRAIN_GROUPS,
    ...(counts.other > 0 ? (['other'] as const) : [])
  ]

  return (
    <section className="hqp-brain" aria-label={translate('auto.hqPlus.brain', 'Brain')}>
      <div className="hqp-fh">
        <button type="button" className="hqp-pill" onClick={onBack}>
          ← {backLabel}
        </button>
        <span className="hqp-hl">{translate('auto.hqPlus.brain', 'Brain')}</span>
      </div>
      <div className="hqp-brain-scroll">
        <div className="hqp-brain-wrap">
          <form
            className="hqp-brain-search"
            onSubmit={(event) => {
              event.preventDefault()
              if (draft.trim()) {
                onQuery(draft.trim())
              }
            }}
          >
            <span aria-hidden="true">⌕</span>
            <input
              ref={inputRef}
              value={draft}
              aria-label={translate('auto.hqPlus.brain.search', 'Search the brain')}
              placeholder={translate(
                'auto.hqPlus.brain.placeholder',
                'DEV-123, !19, repo!19, a person, a project or words'
              )}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  event.stopPropagation()
                  if (draft !== query) {
                    setDraft(query)
                  } else {
                    onBack()
                  }
                }
              }}
            />
            <span className="kbd">⌘K</span>
          </form>

          {state.status === 'idle' ? (
            <p className="hqp-brain-hint">
              {translate(
                'auto.hqPlus.brain.hint',
                'Everything said about a task, an MR, a person or a project — chats, Slack, Approve, waits, ClickUp, MRs and docs — by day. A task id or a name in any HQ+ card opens it here too.'
              )}
            </p>
          ) : null}
          {state.status === 'loading' ? (
            <p className="hqp-brain-hint">
              {translate('auto.hqPlus.brain.loading', 'Looking for {{query}}…', {
                query: state.query
              })}
            </p>
          ) : null}
          {state.status === 'error' ? <p className="hqp-error">{state.message}</p> : null}

          {result ? (
            <>
              <Head result={result} />
              {result.mode === 'timeline' ? <Summary result={result} actions={actions} /> : null}
              <div
                className="hqp-brain-chips"
                role="group"
                aria-label={translate('auto.hqPlus.brain.sources', 'Sources')}
              >
                {chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    className="chip"
                    aria-pressed={group === chip}
                    disabled={chip !== 'all' && counts[chip] === 0}
                    onClick={() => setGroup(chip)}
                  >
                    {translate(`auto.hqPlus.brain.chip.${chip}`, HQ_BRAIN_CHIP_LABEL[chip])}
                    <span>{counts[chip]}</span>
                  </button>
                ))}
              </div>
              <div className="hqp-brain-feed">
                {days.length === 0 ? (
                  <p className="hqp-brain-hint">
                    {translate('auto.hqPlus.brain.empty', 'Nothing about {{query}} in the brain.', {
                      query: result.query
                    })}
                  </p>
                ) : null}
                {days.map(({ day, rows: dayRows }) => (
                  <div key={day}>
                    <div className="day">{hqBrainDayLabel(day, now)}</div>
                    {dayRows.map((row) => (
                      <Row key={row.id} row={row} actions={actions} />
                    ))}
                  </div>
                ))}
              </div>
              <footer className="hqp-brain-foot">
                <span>
                  {translate('auto.hqPlus.brain.shown', 'Shown {{shown}} of {{total}}', {
                    shown: shown.length,
                    total: visible.length
                  })}
                  {` · ${result.mode === 'search' ? 'ranked search' : `by ${result.matchedBy}`} · ${(result.ms / 1000).toFixed(1)} s`}
                </span>
                {visible.length > shown.length ? (
                  <button type="button" className="hqp-link" onClick={() => setShowAll(true)}>
                    {translate('auto.hqPlus.brain.showAll', 'Show all')}
                  </button>
                ) : null}
                {commands > 0 ? (
                  <button
                    type="button"
                    className="hqp-link"
                    data-ghost="true"
                    onClick={() => setShowCommands((on) => !on)}
                  >
                    {showCommands
                      ? translate('auto.hqPlus.brain.hideCommands', 'Hide command approvals')
                      : translate(
                          'auto.hqPlus.brain.showCommands',
                          'Show {{count}} command approvals',
                          { count: commands }
                        )}
                  </button>
                ) : null}
              </footer>
            </>
          ) : null}
        </div>
      </div>
    </section>
  )
}
