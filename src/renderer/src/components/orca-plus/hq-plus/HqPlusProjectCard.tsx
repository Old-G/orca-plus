// Custom build (hq-project-cards): one project's card in HQ+ (owner, 31.10: 1A, 2A). Custom build
// (hq-card-v2, owner 01.11: 1A, 2A, 3A): what holds an agent comes first — the outgoing actions waiting
// for Approve, open in full; then the project's chats, always on view, each with its state as the chat
// list says it, its last words and its question to the owner with the answer buttons; then the people's
// conversations on the owner, «We wait» and «Today» folded to a line. The feed and the Map's panel draw
// the same card.
import { useEffect, useState } from 'react'
import {
  hqPlusProjectWaitSummary,
  type HqPlusProjectCard as Card
} from '../../../../../shared/hq-plus-project-cards'
import { hqPlusProjectChatLine } from '../../../../../shared/hq-plus-project-lines'
import { HQ_PLUS_PROJECT_TODAY_LABEL } from '../../../../../shared/hq-plus-project-today'
import { HqPlusText } from './HqPlusText'
import { hqPlusClock } from './HqPlusChatCard'
import { HqPlusChatName } from './HqPlusChatName'
import { HqPlusLogCards } from './HqPlusLog'
import { ChatRow, Fold, Lines, Person, type HqPlusProjectCardContext } from './HqPlusProjectParts'
import './hq-plus-project-cards.css'

/** Custom build (hq-card-v2): more chats than this fold under «+N more». */
const CHATS_SHOWN = 5

function when(at: number, now: number): string {
  return new Date(at).toDateString() === new Date(now).toDateString()
    ? hqPlusClock(at)
    : new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

function colorStyle(color: string | null): React.CSSProperties | undefined {
  return color ? ({ '--hqpc-c': color } as React.CSSProperties) : undefined
}

export function HqPlusProjectCard({
  card,
  ctx
}: {
  card: Card
  ctx: HqPlusProjectCardContext
}): React.JSX.Element {
  // Why: «We wait» opens the people on view; Hide still folds them.
  const [waitOpen, setWaitOpen] = useState(!card.shown.you)
  useEffect(() => setWaitOpen(!card.shown.you), [card.shown.you])
  const [todayOpen, setTodayOpen] = useState(false)
  const [allChats, setAllChats] = useState(false)
  const [chatKey, setChatKey] = useState<string | null>(null)
  // Why: a jump to a chat (the Live feed, ⌘F) opens its row, which carries the chat's line id; one past
  // the first five shows them all.
  const flashedChat = card.chats.find(
    (chat) => ctx.flashId !== null && hqPlusProjectChatLine(chat)?.id === ctx.flashId
  )?.key
  const hits = card.chatHits.join('\n')
  useEffect(() => {
    if (flashedChat) {
      setChatKey(flashedChat)
    }
    if (flashedChat || hits) {
      setAllChats(true)
    }
  }, [flashedChat, hits])
  const [compactOpen, setCompactOpen] = useState(false)
  const now = ctx.now
  const color = card.unsorted ? null : ctx.log.projectColor(card.slug)
  const title = card.unsorted ? 'Unsorted' : card.slug
  const shown = card.shown
  const approveShown = shown.approve ? card.approve : []
  const youShown = shown.you ? card.you : []
  const fyiShown = shown.fyi ? card.fyi : []
  // Why: a project where we only wait is one line, not half a card (mock 31.10).
  if (card.compact && !compactOpen) {
    return (
      <article className="hqpc" data-compact="true" style={colorStyle(color)}>
        <button
          type="button"
          className="hqpc-head hqpc-compact"
          aria-expanded={false}
          onClick={() => setCompactOpen(true)}
        >
          <i className="hqpc-pdot" />
          <h3>{title}</h3>
          <span className="hqpc-pill">We wait · {card.waits}</span>
          <span className="hqpc-sum">{hqPlusProjectWaitSummary(card, now)}</span>
        </button>
      </article>
    )
  }
  const startChat = card.unsorted ? null : ctx.newChat(card.slug)
  const leave = card.unsorted ? null : ctx.openInOrca(card.slug)
  const room = card.unsorted ? null : ctx.roomName(card.slug)
  const openWaits = waitOpen || compactOpen
  const asks = card.chats.filter((chat) => chat.question || chat.state === 'asks').length
  const working = card.chats.filter((chat) => chat.state === 'working').length
  const chats = allChats ? card.chats : card.chats.slice(0, CHATS_SHOWN)
  return (
    <article
      className="hqpc"
      id={`hqpc-${card.slug}`}
      data-ap={card.approve.length > 0 ? 'true' : undefined}
      data-you={card.approve.length === 0 && asks > 0 ? 'true' : undefined}
      style={colorStyle(color)}
    >
      <div className="hqpc-head">
        <i className="hqpc-pdot" />
        <h3>{title}</h3>
        {room ? <span className="hqpc-room">{room}</span> : null}
        {card.approve.length > 0 ? (
          <span className="hqpc-pill" data-tone="ap">
            Approve · {card.approve.length}
          </span>
        ) : null}
        {asks > 0 ? (
          <span className="hqpc-pill" data-tone="ask">
            Asks you · {asks}
          </span>
        ) : null}
        {working > 0 ? <span className="hqpc-pill">Working · {working}</span> : null}
        {card.you.length > 0 ? (
          <span className="hqpc-pill">Your move · {card.you.length}</span>
        ) : null}
        {card.waits > 0 ? <span className="hqpc-pill">We wait · {card.waits}</span> : null}
        {card.lastAt > 0 ? <span className="hqpc-tm">{when(card.lastAt, now)}</span> : null}
      </div>
      {approveShown.length > 0 ? (
        <>
          <Fold label={`Approve · ${approveShown.length}`} open={null} tone="ap" />
          {approveShown.map((line) => (
            <div key={line.id} className="hqpc-ap" id={`hqp-${line.id}`}>
              <HqPlusLogCards items={[line.card]} ctx={ctx.log} bare />
            </div>
          ))}
        </>
      ) : null}
      {shown.chats && (card.chats.length > 0 || startChat) ? (
        <>
          <Fold
            label={`Chats · ${card.chats.length}`}
            open={null}
            extra={
              <>
                {startChat ? (
                  <button type="button" className="hqpc-fold" onClick={startChat}>
                    + New chat
                  </button>
                ) : null}
                {leave ? (
                  <button
                    type="button"
                    className="hqpc-fold"
                    onClick={leave}
                    title="Leaves HQ+ for this project in Orca"
                  >
                    Open in Orca ⇥
                  </button>
                ) : null}
              </>
            }
          />
          {card.chats.length > 0 ? (
            <ul className="hqpc-lines hqpc-chats">
              {chats.map((chat) => (
                <ChatRow
                  key={chat.key}
                  chat={chat}
                  open={chatKey === chat.key}
                  onToggle={() => {
                    const opening = chatKey !== chat.key
                    setChatKey(opening ? chat.key : null)
                    const line = hqPlusProjectChatLine(chat)
                    // Why: opened, the chat shows its whole last reply and the reply box at once.
                    if (opening && line) {
                      ctx.log.setExpanded(line.id, true)
                    }
                  }}
                  ctx={ctx}
                />
              ))}
            </ul>
          ) : null}
          {chats.length < card.chats.length ? (
            <button type="button" className="hqpc-sum" onClick={() => setAllChats(true)}>
              +{card.chats.length - chats.length} more
            </button>
          ) : null}
        </>
      ) : null}
      {youShown.length > 0 ? (
        <>
          <Fold label={`Your move · ${youShown.length}`} open={null} tone="you" />
          <Lines lines={youShown} unsorted={card.unsorted} ctx={ctx} />
        </>
      ) : null}
      {fyiShown.length > 0 ? (
        <>
          <Fold label={`FYI · ${fyiShown.length}`} open={null} />
          <Lines lines={fyiShown} unsorted={card.unsorted} ctx={ctx} />
        </>
      ) : null}
      {shown.wait && card.persons.length > 0 ? (
        <>
          <Fold
            label={`We wait · ${card.waits}`}
            open={openWaits}
            onToggle={() => {
              setWaitOpen(!openWaits)
              setCompactOpen(false)
            }}
          />
          {openWaits ? (
            <ul className="hqpc-lines">
              {card.persons.map((person) => (
                <Person key={person.name} person={person} ctx={ctx} />
              ))}
            </ul>
          ) : (
            <button type="button" className="hqpc-sum" onClick={() => setWaitOpen(true)}>
              {hqPlusProjectWaitSummary(card, now)}
            </button>
          )}
        </>
      ) : null}
      {shown.today && card.today.length > 0 ? (
        <>
          <Fold
            label={`Today · ${card.today.length}`}
            open={todayOpen}
            onToggle={() => setTodayOpen(!todayOpen)}
          />
          {todayOpen ? (
            <ul className="hqpc-today">
              {card.today.map((row) => {
                const chat = row.sessionId ? ctx.log.chatOf(row.sessionId) : null
                return (
                  <li key={row.id}>
                    <span className="hqpc-tt">{hqPlusClock(row.at)}</span>
                    <span>
                      <b>{HQ_PLUS_PROJECT_TODAY_LABEL[row.kind]}</b>
                      {row.to ? <span className="hqpc-to"> → {row.to}</span> : null}
                      <span className="hqpc-said">
                        <HqPlusText text={row.text} maxLines={2} />
                      </span>
                      {chat ? (
                        <span className="hqpc-by">
                          <HqPlusChatName chat={chat} onOpen={ctx.log.openChat(row.sessionId)} />
                        </span>
                      ) : null}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <button type="button" className="hqpc-sum" onClick={() => setTodayOpen(true)}>
              <b>{HQ_PLUS_PROJECT_TODAY_LABEL[card.today[0].kind]}</b>
              {card.today[0].to ? ` → ${card.today[0].to}` : ''}: {card.today[0].text}
              {card.today.length > 1 ? ` · and ${card.today.length - 1} more` : ''}
            </button>
          )}
        </>
      ) : null}
    </article>
  )
}
