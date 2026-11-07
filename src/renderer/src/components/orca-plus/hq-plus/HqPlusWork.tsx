// Custom build (hq-plus-work-view, owner 06.11): HQ+'s «Work» view — the «By work» tree on the whole
// screen. «Needs you» on top (the tree's chats that wait on the owner, each opens on the right), then a
// block per lead with its chats as a table, and the work's chats closed today folded at the bottom.
// Facts only: the last report is the chat's own first line, the MR the one its reply names.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible'
import type { HqLiveSession } from '../../../../../shared/hq-sessions'
import type { HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'
import type { HqPlusTreeRow } from './hq-plus-chat-tree'
import {
  HQ_PLUS_WORK_CLOSED_HEADING,
  hqPlusFirstLine,
  hqPlusMrOf,
  type HqPlusWorkModel,
  type HqPlusWorkRun
} from './hq-plus-work-view'
import { useHqPlusChatChip } from './use-hq-plus-chat-chip'
import type { HqPlusOtherWait } from './HqPlusSideQueues'

export type HqPlusWorkActions = {
  now: number
  /** The key of the chat open on the right. */
  picked: string | null
  onOpen: (item: HqChatItem) => void
  /** A closed chat comes back from History. */
  onOpenClosed: (session: HqLiveSession) => void
  slugOf: (item: HqChatItem) => string
  colorOf: (item: HqChatItem) => string | null
  /** A project's colour by its HQ name, for a closed chat. */
  colorOfProject: (project: string | null) => string | null
  /** A chat's name from the dispatcher, for a lead that is not on view. */
  nameOf: (sessionId: string) => string | null
  /** What we wait for from a person on this chat's behalf. */
  waitOf: (item: HqChatItem) => HqPlusOtherWait | null
}

const TASK = /\b[A-Z][A-Z0-9]+-\d+\b/

function lastReportOf(item: HqChatItem, reply: string | null): string | null {
  return (
    hqPlusFirstLine(reply ?? item.card?.lastAgentMessage) ??
    hqPlusFirstLine(item.card?.askSummary) ??
    null
  )
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function ProjectChip({ name, color }: { name: string; color: string | null }): React.JSX.Element {
  return (
    <span className="hqw-chip" style={color ? { color } : undefined} title={name}>
      {name}
    </span>
  )
}

function NeedCard({
  item,
  actions
}: {
  item: HqChatItem
  actions: HqPlusWorkActions
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  const { reply } = useHqPlusChatChip(item, actions.now, true)
  const text = lastReportOf(item, reply)
  const task = TASK.exec(title)?.[0] ?? TASK.exec(text ?? '')?.[0] ?? title
  return (
    <div className="hqw-need" aria-current={actions.picked === item.key ? 'true' : undefined}>
      <span className="hqw-need-m">
        <span style={{ color: actions.colorOf(item) ?? undefined }}>{actions.slugOf(item)}</span>
        {' · '}
        {task}
      </span>
      <span className="hqw-need-t">{text ?? title}</span>
      <button type="button" className="hqw-open" onClick={() => actions.onOpen(item)}>
        {translate('auto.hqPlus.work.open', 'Open')}
      </button>
    </div>
  )
}

function WorkRow({
  row,
  actions
}: {
  row: HqPlusTreeRow
  actions: HqPlusWorkActions
}): React.JSX.Element {
  const { item } = row
  const title = useHqChatTitle(item)
  const { chip, live, reply } = useHqPlusChatChip(item, actions.now, true)
  const waitsOn = actions.waitOf(item)
  const last =
    lastReportOf(item, reply) ??
    (waitsOn
      ? translate('auto.hqPlus.side.waitsFor', 'Waits for {{who}} · {{what}}', {
          who: waitsOn.who ?? translate('auto.hqPlus.side.someone', 'someone'),
          what: waitsOn.title
        })
      : null)
  const mr = hqPlusMrOf(reply ?? item.card?.lastAgentMessage)
  return (
    <button
      type="button"
      className="hqw-tr"
      data-you={item.group === 'needs' ? 'true' : undefined}
      data-live={live ? 'true' : undefined}
      aria-current={actions.picked === item.key ? 'true' : undefined}
      title={reply ? hqPlusFirstLine(reply)?.slice(0, 300) : undefined}
      onClick={() => actions.onOpen(item)}
    >
      <span className="hqw-nm" style={{ '--hqw-depth': row.depth } as React.CSSProperties}>
        {row.depth > 0 ? (
          <span className="hqw-hook" aria-hidden="true">
            ↳
          </span>
        ) : null}
        <span className="hqw-tt">{title}</span>
        {row.children > 0 ? <span className="hqp-pc-kids">{row.children}</span> : null}
      </span>
      <span>
        <ProjectChip name={actions.slugOf(item)} color={actions.colorOf(item)} />
      </span>
      <span>
        {chip ? (
          <span className="hqp-badge" data-tone={chip.tone}>
            {chip.label}
          </span>
        ) : (
          <span className="hqw-faint">{translate('auto.hqPlus.side.nothing', 'Idle')}</span>
        )}
      </span>
      <span className="hqw-last">{last ?? ''}</span>
      <span className="hqw-mr">{mr ?? ''}</span>
      <span className="hqw-age">
        {item.sortAt ? formatRelativeTime(item.sortAt, actions.now) : ''}
      </span>
    </button>
  )
}

function RunTitle({ lead }: { lead: HqChatItem }): React.JSX.Element {
  return <span className="hqw-rt">{useHqChatTitle(lead)}</span>
}

function Run({
  run,
  actions
}: {
  run: HqPlusWorkRun
  actions: HqPlusWorkActions
}): React.JSX.Element {
  const { counts } = run
  const summary = [
    plural(counts.chats, 'chat', 'chats'),
    plural(counts.projects, 'project', 'projects'),
    counts.working > 0 ? `${counts.working} working` : null,
    counts.needsYou > 0 ? `${counts.needsYou} needs you` : null
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <section className="hqw-run">
      <header className="hqw-run-h">
        <span className="hqw-rk">LEAD</span>
        {run.lead ? (
          <RunTitle lead={run.lead} />
        ) : (
          <>
            <span className="hqw-rt">
              {(run.leadSession ? actions.nameOf(run.leadSession) : null) ??
                translate('auto.hqPlus.work.closedLead', 'A closed chat')}
            </span>
            <span className="hqw-faint">
              {translate('auto.hqPlus.work.leadNotOpen', 'not open')}
            </span>
          </>
        )}
        <span className="hqw-rs">{summary}</span>
      </header>
      <div className="hqw-table">
        <div className="hqw-tr hqw-hd" aria-hidden="true">
          <span>{translate('auto.hqPlus.work.col.chat', 'Chat')}</span>
          <span>{translate('auto.hqPlus.work.col.project', 'Project')}</span>
          <span>{translate('auto.hqPlus.work.col.status', 'Status')}</span>
          <span>{translate('auto.hqPlus.work.col.last', 'Last report')}</span>
          <span>{translate('auto.hqPlus.work.col.mr', 'MR')}</span>
          <span className="hqw-age">{translate('auto.hqPlus.work.col.age', 'Age')}</span>
        </div>
        {run.rows.map((row) => (
          <WorkRow key={row.item.key} row={row} actions={actions} />
        ))}
      </div>
    </section>
  )
}

export function HqPlusWork({
  model,
  actions,
  newChat
}: {
  model: HqPlusWorkModel
  actions: HqPlusWorkActions
  /** Custom build (hq-plus-work-view, owner 07.11): «+ Chat» — a new chat in any project from Work. */
  newChat?: React.ReactNode
}): React.JSX.Element {
  const [showClosed, setShowClosed] = useState(false)
  return (
    <div className="hqw" aria-label={translate('auto.hqPlus.work.label', 'Work')}>
      {newChat ? <div className="hqw-bar">{newChat}</div> : null}
      {model.needsYou.length > 0 ? (
        <section className="hqw-needs">
          <div className="hqw-needs-h">
            {translate('auto.hqPlus.work.needsYou', 'NEEDS YOU · {{count}}', {
              count: model.needsYou.length
            })}
          </div>
          <div className="hqw-needs-list">
            {model.needsYou.map((item) => (
              <NeedCard key={item.key} item={item} actions={actions} />
            ))}
          </div>
        </section>
      ) : null}
      {model.runs.length === 0 ? (
        <p className="hqp-empty hqp-quiet">
          {translate(
            'auto.hqPlus.work.empty',
            'No chat has started others yet. A lead chat and its workers show here.'
          )}
        </p>
      ) : null}
      {model.runs.map((run) => (
        <Run key={run.key} run={run} actions={actions} />
      ))}
      {model.closedActiveToday.length > 0 ? (
        <Collapsible open={showClosed} onOpenChange={setShowClosed}>
          <button
            type="button"
            className="hqp-idle-h hqw-closed-h"
            aria-expanded={showClosed}
            onClick={() => setShowClosed(!showClosed)}
          >
            <span className="hqp-caret" data-open={showClosed} aria-hidden="true">
              ▸
            </span>
            {translate('auto.hqPlus.work.closedActiveToday', HQ_PLUS_WORK_CLOSED_HEADING, {
              count: model.closedActiveToday.length
            })}
          </button>
          <CollapsibleContent animation="height">
            <div className="hqw-closed">
              {model.closedActiveToday.map((session) => (
                <button
                  key={session.sessionId}
                  type="button"
                  className="hqw-closed-row"
                  onClick={() => actions.onOpenClosed(session)}
                >
                  <span className="hqw-tt">
                    {session.name ?? translate('auto.hqPlus.chat', 'chat')}
                  </span>
                  {session.project ? (
                    <ProjectChip
                      name={session.project}
                      color={actions.colorOfProject(session.project)}
                    />
                  ) : (
                    <span />
                  )}
                  <span className="hqw-age">
                    {formatRelativeTime(session.lastActivityAt, actions.now)}
                  </span>
                </button>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
