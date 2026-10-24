// Custom build (hq-plus-phone): the left drawer — everything the desktop keeps beside the feed:
// «Waiting on you» numbered (a tap closes the drawer and flashes the card), «We wait», the room's
// chats with the quiet ones folded under «Idle», and the views that open on the right.
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusCard } from '../../../src/shared/hq-plus-log'
import type { HqWaiting } from '../../../src/shared/hq-pulse-snapshot'
import { hqAgo } from '../hq/mobile-hq-parts'
import { HQP_TOUCH, hqp, hqpStyles, hqpWeb } from './hq-plus-phone-theme'
import { hqpQuestionOf } from './mobile-hq-plus-card-model'
import { HqpTile, clock } from './mobile-hq-plus-parts'
import { HQP_VIEWS, type HqpView } from './mobile-hq-plus-views-model'

export type HqpWeWait = HqWaiting & { who: string | null }

const LIVE: ReadonlySet<string> = new Set(['needs', 'working', 'done'])

function Item({
  lead,
  title,
  meta,
  status,
  statusTone,
  onPress
}: {
  lead: React.ReactNode
  title: string
  meta: string | null
  status: string
  statusTone?: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
      style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
    >
      <View style={styles.lead}>{lead}</View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.itemMeta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </View>
      <Text style={[styles.status, statusTone ? { color: statusTone } : null]}>{status}</Text>
    </Pressable>
  )
}

function Section({
  label,
  amber,
  children
}: {
  label: string
  amber?: boolean
  children: React.ReactNode
}) {
  return (
    <View style={styles.section}>
      <Text style={[hqpStyles.label, styles.sectionLabel, amber && styles.amber]}>{label}</Text>
      {children}
    </View>
  )
}

export function MobileHqPlusDrawer({
  open,
  roomName,
  waiting,
  weWait,
  chats,
  now,
  viewNotes,
  onClose,
  onPickCard,
  onOpenChat,
  onOpenWait,
  onOpenView,
  onWorkspaces
}: {
  open: boolean
  roomName: string
  waiting: readonly HqPlusCard[]
  weWait: readonly HqpWeWait[]
  chats: readonly HqChatWireItem[]
  now: number
  viewNotes: Partial<Record<HqpView, string>>
  onClose: () => void
  onPickCard: (id: string) => void
  onOpenChat: (chat: HqChatWireItem) => void
  onOpenWait: (wait: HqpWeWait) => void
  onOpenView: (view: HqpView) => void
  onWorkspaces: () => void
}) {
  const [idleOpen, setIdleOpen] = useState(false)
  const live = chats.filter((chat) => LIVE.has(chat.group))
  const idle = chats.filter((chat) => !LIVE.has(chat.group))
  const chatRow = (chat: HqChatWireItem) => (
    <Item
      key={chat.key}
      lead={<HqpTile name={chat.projectName} color={chat.color} />}
      title={chat.title}
      meta={`${chat.projectName} · ${chat.sortAt > 0 ? hqAgo(chat.sortAt, now) : ''}`}
      status={chat.group === 'needs' ? 'you' : chat.group}
      statusTone={
        chat.group === 'working' ? hqp.yellow : chat.group === 'needs' ? hqp.amber : undefined
      }
      onPress={() => onOpenChat(chat)}
    />
  )
  return (
    <>
      <Pressable
        accessibilityLabel="Close menu"
        onPress={onClose}
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.scrim, hqpWeb.slide, { opacity: open ? 1 : 0 }]}
      />
      <View
        accessibilityRole="menu"
        aria-hidden={!open}
        style={[styles.drawer, hqpWeb.slide, { transform: [{ translateX: open ? 0 : '-102%' }] }]}
        testID="hq-plus-drawer"
      >
        <View style={styles.head}>
          <Text style={hqpStyles.label}>HQ+</Text>
          <Text style={styles.room}>{roomName}</Text>
          <View style={styles.spacer} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close menu"
            onPress={onClose}
            style={styles.icon}
          >
            <Text style={styles.iconText}>‹</Text>
          </Pressable>
        </View>
        <ScrollView style={hqpWeb.noScrollbar} contentContainerStyle={styles.body}>
          <Section label={`Waiting on you · ${waiting.length}`} amber>
            {waiting.length === 0 ? <Text style={styles.none}>Nothing waits on you.</Text> : null}
            {waiting.map((card, index) => (
              <Item
                key={card.id}
                lead={<Text style={styles.num}>{index + 1}</Text>}
                title={card.type === 'move' ? hqpQuestionOf(card) : card.title}
                meta={`${card.project ?? 'HQ'} · ${card.type}`}
                status={clock(card.at)}
                onPress={() => onPickCard(card.id)}
              />
            ))}
          </Section>
          <Section label={`We wait · ${weWait.length}`}>
            {weWait.map((wait) => (
              <Item
                key={wait.id}
                lead={<HqpTile name={wait.who ?? wait.project} />}
                title={wait.who ? `${wait.who} · ${wait.title}` : wait.title}
                meta={`${wait.project ?? 'no project'} · ${hqAgo(wait.createdAt, now)}`}
                status="›"
                onPress={() => onOpenWait(wait)}
              />
            ))}
          </Section>
          <Section label={`Chats · ${chats.length}`}>
            {live.map(chatRow)}
            {idle.length > 0 ? (
              <Item
                lead={<Text style={styles.status}>{idleOpen ? '▾' : '▸'}</Text>}
                title={`Idle · ${idle.length}`}
                meta={null}
                status=""
                onPress={() => setIdleOpen((value) => !value)}
              />
            ) : null}
            {idleOpen ? idle.map(chatRow) : null}
          </Section>
          <Section label="Views">
            <View style={styles.views}>
              {HQP_VIEWS.map((view) => (
                <Pressable
                  key={view.id}
                  accessibilityRole="button"
                  accessibilityLabel={view.label}
                  onPress={() => onOpenView(view.id)}
                  style={({ pressed }) => [styles.view, pressed && hqpStyles.pressed]}
                >
                  <Text style={styles.viewLabel}>{view.label}</Text>
                  <Text style={styles.viewNote}>{viewNotes[view.id] ?? view.note}</Text>
                </Pressable>
              ))}
            </View>
          </Section>
        </ScrollView>
        <View style={styles.foot}>
          <Pressable
            accessibilityRole="button"
            onPress={onWorkspaces}
            style={({ pressed }) => [
              hqpStyles.button,
              hqpStyles.buttonGhost,
              pressed && hqpStyles.pressed
            ]}
          >
            <Text style={[hqpStyles.buttonLabel, hqpStyles.buttonLabelGhost]}>‹ Workspaces</Text>
          </Pressable>
        </View>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 5,
    backgroundColor: 'rgba(0,0,0,0.5)'
  },
  drawer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: '84%',
    zIndex: 6,
    backgroundColor: hqp.bg2,
    borderRightWidth: 1,
    borderRightColor: hqp.line2
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
    paddingHorizontal: 16,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: hqp.line
  },
  room: { color: hqp.fg, fontSize: 16, fontWeight: '600' },
  spacer: { flexGrow: 1 },
  icon: { width: HQP_TOUCH, height: HQP_TOUCH, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: hqp.fg, fontSize: 26, lineHeight: 28 },
  body: { paddingHorizontal: 10, paddingTop: 8, paddingBottom: 16, gap: 6 },
  section: { gap: 2 },
  sectionLabel: { paddingTop: 10, paddingHorizontal: 6, paddingBottom: 6, color: hqp.mute },
  amber: { color: hqp.amber },
  none: { color: hqp.faint, fontSize: 13, paddingHorizontal: 8, paddingVertical: 6 },
  item: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 12
  },
  itemPressed: { backgroundColor: hqp.soft2 },
  lead: { width: 28, alignItems: 'center' },
  itemBody: { flex: 1, minWidth: 0 },
  itemTitle: { color: hqp.fg, fontSize: 14 },
  itemMeta: { color: hqp.faint, fontSize: 12 },
  num: { color: hqp.amber, fontFamily: hqp.mono, fontSize: 12, fontWeight: '600' },
  status: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5 },
  views: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 4 },
  view: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: hqp.line,
    backgroundColor: hqp.soft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    padding: 6
  },
  viewLabel: { color: hqp.fg, fontSize: 12.5, fontWeight: '500' },
  viewNote: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10, letterSpacing: 1 },
  foot: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: hqp.line
  }
})
