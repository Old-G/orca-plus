// Custom build (hq-plus-phone): the feed's rows that are not decisions — a chat's newest turn (its
// earlier turns folded in), the owner's own message, and a background line (sessions, notes, limits).
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusBadge } from '../../../src/shared/hq-plus-kinds'
import { hqPlusLook } from '../../../src/shared/hq-plus-kinds'
import type { HqPlusLogItem } from '../../../src/shared/hq-plus-log'
import { MobileMarkdown } from '../components/MobileMarkdown'
import { hqp, hqpStyles } from './hq-plus-phone-theme'
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import { HqpBadge, HqpCardFrame, HqpHead, clock, hqpCardStyles as s } from './mobile-hq-plus-parts'

type Line = Extract<HqPlusLogItem, { kind: 'line' }>
type Mine = Extract<HqPlusLogItem, { kind: 'me' }>

/** The chat's state, from the phone's chat list: what the desktop card's head says. */
function statusOf(chat: HqChatWireItem | null): HqPlusBadge | null {
  switch (chat?.group) {
    case 'needs':
      return { label: 'WAITS · YOU', tone: 'move' }
    case 'working':
      return { label: 'WORKING', tone: 'working' }
    case 'done':
      return { label: 'DONE', tone: 'done' }
    default:
      return null
  }
}

export function MobileHqPlusChatLine({
  item,
  flash,
  ctx
}: {
  item: Line
  flash: boolean
  ctx: HqpFeedContext
}) {
  const [open, setOpen] = useState(false)
  const chat = ctx.chatOf(item.sessionId)
  const status = statusOf(chat)
  const text = item.body ?? item.title
  const earlier = item.earlier?.length ?? 0
  return (
    <HqpCardFrame
      look="chat"
      flash={flash}
      project={item.project}
      color={ctx.colorOf(item.project)}
    >
      <HqpHead>
        <HqpBadge badge={{ label: 'CHAT', tone: 'chat' }} />
        <Text style={s.project}>{item.project ?? 'HQ'}</Text>
        <Text style={s.time}>{clock(item.at)}</Text>
        <View style={s.spacer} />
        {status ? <HqpBadge badge={status} /> : null}
      </HqpHead>
      {chat && chat.title !== text ? (
        <Text style={s.chatName} numberOfLines={1}>
          {chat.title}
        </Text>
      ) : null}
      {open ? (
        <MobileMarkdown content={text} />
      ) : (
        <Text style={s.text} numberOfLines={3}>
          {text.replace(/\*\*/g, '')}
        </Text>
      )}
      <View style={s.foot}>
        {text.length > 140 || earlier > 0 ? (
          <Pressable accessibilityRole="button" onPress={() => setOpen((value) => !value)}>
            <Text style={hqpStyles.link}>
              {open ? 'Show less' : earlier > 0 ? `Show all · ${earlier + 1} turns` : 'Show all'}
            </Text>
          </Pressable>
        ) : null}
        <View style={s.spacer} />
        {chat ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open chat"
            onPress={() => ctx.openChat(chat)}
            style={({ pressed }) => [hqpStyles.pill, styles.openPill, pressed && hqpStyles.pressed]}
          >
            <Text style={hqpStyles.pillLabel}>Open chat ›</Text>
          </Pressable>
        ) : null}
      </View>
      {open && earlier > 0
        ? item.earlier?.map((turn) => (
            <Text key={turn.id} style={hqpStyles.hint} numberOfLines={2}>
              {clock(turn.at)} · {turn.title}
            </Text>
          ))
        : null}
    </HqpCardFrame>
  )
}

export function MobileHqPlusMine({ item }: { item: Mine }) {
  return (
    <View style={styles.mineRow}>
      <Text style={styles.mine}>{item.text}</Text>
      <Text style={s.time}>
        {item.project ? `→ ${item.address ?? item.project} · ` : ''}
        {clock(item.at)}
      </Text>
    </View>
  )
}

export function MobileHqPlusBackground({ item }: { item: Line }) {
  const badge = hqPlusLook(item).badges[0]
  return (
    <View style={styles.bg}>
      <Text style={styles.bgText} numberOfLines={2}>
        {badge ? <Text style={styles.bgTag}>{badge.label} </Text> : null}
        {item.project ? `${item.project}: ` : ''}
        {item.title} · {clock(item.at)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  openPill: { minHeight: 32 },
  mineRow: { alignItems: 'flex-end', gap: 3, paddingLeft: 48 },
  mine: {
    backgroundColor: hqp.ice,
    color: hqp.ink,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderBottomRightRadius: 5,
    overflow: 'hidden'
  },
  bg: { paddingLeft: 36 },
  bgText: { color: hqp.faint, fontSize: 12.5, lineHeight: 18 },
  bgTag: { fontFamily: hqp.mono, fontSize: 9.5, letterSpacing: 1.1, color: hqp.faint }
})
