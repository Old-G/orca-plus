// Custom build (hq-mobile-messenger): HQ's Feed on the phone — «Done» as short posts (commits, agent
// sessions, messages sent), «Incoming» as what came in, newest first, with the kind in its color.
import { useCallback, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { HqFeedItem } from '../../../src/shared/hq-feed'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqFeedRead } from './hq-messenger-operations'
import { hqAgo, hqStyles } from './mobile-hq-parts'
import { useMobileHqPoll } from './use-mobile-hq-poll'

type Scope = 'done' | 'incoming'

const KIND: Record<string, { label: string; color: string }> = {
  commit: { label: 'Commit', color: colors.accentBlue },
  session: { label: 'Agent session', color: colors.statusPurple },
  sent: { label: 'Sent for you', color: colors.statusGreen },
  request: { label: 'Asks you', color: colors.statusAmber },
  review: { label: 'Review', color: colors.accentBlue },
  conversation: { label: 'Conversation', color: colors.textSecondary },
  fyi: { label: 'FYI', color: colors.textSecondary },
  'my-comment': { label: 'You wrote', color: colors.textSecondary }
}

function Post({ item, now }: { item: HqFeedItem; now: number }) {
  const [open, setOpen] = useState(false)
  const kind = KIND[item.kind] ?? { label: item.kind, color: colors.textSecondary }
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => setOpen((value) => !value)}
      style={styles.card}
      testID="mobile-hq-feed-post"
    >
      <View style={hqStyles.line}>
        <Text style={styles.project} numberOfLines={1}>
          {item.project ?? 'Orca+'}
        </Text>
        <Text style={[styles.kind, { color: kind.color, borderColor: kind.color }]}>
          {kind.label}
        </Text>
        <Text style={hqStyles.meta}>{hqAgo(item.at, now)}</Text>
      </View>
      <Text style={styles.text}>{item.post ?? item.title}</Text>
      {open ? (
        <Text style={hqStyles.meta} selectable>
          {item.title}
          {item.body ? `\n${item.body}` : ''}
        </Text>
      ) : null}
    </Pressable>
  )
}

export function MobileHqFeedPage({ client }: { client: RpcClient }) {
  const [scope, setScope] = useState<Scope>('done')
  const read = useCallback(
    async (rpc: RpcClient) => ({
      value: (await runRpcOperation(rpc, hqFeedRead, { scope, limit: 100 })).items
    }),
    [scope]
  )
  const { state } = useMobileHqPoll(client, read)
  return (
    <View style={styles.page}>
      <View style={styles.toggle} accessibilityRole="tablist">
        {(['done', 'incoming'] as const).map((value) => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: scope === value }}
            onPress={() => setScope(value)}
            style={[styles.toggleItem, scope === value && styles.toggleItemSelected]}
          >
            <Text style={[styles.toggleLabel, scope === value && styles.toggleLabelSelected]}>
              {value === 'done' ? 'Done' : 'Incoming'}
            </Text>
          </Pressable>
        ))}
      </View>
      {state.status === 'loading' ? (
        <Text style={hqStyles.meta}>Loading…</Text>
      ) : state.status === 'error' ? (
        <Text style={hqStyles.error}>{state.message}</Text>
      ) : state.value.length === 0 ? (
        <Text style={hqStyles.meta}>Nothing in the feed yet.</Text>
      ) : (
        state.value.map((item) => <Post key={item.id} item={item} now={state.loadedAt} />)
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: spacing.sm },
  toggle: { flexDirection: 'row', gap: spacing.xs },
  toggleItem: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel
  },
  toggleItemSelected: { backgroundColor: colors.bgRaised },
  toggleLabel: { fontSize: typography.bodySize, color: colors.textSecondary },
  toggleLabelSelected: { color: colors.textPrimary, fontWeight: '600' },
  card: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.row,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.bgPanel
  },
  project: {
    flexShrink: 1,
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textPrimary
  },
  kind: {
    fontSize: typography.metaSize,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: spacing.sm
  },
  text: { fontSize: typography.bodySize, color: colors.textPrimary, lineHeight: 20 }
})
