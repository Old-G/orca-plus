// Custom build (hq-project-cards): one project's card on the phone, the desktop's own — the head with its
// counts, Chat and Workspace ⇥; «Your move» as one line per conversation that opens to its card;
// «We wait» folded to one line, then to the people and what we asked; «Today» folded to its first
// row; the project's chats, each opening to its chat card with Open chat and ×.
import { useEffect, useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  hqPlusProjectChatSummary,
  hqPlusProjectWaitSummary,
  type HqPlusProjectCard
} from '../../../src/shared/hq-plus-project-cards'
import type { HqPlusProjectLine } from '../../../src/shared/hq-plus-project-lines'
import { HQ_PLUS_PROJECT_TODAY_LABEL } from '../../../src/shared/hq-plus-project-today'
import { hqp } from './hq-plus-phone-theme'
import { hqPlusPhoneBreakName } from './hq-plus-phone-map'
import { clock } from './mobile-hq-plus-parts'
import {
  Action,
  ChatRow,
  Line,
  Person,
  Section,
  Summary,
  type HqpProjectContext
} from './MobileHqPlusProjectParts'
import { hqpProjectStyles as styles } from './mobile-hq-plus-project-styles'

function when(at: number, now: number): string {
  return new Date(at).toDateString() === new Date(now).toDateString()
    ? clock(at)
    : new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** A #rrggbb colour with this alpha; any other colour as it is. */
function edgeOf(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color
}

export function MobileHqPlusProjectCard({
  card,
  ctx,
  flashId = null,
  openId = null
}: {
  card: HqPlusProjectCard
  ctx: HqpProjectContext
  /** The line a pick from the menu went to: it opens and lights up. */
  flashId?: string | null
  openId?: string | null
}) {
  const [opened, setOpened] = useState<string | null>(openId)
  useEffect(() => {
    if (openId) {
      setOpened(openId)
    }
  }, [openId])
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
  const [compactOpen, setCompactOpen] = useState(false)
  const now = ctx.now
  const color = card.unsorted ? hqp.faint : (ctx.feed.colorOf(card.slug) ?? '#cfe9f2')
  const title = card.unsorted ? 'Unsorted' : hqPlusPhoneBreakName(card.slug)
  // Why: the edge is the project's own colour, as its dot (owner, 01.11); the owner's move brightens it.
  const edge = { borderColor: edgeOf(color, card.you.length > 0 ? 'c0' : '61') }
  const shown = card.shown
  const openLine = opened
  if (card.compact && !compactOpen) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${card.slug}: we wait for ${card.waits}`}
        onPress={() => setCompactOpen(true)}
        style={({ pressed }) => [styles.card, edge, styles.compact, pressed && styles.rowOpen]}
        testID={`hq-plus-project-${card.slug}`}
      >
        <View style={[styles.pdot, { backgroundColor: color }]} />
        <Text style={styles.compactTitle}>{title}</Text>
        <Text style={styles.pill}>We wait · {card.waits}</Text>
        <Text style={[styles.summaryText, styles.compactSum]} numberOfLines={2}>
          {hqPlusProjectWaitSummary(card, now)}
        </Text>
      </Pressable>
    )
  }
  const asking = card.chats.find((chat) => chat.state === 'asks') ?? card.chats[0] ?? null
  const askingItem = asking ? ctx.chatOf(asking.key) : null
  const workspace = card.unsorted ? null : ctx.workspace(card.slug)
  const room = card.unsorted ? null : ctx.roomName(card.slug)
  const openWaits = waitOpen || compactOpen
  const lines = (list: readonly HqPlusProjectLine[]) =>
    list.map((line) => (
      <Line
        key={line.id}
        line={line}
        open={openLine === line.id}
        flash={flashId === line.id}
        unsorted={card.unsorted}
        onToggle={() => setOpened(openLine === line.id ? null : line.id)}
        ctx={ctx}
      />
    ))
  const first = card.today[0]
  return (
    <View
      style={[styles.card, edge, card.you.length > 0 && styles.cardMove]}
      testID={`hq-plus-project-${card.slug}`}
    >
      <View style={styles.head}>
        <View style={[styles.pdot, { backgroundColor: color }]} />
        <Text style={styles.title}>{title}</Text>
        {room ? <Text style={styles.room}>{room.toUpperCase()}</Text> : null}
        {card.lastAt > 0 ? <Text style={styles.tm}>{when(card.lastAt, now)}</Text> : null}
      </View>
      {card.you.length > 0 || card.waits > 0 ? (
        <View style={styles.pills}>
          {card.you.length > 0 ? (
            <Text style={[styles.pill, styles.pillYou]}>Your move · {card.you.length}</Text>
          ) : null}
          {card.waits > 0 ? <Text style={styles.pill}>We wait · {card.waits}</Text> : null}
        </View>
      ) : null}
      {askingItem || workspace ? (
        <View style={styles.actions}>
          {askingItem ? (
            <Action
              label="Chat"
              main={asking?.state === 'asks'}
              onPress={() => ctx.feed.openChat(askingItem)}
            />
          ) : null}
          {workspace ? <Action label="Workspace ⇥" onPress={workspace} /> : null}
        </View>
      ) : null}
      {shown.you && card.you.length > 0 ? (
        <>
          <Section label={`Your move · ${card.you.length}`} open={null} amber />
          {lines(card.you)}
        </>
      ) : null}
      {shown.fyi && card.fyi.length > 0 ? (
        <>
          <Section label={`FYI · ${card.fyi.length}`} open={null} />
          {lines(card.fyi)}
        </>
      ) : null}
      {shown.wait && card.persons.length > 0 ? (
        <>
          <Section
            label={`We wait · ${card.waits}`}
            open={openWaits}
            onToggle={() => {
              setWaitOpen(!openWaits)
              setCompactOpen(false)
            }}
          />
          {openWaits ? (
            card.persons.map((person) => <Person key={person.name} person={person} ctx={ctx} />)
          ) : (
            <Summary text={hqPlusProjectWaitSummary(card, now)} onPress={() => setWaitOpen(true)} />
          )}
        </>
      ) : null}
      {shown.today && first ? (
        <>
          <Section
            label={`Today · ${card.today.length}`}
            open={todayOpen}
            onToggle={() => setTodayOpen(!todayOpen)}
          />
          {todayOpen ? (
            card.today.map((row) => {
              const chat = ctx.feed.chatOf(row.sessionId)
              return (
                <View key={row.id} style={styles.todayRow}>
                  <Text style={styles.tt}>{clock(row.at)}</Text>
                  <View style={styles.grow}>
                    <Text style={styles.todayText}>
                      <Text style={styles.who}>{HQ_PLUS_PROJECT_TODAY_LABEL[row.kind]}</Text>
                      {row.to ? <Text style={{ color: hqp.ice }}> → {row.to}</Text> : null}
                    </Text>
                    <Text style={styles.todayText} numberOfLines={3}>
                      {row.text}
                    </Text>
                    {chat ? (
                      <Text style={styles.holder} numberOfLines={1}>
                        {chat.title}
                      </Text>
                    ) : null}
                  </View>
                </View>
              )
            })
          ) : (
            <Summary
              text={`${HQ_PLUS_PROJECT_TODAY_LABEL[first.kind]}${first.to ? ` → ${first.to}` : ''}: ${first.text}${card.today.length > 1 ? ` · and ${card.today.length - 1} more` : ''}`}
              onPress={() => setTodayOpen(true)}
            />
          )}
        </>
      ) : null}
      {shown.chats && card.chats.length > 0 ? (
        <>
          <Section
            label={`Chats · ${card.chats.length}`}
            open={chatsOpen}
            onToggle={() => setChatsOpen(!chatsOpen)}
          />
          {chatsOpen ? (
            card.chats.map((chat) => (
              <ChatRow
                key={chat.key}
                chat={chat}
                open={chatKey === chat.key}
                onToggle={() => setChatKey(chatKey === chat.key ? null : chat.key)}
                ctx={ctx}
              />
            ))
          ) : (
            <Summary
              text={hqPlusProjectChatSummary(card.chats)}
              onPress={() => setChatsOpen(true)}
            />
          )}
        </>
      ) : null}
    </View>
  )
}
