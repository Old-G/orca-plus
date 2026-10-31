// Custom build (hq-plus-phone-map): a chat in the Map's lists — its state, a tap to open it, and ×
// that closes its tab on the Mac (History keeps it); a working chat asks once, in a line, as the
// desktop's HqPlusCloseChat. «Chats · N» lists the room's open chats by project in a bottom sheet.
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusMapChatState } from '../../../src/shared/hq-plus-map'
import { HQP_CHAT_STATE_LABEL, hqPlusPhoneChatState } from './hq-plus-phone-map'
import { HQP_TOUCH, hqp, hqpStyles, hqpWeb } from './hq-plus-phone-theme'

export const HQP_CHAT_STATE_COLOR: Record<HqPlusMapChatState, string> = {
  asks: hqp.amber,
  working: hqp.yellow,
  done: hqp.green,
  quiet: '#5d7d8a'
}

export function HqpMapChatRow({
  item,
  onOpen,
  onClose
}: {
  item: HqChatWireItem
  onOpen: (item: HqChatWireItem) => void
  /** Closes the chat's tab; null when the phone cannot name the tab. */
  onClose: ((item: HqChatWireItem) => void) | null
}) {
  const [asking, setAsking] = useState(false)
  const state = hqPlusPhoneChatState(item) ?? 'quiet'
  const name = item.title || item.projectName
  return (
    <View style={styles.row}>
      <View style={styles.line}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open chat ${name}`}
          onPress={() => onOpen(item)}
          style={({ pressed }) => [styles.open, pressed && styles.pressed]}
        >
          <View style={[styles.dot, { backgroundColor: HQP_CHAT_STATE_COLOR[state] }]} />
          <Text style={styles.title} numberOfLines={1}>
            {name}
          </Text>
          <Text
            style={[
              styles.state,
              state === 'asks' && { color: hqp.amber },
              state === 'working' && { color: hqp.yellow },
              state === 'done' && { color: hqp.green }
            ]}
          >
            {HQP_CHAT_STATE_LABEL[state]}
          </Text>
        </Pressable>
        {onClose ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Close chat ${name}`}
            onPress={() => (item.group === 'working' ? setAsking(true) : onClose(item))}
            style={({ pressed }) => [styles.x, pressed && styles.pressed]}
          >
            <Text style={styles.xText}>×</Text>
          </Pressable>
        ) : null}
      </View>
      {asking && onClose ? (
        <View style={styles.ask}>
          <Text style={styles.askText}>Chat is working — close?</Text>
          <Pressable accessibilityRole="button" onPress={() => onClose(item)} style={styles.askBtn}>
            <Text style={styles.askClose}>Close</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => setAsking(false)}
            style={styles.askBtn}
          >
            <Text style={styles.askCancel}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

export function MobileHqPlusMapChats({
  open,
  chats,
  bottom,
  onOpen,
  onCloseChat,
  onClose
}: {
  open: boolean
  chats: readonly HqChatWireItem[]
  /** The home indicator's inset. */
  bottom: number
  onOpen: (item: HqChatWireItem) => void
  onCloseChat: ((item: HqChatWireItem) => void) | null
  onClose: () => void
}) {
  const byProject = new Map<string, HqChatWireItem[]>()
  for (const item of chats) {
    byProject.set(item.projectName, [...(byProject.get(item.projectName) ?? []), item])
  }
  return (
    <>
      <Pressable
        accessibilityLabel="Close open chats"
        onPress={onClose}
        pointerEvents={open ? 'auto' : 'none'}
        style={[styles.scrim, hqpWeb.slide, { opacity: open ? 1 : 0 }]}
      />
      <View
        aria-hidden={!open}
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          styles.sheet,
          hqpWeb.slide,
          { paddingBottom: bottom + 16, transform: [{ translateY: open ? 0 : '105%' }] }
        ]}
        testID="hq-plus-map-chats"
      >
        <View style={styles.grab} />
        <View style={styles.head}>
          <Text style={styles.headText}>Open chats</Text>
          <Text style={styles.headCount}>{chats.length}</Text>
        </View>
        <Text style={[hqpStyles.hint, styles.hint]}>
          × closes the tab on the Mac; History keeps it.
        </Text>
        <ScrollView style={hqpWeb.noScrollbar} contentContainerStyle={styles.body}>
          {chats.length === 0 ? (
            <Text style={hqpStyles.hint}>No chat is open in this room.</Text>
          ) : null}
          {[...byProject.entries()].map(([project, items]) => (
            <View key={project} style={styles.group}>
              <Text style={[hqpStyles.label, styles.groupLabel]}>
                {project} · {items.length}
              </Text>
              {items.map((item) => (
                <HqpMapChatRow key={item.key} item={item} onOpen={onOpen} onClose={onCloseChat} />
              ))}
            </View>
          ))}
        </ScrollView>
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  row: { borderRadius: 12 },
  line: { flexDirection: 'row', alignItems: 'center' },
  open: {
    flex: 1,
    minWidth: 0,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    borderRadius: 12
  },
  pressed: { backgroundColor: hqp.soft2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { flex: 1, minWidth: 0, color: hqp.fg, fontSize: 14 },
  state: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5 },
  x: {
    width: HQP_TOUCH,
    height: HQP_TOUCH,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'
  },
  xText: { color: hqp.faint, fontSize: 20, lineHeight: 22 },
  ask: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 30,
    paddingRight: 8,
    paddingBottom: 8
  },
  askText: { color: hqp.yellow, fontSize: 13 },
  askBtn: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 4 },
  askClose: { color: hqp.ice, fontSize: 13, fontWeight: '500' },
  askCancel: { color: hqp.mute, fontSize: 13, fontWeight: '500' },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 8,
    backgroundColor: 'rgba(0,0,0,0.5)'
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '74%',
    zIndex: 9,
    backgroundColor: hqp.sheet,
    borderTopWidth: 1,
    borderTopColor: hqp.line2,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 8,
    paddingHorizontal: 12,
    gap: 6
  },
  grab: {
    width: 38,
    height: 5,
    borderRadius: 3,
    backgroundColor: hqp.line2,
    alignSelf: 'center',
    marginBottom: 4
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 4 },
  headText: { color: hqp.fg, fontSize: 16, fontWeight: '600' },
  headCount: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 12 },
  hint: { paddingHorizontal: 4, paddingBottom: 4 },
  body: { gap: 4, paddingBottom: 8 },
  group: { gap: 2 },
  groupLabel: { paddingHorizontal: 2, paddingTop: 8 }
})
