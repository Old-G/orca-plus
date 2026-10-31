// Custom build (hq-project-cards): the rows of a project card in HQ+ — a section's head with Show / Hide,
// a line that opens to the card itself, a person we wait for opening to their waits, and a chat opening
// to its chat card — and what they reach for.
import { useState } from 'react'
import type { HqPlusProjectPerson } from '../../../../../shared/hq-plus-project-cards'
import {
  hqPlusProjectChatLine,
  type HqPlusProjectChat,
  type HqPlusProjectLine
} from '../../../../../shared/hq-plus-project-lines'
import { hqPlusProjectAge } from '../../../../../shared/hq-plus-project-cards'
import type { HqPlusMapChatState } from '../../../../../shared/hq-plus-map'
import type { HqChatItem } from '../hq/hq-chat-list'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusLogCards, type HqPlusLogContext } from './HqPlusLog'
import { ChatCard } from './HqPlusChatCard'
import { HqPlusChatName } from './HqPlusChatName'
import { HqPlusCloseChat, type HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusProjectChip } from './HqPlusConversationCard'
import { HqPlusWeWaitCard } from './HqPlusWeWaitCard'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'

export type HqPlusProjectCardContext = {
  log: HqPlusLogContext
  queue: HqPlusQueueActions
  now: number
  /** The line a jump just went to, lit for a moment. */
  flashId: string | null
  roomName: (slug: string) => string | null
  /** The chat list's row of a chat, for its name and ×. */
  chatItem: (key: string) => HqChatItem | null
  closerOf: (item: HqChatItem) => HqPlusChatCloser | null
  showChat: (key: string) => void
  /** A new chat in the project; null when HQ+ knows no workspace of it. */
  newChat: (slug: string) => (() => void) | null
  openInOrca: (slug: string) => (() => void) | null
  personName: (personId: string) => string | null
  /** The «We wait» rows of these waitings, with their buttons (ask, re-check, snooze, close). */
  waitsOf: (ids: readonly string[]) => HqPlusOtherWait[]
}

const STATE_LABEL: Record<HqPlusMapChatState, string> = {
  asks: 'asks you',
  working: 'working',
  done: 'done',
  quiet: 'quiet'
}

export function Fold({
  label,
  open,
  onToggle,
  amber
}: {
  label: string
  open: boolean | null
  onToggle?: () => void
  amber?: boolean
}): React.JSX.Element {
  return (
    <div className="hqpc-sec">
      <span className="hqpc-lab" data-amber={amber ? 'true' : undefined}>
        {label}
      </span>
      {open !== null && onToggle ? (
        <button type="button" className="hqpc-fold" aria-expanded={open} onClick={onToggle}>
          {open ? 'Hide' : 'Show'}
        </button>
      ) : null}
    </div>
  )
}

function Line({
  line,
  unsorted,
  ctx
}: {
  line: HqPlusProjectLine
  unsorted: boolean
  ctx: HqPlusProjectCardContext
}): React.JSX.Element {
  const log = ctx.log
  const open = log.isExpanded(line.id)
  const chat = line.sessionId ? log.chatOf(line.sessionId) : null
  const who = line.who ?? (line.personId ? ctx.personName(line.personId) : null)
  // Why: a chat's own question is from that chat; its name says which one asks.
  const asker = !who && line.badge.tone === 'chat' ? chat : null
  const age = hqPlusProjectAge(line.since, ctx.now)
  return (
    <li
      className="hqpc-ln"
      data-open={open ? 'true' : undefined}
      id={`hqp-${line.id}`}
      // Why: the keys find the row and the reply box or × inside it; the feed marks it seen by this id.
      data-new={log.isNew(line.id) ? 'true' : undefined}
      data-selected={log.selectedId === line.id ? 'true' : undefined}
      data-flash={ctx.flashId === line.id ? 'true' : undefined}
      onClickCapture={() => log.onSelect(line.id)}
    >
      <div className="hqpc-rowwrap">
        <button
          type="button"
          className="hqpc-row"
          aria-expanded={open}
          onClick={() => log.setExpanded(line.id, !open)}
        >
          <HqPlusBadges badges={[line.badge]} />
          <span className="hqpc-t">
            {log.isNew(line.id) ? <span className="hqp-new">NEW</span> : null}
            {who ? (
              <b>{who}</b>
            ) : asker ? (
              <b>
                <HqPlusChatName chat={asker} />
              </b>
            ) : null}
            <span>
              {who || asker ? ' · ' : ''}
              {line.what}
            </span>
          </span>
          {chat && line.badge.tone !== 'chat' ? (
            <span className="hqpc-holder">
              <HqPlusChatName chat={chat} />
            </span>
          ) : null}
          <span className="hqpc-age" data-got={line.replied ? 'true' : undefined}>
            {line.replied ? `replied · ${age}` : age}
          </span>
        </button>
        {unsorted && line.card.conversation ? (
          <HqPlusProjectChip card={line.card} onChanged={log.onChanged} />
        ) : null}
      </div>
      {open ? (
        <div className="hqpc-open">
          <HqPlusLogCards items={[line.card]} ctx={log} bare />
        </div>
      ) : null}
    </li>
  )
}

export function Lines({
  lines,
  unsorted,
  ctx
}: {
  lines: readonly HqPlusProjectLine[]
  unsorted: boolean
  ctx: HqPlusProjectCardContext
}): React.JSX.Element {
  return (
    <ul className="hqpc-lines">
      {lines.map((line) => (
        <Line key={line.id} line={line} unsorted={unsorted} ctx={ctx} />
      ))}
    </ul>
  )
}

export function Person({
  person,
  ctx
}: {
  person: HqPlusProjectPerson
  ctx: HqPlusProjectCardContext
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const count = person.waits.length
  return (
    <li className="hqpc-ln" data-open={open ? 'true' : undefined}>
      <button
        type="button"
        className="hqpc-row"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <HqPlusBadges badges={[{ label: 'WAIT', tone: 'bg' }]} />
        <span className="hqpc-t">
          <b>{person.name}</b>
          <span>
            {' · '}
            {count === 1 ? (person.waits[0]?.title ?? '1 question') : `${count} questions`}
          </span>
        </span>
        <span className="hqpc-age">{hqPlusProjectAge(person.oldestAt, ctx.now)}</span>
      </button>
      {open ? (
        <div className="hqpc-open hqpc-waits">
          {ctx.waitsOf(person.waits.map((wait) => wait.id)).map((wait) => (
            <HqPlusWeWaitCard key={wait.id} wait={wait} actions={ctx.queue} />
          ))}
        </div>
      ) : null}
    </li>
  )
}

export function ChatRow({
  chat,
  open,
  onToggle,
  ctx
}: {
  chat: HqPlusProjectChat
  open: boolean
  onToggle: () => void
  ctx: HqPlusProjectCardContext
}): React.JSX.Element {
  const item = ctx.chatItem(chat.key)
  const closer = item ? ctx.closerOf(item) : null
  const line = hqPlusProjectChatLine(chat)
  return (
    <li className="hqpc-ln hqpc-chat" data-open={open ? 'true' : undefined}>
      <div className="hqpc-rowwrap">
        <button
          type="button"
          className="hqpc-row"
          aria-expanded={open}
          // Why: a terminal has no chat card; its row opens it on the right at once.
          onClick={line ? onToggle : () => ctx.showChat(chat.key)}
        >
          <span className="hqpc-dot" data-state={chat.state} />
          <span className="hqpc-t">
            {item ? <HqPlusChatName chat={{ item, name: null }} /> : chat.title}
          </span>
          <span className="hqpc-age" data-state={chat.state}>
            {STATE_LABEL[chat.state]}
          </span>
        </button>
        {closer ? <HqPlusCloseChat closer={closer} name={chat.title} /> : null}
      </div>
      {open && line ? (
        <div className="hqpc-open">
          <ChatCard
            item={line}
            badges={[{ label: 'CHAT', tone: 'chat' }]}
            tile={null}
            flash={false}
            openChat={() => ctx.showChat(chat.key)}
            ctx={ctx.log}
            bare
          />
        </div>
      ) : null}
    </li>
  )
}
