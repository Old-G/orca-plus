// Custom build (hq-project-cards): one project's card in HQ+ (owner, 31.10: 1A, 2A) — the head with its
// counts, Chat and «Open in Orca ⇥»; «Your move» as one line per conversation that opens to the card
// itself (You asked → the answer, Reply / Send to chat / Open ↗ / Done); «We wait» folded to one line;
// «Today» folded to its first row; the project's chats, each opening to its chat card. The feed and
// the Map's panel draw the same card.
import { useEffect, useState } from 'react'
import {
  hqPlusProjectChatSummary,
  hqPlusProjectWaitSummary,
  type HqPlusProjectCard as Card
} from '../../../../../shared/hq-plus-project-cards'
import { hqPlusProjectChatLine } from '../../../../../shared/hq-plus-project-lines'
import { HQ_PLUS_PROJECT_TODAY_LABEL } from '../../../../../shared/hq-plus-project-today'
import { HqPlusText } from './HqPlusText'
import { hqPlusClock } from './HqPlusChatCard'
import { HqPlusChatName } from './HqPlusChatName'
import { ChatRow, Fold, Lines, Person, type HqPlusProjectCardContext } from './HqPlusProjectParts'
import './hq-plus-project-cards.css'

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
  const [chatsOpen, setChatsOpen] = useState(false)
  // Why: words ⌘F found in a chat's reply open the chats.
  const hits = card.chatHits.join('\n')
  useEffect(() => {
    if (hits) {
      setChatsOpen(true)
    }
  }, [hits])
  const [chatKey, setChatKey] = useState<string | null>(null)
  // Why: a jump to a chat (the Live feed, ⌘F) opens its row, which carries the chat's line id.
  const flashedChat = card.chats.find(
    (chat) => ctx.flashId !== null && hqPlusProjectChatLine(chat)?.id === ctx.flashId
  )?.key
  useEffect(() => {
    if (flashedChat) {
      setChatsOpen(true)
      setChatKey(flashedChat)
    }
  }, [flashedChat])
  const [compactOpen, setCompactOpen] = useState(false)
  const now = ctx.now
  const color = card.unsorted ? null : ctx.log.projectColor(card.slug)
  const title = card.unsorted ? 'Unsorted' : card.slug
  const shown = card.shown
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
  const asking = card.chats.find((chat) => chat.state === 'asks') ?? card.chats[0] ?? null
  const startChat = card.unsorted ? null : ctx.newChat(card.slug)
  const leave = card.unsorted ? null : ctx.openInOrca(card.slug)
  const room = card.unsorted ? null : ctx.roomName(card.slug)
  const openWaits = waitOpen || compactOpen
  return (
    <article
      className="hqpc"
      data-you={card.you.length > 0 ? 'true' : undefined}
      style={colorStyle(color)}
    >
      <div className="hqpc-head">
        <i className="hqpc-pdot" />
        <h3>{title}</h3>
        {room ? <span className="hqpc-room">{room}</span> : null}
        {card.you.length > 0 ? (
          <span className="hqpc-pill" data-you="true">
            Your move · {card.you.length}
          </span>
        ) : null}
        {card.waits > 0 ? <span className="hqpc-pill">We wait · {card.waits}</span> : null}
        {card.lastAt > 0 ? <span className="hqpc-tm">{when(card.lastAt, now)}</span> : null}
      </div>
      {asking || startChat || leave ? (
        <div className="hqpc-acts">
          {asking ? (
            <button
              type="button"
              className="hqp-pill"
              data-main={asking.state === 'asks' ? 'true' : undefined}
              onClick={() => ctx.showChat(asking.key)}
            >
              Chat
            </button>
          ) : startChat ? (
            <button type="button" className="hqp-pill" onClick={startChat}>
              + New chat
            </button>
          ) : null}
          {leave ? (
            <button
              type="button"
              className="hqp-pill"
              onClick={leave}
              title="Leaves HQ+ for this project in Orca"
            >
              Open in Orca ⇥
            </button>
          ) : null}
        </div>
      ) : null}
      {youShown.length > 0 ? (
        <>
          <Fold label={`Your move · ${youShown.length}`} open={null} amber />
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
      {shown.chats && card.chats.length > 0 ? (
        <>
          <Fold
            label={`Chats · ${card.chats.length}`}
            open={chatsOpen}
            onToggle={() => setChatsOpen(!chatsOpen)}
          />
          {chatsOpen ? (
            <ul className="hqpc-lines">
              {card.chats.map((chat) => (
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
          ) : (
            <button type="button" className="hqpc-sum" onClick={() => setChatsOpen(true)}>
              {hqPlusProjectChatSummary(card.chats)}
            </button>
          )}
        </>
      ) : null}
    </article>
  )
}
