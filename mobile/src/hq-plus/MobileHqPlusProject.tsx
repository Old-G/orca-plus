// Custom build (hq-plus-phone-map): a project picked on the phone's Map, on a screen from the right
// (‹ Map or a swipe from the edge goes back) — what the desktop Map's dock shows for it: the cards on
// the owner, decided in place; the people it waits for, each opening to what was asked and when; its
// chats with ×. «Open chat» takes the chat that asks, «Workspace ⇥» the project in the phone's Orca.
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusMapLeaf } from '../../../src/shared/hq-plus-map'
import {
  hqPlusPhoneBreakName,
  hqPlusPhoneChatState,
  hqPlusPhoneDays,
  hqPlusPhoneProjectCards,
  hqPlusPhoneProjectChats,
  type HqpMapRoom
} from './hq-plus-phone-map'
import { HQP_TOUCH, hqp, hqpStyles, hqpWeb } from './hq-plus-phone-theme'
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import { MobileHqPlusCard } from './MobileHqPlusCard'
import { HQP_SOURCE_NAME } from './MobileHqPlusMap'
import { HqpMapChatRow } from './MobileHqPlusMapChats'

type Person = Extract<HqPlusMapLeaf, { kind: 'person' }>

function asked(at: number, now: number): string {
  const days = hqPlusPhoneDays(at, now)
  return days === 0 ? 'asked today' : `asked ${days} d ago`
}

function PersonRow({ person, now }: { person: Person; now: number }) {
  const [open, setOpen] = useState(false)
  const first = person.waits[0]
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${person.name}: what we wait for`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.open, pressed && styles.pressed]}
      >
        <View style={[styles.dot, { backgroundColor: person.answered ? hqp.green : '#5d7d8a' }]} />
        <View style={styles.grow}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {person.name}
          </Text>
          <Text style={styles.rowSub} numberOfLines={1}>
            {first?.title ?? ''}
          </Text>
        </View>
        <Text style={[styles.state, person.answered > 0 && { color: hqp.green }]}>
          {person.answered > 0
            ? `${person.answered} replied`
            : `${person.waits.length} · ${hqPlusPhoneDays(person.oldestAt, now)} d`}
        </Text>
      </Pressable>
      {open ? (
        <View style={styles.waits}>
          {person.waits.map((wait) => (
            <View key={wait.id} style={[styles.wait, wait.answerId && styles.waitGot]}>
              <Text style={styles.waitText}>{wait.title}</Text>
              <Text style={[styles.waitWhen, wait.answerId && { color: hqp.green }]}>
                {wait.answerId ? 'replied · see the card above' : asked(wait.at, now)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function Action({
  label,
  main,
  ghost,
  onPress
}: {
  label: string
  main?: boolean
  ghost?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        hqpStyles.button,
        styles.action,
        main && hqpStyles.buttonMain,
        ghost && hqpStyles.buttonGhost,
        pressed && hqpStyles.pressed
      ]}
    >
      <Text
        style={[
          hqpStyles.buttonLabel,
          main && hqpStyles.buttonLabelMain,
          ghost && hqpStyles.buttonLabelGhost
        ]}
      >
        {label}
      </Text>
    </Pressable>
  )
}

export function MobileHqPlusProject({
  room,
  slug,
  now,
  ctx,
  onBack,
  onCloseChat,
  onNewChat,
  onWorkspace,
  onSort
}: {
  room: HqpMapRoom | null
  /** The project on screen; null keeps the screen off to the right. */
  slug: string | null
  now: number
  ctx: HqpFeedContext
  onBack: () => void
  onCloseChat: ((item: HqChatWireItem) => void) | null
  onNewChat: (slug: string) => void
  /** The project's workspace screen; null when the phone knows no workspace of it. */
  onWorkspace: (() => void) | null
  /** Unsorted: the feed, to give each conversation a project. */
  onSort: () => void
}) {
  const project = room?.model.projects.find((entry) => entry.slug === slug) ?? null
  const shown = slug !== null
  const cards = project && room ? hqPlusPhoneProjectCards(room.items, project.slug) : []
  const chats = project && room ? hqPlusPhoneProjectChats(room.chats, project.slug) : []
  const persons = project
    ? project.leaves.flatMap((leaf) => (leaf.kind === 'person' ? [leaf] : []))
    : []
  const asking = chats.find((item) => hqPlusPhoneChatState(item) === 'asks') ?? null
  const name = project?.unsorted ? 'Unsorted' : (slug ?? '')
  const sub = project
    ? [
        project.waits > 0 ? `${project.waits} wait${project.waits === 1 ? '' : 's'}` : null,
        chats.length > 0 ? `${chats.length} chat${chats.length === 1 ? '' : 's'}` : null,
        project.oldestWaitAt !== null
          ? `oldest wait ${hqPlusPhoneDays(project.oldestWaitAt, now)} d`
          : null
      ]
        .filter(Boolean)
        .join(' · ') || 'Nothing waits here.'
    : ''
  const sources = project
    ? Object.keys(project.sources).map(
        (source) => HQP_SOURCE_NAME[source as keyof typeof HQP_SOURCE_NAME]
      )
    : []
  return (
    <View
      aria-hidden={!shown}
      pointerEvents={shown ? 'auto' : 'none'}
      style={[
        styles.panel,
        hqpWeb.grid,
        hqpWeb.slide,
        { transform: [{ translateX: shown ? 0 : '102%' }] }
      ]}
      testID="hq-plus-project"
    >
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the Map"
          onPress={onBack}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ Map</Text>
        </Pressable>
        <View style={styles.title}>
          <Text style={styles.titleText} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.titleSub}>
            {(room?.name ?? '').toUpperCase()} · {project?.unsorted ? 'NO PROJECT' : 'PROJECT'}
          </Text>
        </View>
        <View style={styles.back} />
      </View>
      <ScrollView style={hqpWeb.noScrollbar} contentContainerStyle={styles.body}>
        {!project ? (
          <Text style={hqpStyles.hint}>Nothing goes on in this project now.</Text>
        ) : (
          <>
            <View style={styles.head}>
              <Text style={styles.h3}>
                {project.unsorted
                  ? 'Conversations with no project'
                  : hqPlusPhoneBreakName(project.slug)}
              </Text>
              {project.you > 0 ? <Text style={styles.pill}>Your move · {project.you}</Text> : null}
            </View>
            <Text style={styles.sub}>
              {sub}
              {sources.length > 0 ? ` · ${sources.join(', ')}` : ''}
            </Text>
            <View style={styles.actions}>
              {project.unsorted ? (
                <Action label="Sort in the Feed" onPress={onSort} />
              ) : (
                <>
                  {asking ? (
                    <Action label="Open chat" main onPress={() => ctx.openChat(asking)} />
                  ) : null}
                  <Action label="+ New chat" onPress={() => onNewChat(project.slug)} />
                  {onWorkspace ? <Action label="Workspace ⇥" ghost onPress={onWorkspace} /> : null}
                </>
              )}
            </View>
            {cards.length > 0 ? (
              <>
                <Text style={[hqpStyles.label, styles.section, { color: hqp.amber }]}>
                  Your move · {cards.length}
                </Text>
                {cards.map((card) => (
                  <MobileHqPlusCard key={card.id} card={card} flash={false} ctx={ctx} />
                ))}
              </>
            ) : null}
            {persons.length > 0 ? (
              <>
                <Text style={[hqpStyles.label, styles.section]}>
                  You wait for · {persons.length}
                </Text>
                <View style={styles.list}>
                  {persons.map((person) => (
                    <PersonRow key={person.key} person={person} now={now} />
                  ))}
                </View>
              </>
            ) : null}
            {chats.length > 0 ? (
              <>
                <Text style={[hqpStyles.label, styles.section]}>Chats · {chats.length}</Text>
                <View style={styles.list}>
                  {chats.map((item) => (
                    <HqpMapChatRow
                      key={item.key}
                      item={item}
                      onOpen={ctx.openChat}
                      onClose={onCloseChat}
                    />
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 7,
    boxShadow: '-20px 0 40px rgba(0,0,0,.5)'
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: hqp.line,
    backgroundColor: hqp.bg
  },
  back: { width: 96, height: HQP_TOUCH, justifyContent: 'center', paddingHorizontal: 8 },
  backText: { color: hqp.ice, fontSize: 15, fontWeight: '500' },
  title: { flex: 1, alignItems: 'center', minWidth: 0 },
  titleText: { color: hqp.fg, fontSize: 14.5, fontWeight: '600' },
  titleSub: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5, letterSpacing: 0.8 },
  body: { paddingHorizontal: 12, paddingTop: 14, paddingBottom: 48, gap: 12 },
  head: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  h3: { color: hqp.fg, fontSize: 21, fontWeight: '600', flexShrink: 1 },
  pill: {
    height: 24,
    lineHeight: 22,
    paddingHorizontal: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,195,90,.5)',
    backgroundColor: 'rgba(255,195,90,.08)',
    color: hqp.amber,
    fontFamily: hqp.mono,
    fontSize: 11,
    fontWeight: '500',
    overflow: 'hidden'
  },
  sub: { color: hqp.mute, fontSize: 13, marginTop: -6 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  action: { minHeight: 40, flexBasis: 'auto' },
  section: { paddingTop: 8, paddingHorizontal: 2 },
  list: { gap: 2 },
  open: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12
  },
  pressed: { backgroundColor: hqp.soft2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  grow: { flex: 1, minWidth: 0 },
  rowTitle: { color: hqp.fg, fontSize: 14 },
  rowSub: { color: hqp.faint, fontSize: 12 },
  state: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5 },
  waits: { gap: 6, paddingLeft: 30, paddingRight: 8, paddingBottom: 10 },
  wait: {
    gap: 3,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: hqp.soft,
    borderWidth: 1,
    borderColor: hqp.line
  },
  waitGot: { borderColor: 'rgba(95,224,160,.35)' },
  waitText: { color: hqp.fg, fontSize: 13, lineHeight: 18 },
  waitWhen: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5 }
})
