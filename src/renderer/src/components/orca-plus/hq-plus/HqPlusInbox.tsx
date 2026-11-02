// Custom build (hq-plus-inbox, owner 02.11: variant B): HQ+'s feed as one queue of what to do next, read
// top to bottom — the actions waiting for Approve, the chats that ask the owner, then the people's
// conversations on him, oldest first — each row naming its project and opening to the same card the
// project cards show. «We wait», «Working» and «Done today» are one line above, opened on a click.
import { useState } from 'react'
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
import { hqPlusInboxQueue } from './hq-plus-inbox'

type Drawer = 'wait' | 'working' | 'today' | null

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
  const empty =
    queue.approve.length + queue.asks.length + queue.moves.length + queue.fyi.length === 0 &&
    !(waitsInQueue && queue.persons.length > 0)
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
      {queue.approve.length > 0 ? (
        <section className="hqpi-group">
          <h4 className="hqpi-h" data-tone="ap">
            Approve first · {queue.approve.length}
          </h4>
          {queue.approve.map(({ slug, unsorted, line }) => (
            <div key={line.id} className="hqpc-ap hqpi-ap" id={`hqp-${line.id}`}>
              <span className="hqpi-of">{project(slug, unsorted).name}</span>
              <HqPlusLogCards items={[line.card]} ctx={ctx.log} bare />
            </div>
          ))}
        </section>
      ) : null}
      {queue.asks.length > 0 ? (
        <section className="hqpi-group">
          <h4 className="hqpi-h" data-tone="you">
            Chats ask you · {queue.asks.length}
          </h4>
          <ul className="hqpc-lines hqpc-chats">{queue.asks.map(chatRow)}</ul>
        </section>
      ) : null}
      {queue.moves.length > 0 ? (
        <section className="hqpi-group">
          <h4 className="hqpi-h" data-tone="you">
            Your move · {queue.moves.length} <span>oldest first</span>
          </h4>
          <ul className="hqpc-lines">
            {queue.moves.map(({ slug, unsorted, line }) => (
              <Line
                key={line.id}
                line={line}
                unsorted={unsorted}
                ctx={ctx}
                project={project(slug, unsorted)}
              />
            ))}
          </ul>
        </section>
      ) : null}
      {queue.fyi.length > 0 ? (
        <section className="hqpi-group">
          <h4 className="hqpi-h">
            FYI · {queue.fyi.length} <span>oldest first</span>
          </h4>
          <ul className="hqpc-lines">
            {queue.fyi.map(({ slug, unsorted, line }) => (
              <Line
                key={line.id}
                line={line}
                unsorted={unsorted}
                ctx={ctx}
                project={project(slug, unsorted)}
              />
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
      {empty ? <p className="hqp-empty">{emptyText}</p> : null}
    </div>
  )
}
