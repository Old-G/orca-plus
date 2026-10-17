// Custom build (hq-mobile-messenger): HQ's chats on the phone in the desktop's sections — needs you,
// working, done, the active projects, then the quiet ones folded — each opening the phone's session.
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import {
  groupHqChatWire,
  readHqChatWireList,
  type HqChatWireGroup,
  type HqChatWireItem,
  type HqChatWireList
} from '../../../src/shared/hq-chat-wire'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqChatListRead } from './hq-messenger-operations'
import { hqAgo, hqStyles } from './mobile-hq-parts'
import { useMobileHqPoll } from './use-mobile-hq-poll'

const SECTIONS: { group: HqChatWireGroup; label: string }[] = [
  { group: 'needs', label: 'Needs you' },
  { group: 'working', label: 'Working' },
  { group: 'done', label: 'Done' },
  { group: 'active', label: 'Active projects' }
]
const QUIET_SHOWN = 20

async function readChats(
  client: RpcClient
): Promise<{ value: HqChatWireList } | { error: string }> {
  const list = readHqChatWireList(await runRpcOperation(client, hqChatListRead))
  return list ? { value: list } : { error: 'The Mac sent a chat list this phone cannot read.' }
}

/** Two-letter project mark, as the desktop draws it. */
export function hqChatInitials(name: string): string {
  const words = name.split(/[\s._-]+/).filter(Boolean)
  const letters = words.length >= 2 ? `${words[0][0]}${words[1][0]}` : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

/** The phone's session route for a chat; null when the desktop has no pane to open yet. */
export function hqChatSessionHref(hostId: string, item: HqChatWireItem): string | null {
  if (!item.paneKey) {
    return null
  }
  const host = item.executionHostId?.startsWith('runtime:')
    ? `&executionHost=${encodeURIComponent(item.executionHostId)}`
    : ''
  return `/h/${encodeURIComponent(hostId)}/session/${encodeURIComponent(item.worktreeId)}?name=${encodeURIComponent(item.projectName)}${host}&paneKey=${encodeURIComponent(item.paneKey)}`
}

function ChatRow({
  item,
  now,
  onOpen
}: {
  item: HqChatWireItem
  now: number
  onOpen: (item: HqChatWireItem) => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.projectName}: ${item.title}`}
      disabled={!item.paneKey}
      onPress={() => onOpen(item)}
      style={({ pressed }) => [styles.row, pressed && hqStyles.pressed]}
      testID="mobile-hq-chat-row"
    >
      <View style={[styles.avatar, item.color ? { backgroundColor: item.color } : null]}>
        <Text style={styles.avatarText}>{hqChatInitials(item.projectName)}</Text>
      </View>
      <View style={styles.body}>
        <View style={hqStyles.line}>
          <Text style={[styles.title, item.unseen && styles.unseen]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={hqStyles.meta}>{item.sortAt > 0 ? hqAgo(item.sortAt, now) : ''}</Text>
        </View>
        <Text style={hqStyles.meta} numberOfLines={1}>
          {item.projectName} · {item.preview}
        </Text>
      </View>
    </Pressable>
  )
}

export function MobileHqChatList({
  client,
  onOpen
}: {
  client: RpcClient
  onOpen: (item: HqChatWireItem) => void
}) {
  const { state } = useMobileHqPoll(client, readChats)
  const [quietOpen, setQuietOpen] = useState(false)
  if (state.status === 'loading') {
    return <Text style={hqStyles.meta}>Loading chats…</Text>
  }
  if (state.status === 'error') {
    return <Text style={hqStyles.error}>{state.message}</Text>
  }
  if (state.value.publishedAt === 0) {
    return (
      <Text style={hqStyles.meta}>
        Open Orca+ on the Mac once — the chats come from its window.
      </Text>
    )
  }
  const groups = groupHqChatWire(state.value.items)
  const now = state.loadedAt
  return (
    <View style={styles.list}>
      {SECTIONS.filter(({ group }) => groups[group].length > 0).map(({ group, label }) => (
        <View key={group} style={styles.section}>
          <Text style={hqStyles.section}>
            {label} · {groups[group].length}
          </Text>
          {groups[group].map((item) => (
            <ChatRow key={item.key} item={item} now={now} onOpen={onOpen} />
          ))}
        </View>
      ))}
      {groups.quiet.length > 0 ? (
        <View style={styles.section}>
          <Pressable accessibilityRole="button" onPress={() => setQuietOpen((open) => !open)}>
            <Text style={hqStyles.section}>
              {quietOpen ? '▾' : '▸'} Quiet · {groups.quiet.length}
            </Text>
          </Pressable>
          {quietOpen
            ? groups.quiet
                .slice(0, QUIET_SHOWN)
                .map((item) => <ChatRow key={item.key} item={item} now={now} onOpen={onOpen} />)
            : null}
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  section: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radii.button,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.textMuted
  },
  avatarText: { fontSize: typography.metaSize, fontWeight: '700', color: colors.bgBase },
  body: { flex: 1, gap: 2 },
  title: { flex: 1, fontSize: typography.bodySize, color: colors.textPrimary },
  unseen: { fontWeight: '700' }
})
