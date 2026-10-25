// Custom build (hq-closed-loop): People in HQ+ — on the right, the people the owner works with (or
// everyone, by search) and one person's dossier: role, projects, where to write them, what is open
// both ways, what went to them, «Write» through ask-person and Approve. On the left, the busiest few.
import { useState } from 'react'
import {
  hqDossierGaps,
  hqFillDossierPrompt,
  hqMeetingPrepPrompt,
  hqPersonChannelLine,
  hqPlusPeopleList,
  hqWritePersonPrompt,
  isHqPlusPersonOfMine,
  type HqPeopleRow,
  type HqPersonCardItem
} from '../../../../../shared/hq-people'
import { translate } from '@/i18n/i18n'
import { startHqChatWithPrompt } from '../hq/hq-ask-chat'
import { useHqPersonCard } from '../hq/HqPersonCard'

const ITEMS_MAX = 4
const NOTES_MAX = 10
const TILE_COLORS = ['#1f4d3a', '#54422a', '#28465a', '#3a2e54', '#2e3f5a', '#5a2a2a', '#4a2e54']

export type HqPlusPeopleState = { people: HqPeopleRow[]; error: string | null; loaded: boolean }

function initials(name: string): string {
  const words = name.split(/\s+/).filter(Boolean)
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : name.slice(0, 2)).toUpperCase()
}

function tileColor(key: string): string {
  let hash = 0
  for (const char of key) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0
  }
  return TILE_COLORS[Math.abs(hash) % TILE_COLORS.length]
}

function PersonTile({ row }: { row: HqPeopleRow }): React.JSX.Element {
  const style: React.CSSProperties & Record<'--hqp-room', string> = {
    '--hqp-room': tileColor(row.key)
  }
  return (
    <span className="hqp-tile" style={style} aria-hidden="true">
      {initials(row.name)}
    </span>
  )
}

function waitsLabel(row: HqPeopleRow): string | null {
  if (row.onThem > 0) {
    return translate('auto.hqPlus.people.weWait', 'we wait · {{count}}', { count: row.onThem })
  }
  return row.onMe > 0
    ? translate('auto.hqPlus.people.theyWait', 'waits on you · {{count}}', { count: row.onMe })
    : null
}

function subline(row: HqPeopleRow): string {
  const projects = (row.projects ?? []).map((entry) => entry.slug).join(' · ')
  return [row.jobTitle, projects].filter(Boolean).join(' · ')
}

/** The right panel's People tab: the list, or one person's dossier. */
export function HqPlusPeople({
  state,
  picked,
  onPick,
  hqWorktreeId
}: {
  state: HqPlusPeopleState
  picked: string | null
  onPick: (key: string | null) => void
  hqWorktreeId: string | null
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [mine, setMine] = useState(true)
  const row = picked ? (state.people.find((entry) => entry.key === picked) ?? null) : null
  if (row) {
    return <Dossier row={row} hqWorktreeId={hqWorktreeId} onBack={() => onPick(null)} />
  }
  const mineCount = state.people.filter(isHqPlusPersonOfMine).length
  const shown = hqPlusPeopleList(state.people, { mine, query })
  return (
    <div className="hqp-people">
      <div className="hqp-people-f">
        <label className="hqp-search">
          <input
            className="hqp-search-in"
            value={query}
            placeholder={translate('auto.hqPlus.people.search', 'Name, @slack, project…')}
            aria-label={translate('auto.hqPlus.people.searchLabel', 'Search people')}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="hqp-chip-btn"
          aria-pressed={mine}
          onClick={() => setMine(true)}
        >
          {translate('auto.hqPlus.people.mine', 'You work with · {{count}}', { count: mineCount })}
        </button>
        <button
          type="button"
          className="hqp-chip-btn"
          aria-pressed={!mine}
          onClick={() => setMine(false)}
        >
          {translate('auto.hqPlus.people.everyone', 'All · {{count}}', {
            count: state.people.length
          })}
        </button>
      </div>
      {state.error ? <p className="hqp-empty">{state.error}</p> : null}
      {state.loaded && shown.length === 0 ? (
        <p className="hqp-empty hqp-quiet">
          {translate('auto.hqPlus.people.none', 'Nobody matches.')}
        </p>
      ) : null}
      <div className="hqp-people-list">
        {shown.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className="hqp-prow"
            onClick={() => onPick(entry.key)}
          >
            <PersonTile row={entry} />
            <span className="who">
              <span className="t">{entry.name}</span>
              <span className="m">{subline(entry)}</span>
            </span>
            <span className="w">{waitsLabel(entry) ?? ''}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function Items({ title, items }: { title: string; items: HqPersonCardItem[] }): React.JSX.Element {
  return (
    <>
      <dt>{title}</dt>
      <dd>
        {items.length === 0
          ? '—'
          : items.slice(0, ITEMS_MAX).map((entry) => (
              <div key={entry.id}>
                {entry.title}
                {entry.project ? <span className="hqp-quiet"> · {entry.project}</span> : null}
              </div>
            ))}
      </dd>
    </>
  )
}

function Dossier({
  row,
  hqWorktreeId,
  onBack
}: {
  row: HqPeopleRow
  hqWorktreeId: string | null
  onBack: () => void
}): React.JSX.Element {
  const card = useHqPersonCard(row.key, row.onMe + row.onThem)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gaps = hqDossierGaps(row)
  const write = hqPersonChannelLine(row.channel)
  const ready = card.status === 'ready' ? card.card : null
  const notes = (ready?.notes ?? '').split('\n').filter((line) => line.trim())
  const start = (prompt: string, name: string): void => {
    if (!hqWorktreeId || busy) {
      return
    }
    setBusy(true)
    setError(null)
    void startHqChatWithPrompt(hqWorktreeId, prompt, name).then((started) => {
      setBusy(false)
      setError(started.ok ? null : started.message)
    })
  }
  const ids = [
    row.slackHandle ? `@${row.slackHandle}` : null,
    row.slackUserId,
    row.email,
    row.clickupUserId ? `ClickUp ${row.clickupUserId}` : null
  ].filter(Boolean)
  return (
    <div className="hqp-people">
      <button type="button" className="hqp-link" onClick={onBack}>
        ‹ {translate('auto.hqPlus.tab.people', 'People')}
      </button>
      <div className="hqp-dossier">
        <div className="hqp-dossier-who">
          <PersonTile row={row} />
          <div>
            <h3>{row.name}</h3>
            <p>
              {[row.orgName !== row.name ? row.orgName : null, row.jobTitle, row.department]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        </div>
        {gaps.length > 0 ? (
          <p className="hqp-dossier-gap">
            {translate(
              'auto.hqPlus.people.gap',
              'The dossier does not say {{what}} yet; «Fill in» asks you only that.',
              {
                what: gaps
                  .map((gap) =>
                    gap === 'projects'
                      ? translate('auto.hqPlus.people.gapProjects', 'their projects')
                      : translate('auto.hqPlus.people.gapChannel', 'where to write them')
                  )
                  .join(', ')
              }
            )}
          </p>
        ) : null}
        <dl className="hqp-rep hqp-dossier-kv">
          <dt>{translate('auto.hqPlus.people.projects', 'projects')}</dt>
          <dd>
            {(row.projects ?? []).length === 0
              ? '—'
              : (row.projects ?? []).map((entry) => (
                  <span key={entry.slug} className="hqp-chip hqp-dossier-pill">
                    {entry.slug}
                    {entry.role ? <small> {entry.role}</small> : null}
                  </span>
                ))}
          </dd>
          <dt>{translate('auto.hqPlus.people.decides', 'decides')}</dt>
          <dd>{(row.decides ?? []).join('; ') || '—'}</dd>
          <dt>{translate('auto.hqPlus.people.write', 'write')}</dt>
          <dd>{write ?? '—'}</dd>
          <dt>{translate('auto.hqPlus.people.ids', 'ids')}</dt>
          <dd className="hqp-dossier-ids">{ids.join(' · ') || '—'}</dd>
          {row.timezone ? (
            <>
              <dt>{translate('auto.hqPlus.people.timezone', 'timezone')}</dt>
              <dd>{row.timezone}</dd>
            </>
          ) : null}
          {ready ? (
            <>
              <Items
                title={translate('auto.hqPlus.people.weWaitOn', 'we wait on them')}
                items={ready.onThem}
              />
              <Items
                title={translate('auto.hqPlus.people.waitsOnUs', 'they wait on us')}
                items={ready.onMe}
              />
              <Items
                title={translate('auto.hqPlus.people.sent', 'sent via Approve')}
                items={ready.sent}
              />
            </>
          ) : null}
        </dl>
        {notes.length > 0 ? (
          <div className="hqp-dossier-notes">
            {notes.slice(0, NOTES_MAX).map((line, index) => (
              <p key={index}>{line.replace(/\*\*/g, '')}</p>
            ))}
          </div>
        ) : null}
        <div className="hqp-opts">
          <button
            type="button"
            className="hqp-opt"
            data-main="true"
            disabled={busy || !hqWorktreeId}
            title={translate(
              'auto.hqPlus.people.writeHint',
              'An HQ chat asks what to say; the message waits for your Approve'
            )}
            onClick={() =>
              start(
                hqWritePersonPrompt(row),
                translate('auto.hqPlus.people.writeChat', 'Write · {{name}}', { name: row.name })
              )
            }
          >
            {translate('auto.hqPlus.people.writeButton', 'Write')}
          </button>
          <button
            type="button"
            className="hqp-opt"
            disabled={busy || !hqWorktreeId}
            onClick={() =>
              start(
                hqMeetingPrepPrompt(row),
                translate('auto.hq.people.prepChat', 'Meeting · {{name}}', { name: row.name })
              )
            }
          >
            {translate('auto.hqPlus.people.meeting', 'Before a meeting')}
          </button>
          {gaps.length > 0 ? (
            <button
              type="button"
              className="hqp-opt"
              data-ghost="true"
              disabled={busy || !hqWorktreeId}
              onClick={() =>
                start(
                  hqFillDossierPrompt(row),
                  translate('auto.hqPlus.people.fillChat', 'Dossier · {{name}}', {
                    name: row.name
                  })
                )
              }
            >
              {translate('auto.hqPlus.people.fill', 'Fill in')}
            </button>
          ) : null}
        </div>
        {error ? <p className="hqp-empty">{error}</p> : null}
        {row.pagePath ? <p className="hqp-quiet hqp-dossier-page">HQ/{row.pagePath}</p> : null}
      </div>
    </div>
  )
}
