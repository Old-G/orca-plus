// Custom build (hq-project-cards): the rows of the phone's project card — a section's head with Show /
// Hide, a line that opens to its card, a person we wait for, a chat opening to its chat card with ×.
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusMapChatState } from '../../../src/shared/hq-plus-map'
import {
  hqPlusProjectAge,
  type HqPlusProjectPerson
} from '../../../src/shared/hq-plus-project-cards'
import {
  hqPlusProjectChatLine,
  type HqPlusProjectChat,
  type HqPlusProjectLine
} from '../../../src/shared/hq-plus-project-lines'
import { hqp, hqpStyles } from './hq-plus-phone-theme'
import { HQP_CHAT_STATE_LABEL } from './hq-plus-phone-map'
import { HQP_CHAT_STATE_COLOR } from './MobileHqPlusMapChats'
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import { HqpBadge } from './mobile-hq-plus-parts'
import {
  listHqPlusPhoneProjects,
  setHqPlusPhoneConversationProject
} from './hq-plus-phone-actions'
import { MobileHqPlusCard } from './MobileHqPlusCard'
import { MobileHqPlusChatLine } from './MobileHqPlusLine'
import { hqpProjectStyles as styles } from './mobile-hq-plus-project-styles'

export type HqpProjectContext = {
  feed: HqpFeedContext
  now: number
  roomName: (slug: string) => string | null
  personName: (personId: string) => string | null
  /** The phone's chat row of a chat key, to open it and close it. */
  chatOf: (key: string) => HqChatWireItem | null
  closeChat: ((item: HqChatWireItem) => void) | null
  /** The project's workspace on the phone; null when the phone knows none. */
  workspace: (slug: string) => (() => void) | null
}

export function Section({
  label,
  open,
  onToggle,
  amber
}: {
  label: string
  open: boolean | null
  onToggle?: () => void
  amber?: boolean
}) {
  return (
    <View style={styles.sec}>
      <Text style={[hqpStyles.label, styles.secLabel, amber && { color: hqp.amber }]}>{label}</Text>
      {open !== null && onToggle ? (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${open ? 'Hide' : 'Show'} ${label}`}
          onPress={onToggle}
          style={styles.fold}
        >
          <Text style={styles.foldText}>{open ? 'Hide' : 'Show'}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

export function Summary({ text, onPress }: { text: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.summary}>
      <Text style={styles.summaryText} numberOfLines={2}>
        {text}
      </Text>
    </Pressable>
  )
}

export function Line({
  line,
  open,
  flash,
  unsorted = false,
  onToggle,
  ctx
}: {
  line: HqPlusProjectLine
  open: boolean
  flash: boolean
  /** Custom build (hq-project-cards): an Unsorted line offers its projects, as the desktop's chip. */
  unsorted?: boolean
  onToggle: () => void
  ctx: HqpProjectContext
}) {
  const who = line.who ?? (line.personId ? ctx.personName(line.personId) : null)
  const age = hqPlusProjectAge(line.since, ctx.now)
  const chat = line.badge.tone !== 'chat' ? ctx.feed.chatOf(line.sessionId) : null
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${who ? `${who}: ` : ''}${line.what}`}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.row,
          (open || pressed) && styles.rowOpen,
          flash && styles.flash
        ]}
      >
        <HqpBadge badge={line.badge} />
        <View style={styles.grow}>
          <Text style={styles.rowTitle} numberOfLines={2}>
            {who ? <Text style={styles.who}>{who} · </Text> : null}
            {line.what}
          </Text>
          {chat ? (
            <Text style={styles.holder} numberOfLines={1}>
              {chat.title}
            </Text>
          ) : null}
        </View>
        <Text style={[styles.age, line.replied && { color: hqp.green }]}>
          {line.replied ? `replied · ${age}` : age}
        </Text>
      </Pressable>
      {unsorted && line.card.conversation ? <ProjectPick line={line} ctx={ctx} /> : null}
      {open ? (
        <View style={styles.open}>
          <MobileHqPlusCard card={line.card} flash={false} ctx={ctx.feed} bare />
        </View>
      ) : null}
    </View>
  )
}

/** «No project ▾» under an Unsorted line; a tap lists HQ's projects, a pick moves the conversation. */
function ProjectPick({ line, ctx }: { line: HqPlusProjectLine; ctx: HqpProjectContext }) {
  const [slugs, setSlugs] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const client = ctx.feed.client
  if (!client) {
    return null
  }
  const pick = (project: string): void => {
    void setHqPlusPhoneConversationProject(client, line.card, project).then((result) => {
      if (result.ok) {
        setSlugs(null)
        ctx.feed.onChanged()
      } else {
        setError(result.message)
      }
    })
  }
  return (
    <View style={styles.pickWrap}>
      {slugs ? (
        slugs.map((slug) => (
          <Pressable
            key={slug}
            accessibilityRole="button"
            accessibilityLabel={`Move to ${slug}`}
            onPress={() => pick(slug)}
            style={({ pressed }) => [styles.pickPill, pressed && hqpStyles.pressed]}
          >
            <Text style={styles.pickText}>{slug}</Text>
          </Pressable>
        ))
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Pick a project for this conversation"
          onPress={() => void listHqPlusPhoneProjects(client).then(setSlugs)}
          style={({ pressed }) => [styles.pickPill, pressed && hqpStyles.pressed]}
        >
          <Text style={styles.pickText}>{line.card.project ?? 'No project'} ▾</Text>
        </Pressable>
      )}
      {error ? <Text style={styles.pickError}>{error}</Text> : null}
    </View>
  )
}

export function Person({ person, ctx }: { person: HqPlusProjectPerson; ctx: HqpProjectContext }) {
  const [open, setOpen] = useState(false)
  const count = person.waits.length
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${person.name}: what we wait for`}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.row, (open || pressed) && styles.rowOpen]}
      >
        <HqpBadge badge={{ label: 'WAIT', tone: 'bg' }} />
        <View style={styles.grow}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            <Text style={styles.who}>{person.name}</Text>
            {count === 1 ? ` · ${person.waits[0]?.title ?? ''}` : ` · ${count} questions`}
          </Text>
        </View>
        <Text style={styles.age}>{hqPlusProjectAge(person.oldestAt, ctx.now)}</Text>
      </Pressable>
      {open ? (
        <View style={styles.waits}>
          {person.waits.map((wait) => (
            <View key={wait.id} style={styles.wait}>
              <Text style={styles.waitText}>{wait.title}</Text>
              <Text style={styles.waitWhen}>asked {hqPlusProjectAge(wait.at, ctx.now)} ago</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
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
  ctx: HqpProjectContext
}) {
  const [asking, setAsking] = useState(false)
  const item = ctx.chatOf(chat.key)
  const line = hqPlusProjectChatLine(chat)
  const close = ctx.closeChat
  const state: HqPlusMapChatState = chat.state
  return (
    <View>
      <View style={styles.chatLine}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`Chat ${chat.title}`}
          // Why: a chat with no card (a terminal) opens at once.
          onPress={line ? onToggle : () => (item ? ctx.feed.openChat(item) : undefined)}
          style={({ pressed }) => [styles.row, styles.grow, (open || pressed) && styles.rowOpen]}
        >
          <View style={[styles.dot, { backgroundColor: HQP_CHAT_STATE_COLOR[state] }]} />
          <Text style={[styles.rowTitle, styles.grow]} numberOfLines={1}>
            {chat.title}
          </Text>
          <Text style={[styles.age, { color: HQP_CHAT_STATE_COLOR[state] }]}>
            {HQP_CHAT_STATE_LABEL[state]}
          </Text>
        </Pressable>
        {item && close ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close chat ${chat.title}`}
            onPress={() => (item.group === 'working' ? setAsking(true) : close(item))}
            style={({ pressed }) => [styles.x, pressed && styles.rowOpen]}
          >
            <Text style={styles.xText}>×</Text>
          </Pressable>
        ) : null}
      </View>
      {asking && item && close ? (
        <View style={styles.ask}>
          <Text style={styles.askText}>Chat is working — close?</Text>
          <Pressable accessibilityRole="button" onPress={() => close(item)} style={styles.askBtn}>
            <Text style={styles.askClose}>Close</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAsking(false)}
            style={styles.askBtn}
          >
            <Text style={styles.foldText}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
      {open && line ? (
        <View style={styles.open}>
          <MobileHqPlusChatLine item={line} flash={false} ctx={ctx.feed} bare />
        </View>
      ) : null}
    </View>
  )
}

export function Action({
  label,
  main,
  onPress
}: {
  label: string
  main?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        main && styles.actionMain,
        pressed && hqpStyles.pressed
      ]}
    >
      <Text style={[styles.actionText, main && { color: hqp.ink, fontWeight: '600' }]}>
        {label}
      </Text>
    </Pressable>
  )
}
