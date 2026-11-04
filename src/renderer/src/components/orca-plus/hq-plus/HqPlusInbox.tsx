// Custom build (hq-plus-inbox, owner 02.11: variant B; 04.11: one stream): HQ+'s feed as one stream read
// top to bottom, oldest first, newest at the bottom — Approves waiting, chats that ask, the
// people's conversations — each row naming its project and opening to the same card the project cards show. «We wait», «Working» and «Done today» are one line above, opened on a click.
import { useEffect, useRef, useState } from 'react'
import type {
  HqPlusProjectFeed as Feed,
  HqPlusProjectFilter
} from '../../../../../shared/hq-plus-project-cards'
import { HQ_PLUS_PROJECT_TODAY_LABEL } from '../../../../../shared/hq-plus-project-today'
import { hqPlusProjectChatLine } from '../../../../../shared/hq-plus-project-lines'
import { HqPlusLogCards } from './HqPlusLog'
import { HqPlusText } from './HqPlusText'
import { hqPlusClock } from './HqPlusChatCard'
import { ChatRow, Line, Person, type HqPlusProjectCardContext } from './HqPlusProjectParts'
import { hqPlusInboxQueue, type HqPlusInboxRow } from './hq-plus-inbox'

type Drawer = 'wait' | 'working' | 'today' | null

function streamRowId(row: HqPlusInboxRow): string {
  return row.type === 'ask' ? row.chat.key : row.line.id
}

export function HqPlusInbox({
  feed,
  filter,
  emptyText,
  ctx,
  ref
}: {
  feed: Feed
  /** The chip above the feed; «We wait» lists the people in the queue itself. */
  filter: HqPlusProjectFilter
  emptyText: string
  ctx: HqPlusProjectCardContext
  /** The scroller, for the feed to mark the rows the owner has seen. */
  ref?: React.Ref<HTMLDivElement>
}): React.JSX.Element {
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [chatKey, setChatKey] = useState<string | null>(null)
  const queue = hqPlusInboxQueue(feed)
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastRow = queue.stream.at(-1)
  const lastRowId = lastRow ? streamRowId(lastRow) : null
  const seenLast = useRef<string | null | undefined>(undefined)
  // Why: the newest row is the last one; open at it, and follow a new one only when the owner is
  // already at the bottom — never pull him away from a row he scrolled up to read.
  useEffect(() => {
    const end = bottomRef.current
    const scroller = end?.parentElement
    if (!end || !scroller || seenLast.current === lastRowId) {
      return
    }
    const first = seenLast.current === undefined
    const nearBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 160
    seenLast.current = lastRowId
    if (first || nearBottom) {
      end.scrollIntoView({ block: 'end' })
    }
  }, [lastRowId])
  const project = (slug: string, unsorted: boolean): { name: string; color: string | null } =>
    unsorted
      ? { name: 'No project', color: null }
      : { name: slug, color: ctx.log.projectColor(slug) }
  const toggle = (next: Drawer): void => setDrawer(drawer === next ? null : next)
  const openChat = (key: string, lineId: string | null): void => {
    const opening = chatKey !== key
    setChatKey(opening ? key : null)
    // Why: opened, the chat shows its whole last reply and the reply box at once.
    if (opening && lineId) {
      ctx.log.setExpanded(lineId, true)
    }
  }
  const waitsInQueue = filter === 'wait'
  const empty = queue.stream.length === 0 && !(waitsInQueue && queue.persons.length > 0)
  const persons = queue.persons.map(({ slug, unsorted, person }) => (
    <ul key={`${slug}:${person.name}`} className="hqpc-lines">
      <Person person={person} ctx={ctx} project={project(slug, unsorted)} />
    </ul>
  ))
  const chatRow = ({
    slug,
    unsorted,
    chat
  }: ReturnType<typeof hqPlusInboxQueue>['asks'][number]): React.JSX.Element => (
    <ChatRow
      key={chat.key}
      chat={chat}
      open={chatKey === chat.key}
      onToggle={() => openChat(chat.key, hqPlusProjectChatLine(chat)?.id ?? null)}
      ctx={ctx}
      project={project(slug, unsorted)}
    />
  )
  const streamRow = (row: HqPlusInboxRow): React.JSX.Element => {
    if (row.type === 'approve') {
      return (
        <div key={row.line.id} className="hqpc-ap hqpi-ap" id={`hqp-${row.line.id}`}>
          <span className="hqpi-of">{project(row.slug, row.unsorted).name}</span>
          <HqPlusLogCards items={[row.line.card]} ctx={ctx.log} bare />
        </div>
      )
    }
    if (row.type === 'ask') {
      return (
        <ul key={row.chat.key} className="hqpc-lines hqpc-chats">
          {chatRow(row)}
        </ul>
      )
    }
    return (
      <ul key={row.line.id} className="hqpc-lines">
        <Line
          line={row.line}
          unsorted={row.unsorted}
          ctx={ctx}
          project={project(row.slug, row.unsorted)}
        />
      </ul>
    )
  }
  return (
    <div className="hqp-log hqpi scrollbar-sleek" ref={ref}>
      <div className="hqpi-strip" role="group" aria-label="Around the queue">
        <button type="button" aria-expanded={drawer === 'wait'} onClick={() => toggle('wait')}>
          We wait <b>{queue.waits}</b>
        </button>
        <button
          type="button"
          aria-expanded={drawer === 'working'}
          onClick={() => toggle('working')}
        >
          Working <b>{queue.working.length}</b>
        </button>
        <button type="button" aria-expanded={drawer === 'today'} onClick={() => toggle('today')}>
          Done today <b>{queue.today.length}</b>
        </button>
      </div>
      {drawer === 'wait' && !waitsInQueue ? (
        <section className="hqpi-drawer">
          {persons}
          {queue.persons.length === 0 ? (
            <p className="hqp-empty">Nobody owes you anything.</p>
          ) : null}
        </section>
      ) : null}
      {drawer === 'working' ? (
        <section className="hqpi-drawer">
          <ul className="hqpc-lines hqpc-chats">{queue.working.map(chatRow)}</ul>
          {queue.working.length === 0 ? <p className="hqp-empty">No chat works now.</p> : null}
        </section>
      ) : null}
      {drawer === 'today' ? (
        <section className="hqpi-drawer">
          <ul className="hqpc-today">
            {queue.today.map(({ slug, row }) => (
              <li key={row.id}>
                <span className="hqpc-tt">{hqPlusClock(row.at)}</span>
                <span>
                  <b>{slug}</b> · <b>{HQ_PLUS_PROJECT_TODAY_LABEL[row.kind]}</b>
                  {row.to ? <span className="hqpc-to"> → {row.to}</span> : null}
                  <span className="hqpc-said">
                    <HqPlusText text={row.text} maxLines={2} />
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {waitsInQueue && queue.persons.length > 0 ? (
        <section className="hqpi-group">
          <h4 className="hqpi-h">
            We wait · {queue.waits} <span>oldest first</span>
          </h4>
          {persons}
        </section>
      ) : null}
      {queue.stream.length > 0 ? (
        <section className="hqpi-group hqpi-stream">
          {queue.stream.map((row) => streamRow(row))}
        </section>
      ) : null}
      {empty ? <p className="hqp-empty">{emptyText}</p> : null}
      <div ref={bottomRef} aria-hidden="true" />
    </div>
  )
}
