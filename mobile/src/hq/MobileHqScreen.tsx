// Custom build (hq-mobile): HQ on the phone. Custom build (hq-mobile-messenger): laid out as the
// desktop's messenger — the pinned pages (Today, Notes, Done for you, Feed, Reports, Inbox) above
// the chats in their sections; a page opens over the list with a back button, a chat opens the
// phone's session. Approvals of outgoing messages stay on the Mac.
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPinnedCounts, HqPinnedSeenId } from '../../../src/shared/hq-pinned-counts'
import { hostStackHostRoute } from '../navigation/host-stack-navigation'
import { useRouteHandoff } from '../navigation/route-handoff'
import { firstParam } from '../navigation/route-param-reader'
import { useHostClient } from '../transport/host-client-hooks'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { hqStyles } from './mobile-hq-parts'
import { MobileHqChatList, hqChatSessionHref } from './MobileHqChatList'
import { MobileHqFeedPage } from './MobileHqFeedPage'
import { MobileHqInboxTab } from './MobileHqInboxTab'
import { MobileHqNotesTab } from './MobileHqNotesTab'
import { MobileHqReportsPage } from './MobileHqReportsPage'
import { MobileHqRequestsTab } from './MobileHqRequestsTab'
import { hqMarkPinnedSeen, hqPinnedCountsRead } from './hq-messenger-operations'
import { useMobileHqPoll } from './use-mobile-hq-poll'
import { mobileHqPinnedNote, type MobileHqPageId } from './mobile-hq-pinned-note'

const PAGES = [
  { id: 'today', label: 'Today', icon: '☀︎' },
  { id: 'notes', label: 'Notes', icon: '✎' },
  { id: 'done', label: 'Done for you', icon: '✓' },
  { id: 'feed', label: 'Feed', icon: '≋' },
  { id: 'reports', label: 'Reports', icon: '▤' },
  { id: 'inbox', label: 'Inbox', icon: '◉' }
] as const

type PageId = MobileHqPageId

// Custom build (hq-pinned-counts): the pages whose «new» count starts over once opened.
const SEEN_ID: Partial<Record<PageId, HqPinnedSeenId>> = {
  done: 'journal',
  feed: 'feed',
  reports: 'reports'
}

async function readCounts(
  client: RpcClient
): Promise<{ value: HqPinnedCounts } | { error: string }> {
  return { value: await runRpcOperation(client, hqPinnedCountsRead) }
}

export function MobileHqScreen() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const router = useRouteHandoff()
  const { client } = useHostClient(hostId)
  const [page, setPage] = useState<PageId | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const counts = useMobileHqPoll(client, readCounts)
  const shownCounts = counts.state.status === 'ready' ? counts.state.value : null
  const markSeen = (id: PageId | null): void => {
    const seenId = id ? SEEN_ID[id] : undefined
    if (client && seenId) {
      void runRpcOperation(client, hqMarkPinnedSeen, { id: seenId })
        .then(counts.refresh)
        .catch(() => {})
    }
  }
  const open = (next: PageId): void => {
    setNotice(null)
    setReport(null)
    setPage(next)
    markSeen(next)
  }
  const back = (): void => {
    if (report) {
      setReport(null)
      return
    }
    if (page) {
      // Why: what arrived while the page was open is seen too.
      markSeen(page)
      setPage(null)
      return
    }
    if (router.canGoBack()) {
      router.back()
    } else {
      router.replace(hostStackHostRoute(hostId))
    }
  }
  const openChat = (item: HqChatWireItem): void => {
    const href = hostId ? hqChatSessionHref(hostId, item) : null
    if (href) {
      router.push(href)
    }
  }
  const title = page ? (PAGES.find((entry) => entry.id === page)?.label ?? 'HQ') : 'HQ'

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="mobile-hq-screen">
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={back}>
          <Text style={hqStyles.link}>‹ {page ? 'HQ' : 'Workspaces'}</Text>
        </Pressable>
        <Text style={styles.title}>{title}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {!client ? (
          <Text style={hqStyles.meta}>Loading…</Text>
        ) : page === null ? (
          <>
            <View style={styles.pinned} accessibilityRole="menu">
              {PAGES.map((entry) => {
                const note = mobileHqPinnedNote(shownCounts, entry.id)
                return (
                  <Pressable
                    key={entry.id}
                    accessibilityRole="menuitem"
                    accessibilityLabel={entry.label}
                    onPress={() => open(entry.id)}
                    style={({ pressed }) => [styles.pin, pressed && hqStyles.pressed]}
                  >
                    <Text style={styles.pinIcon}>{entry.icon}</Text>
                    <Text style={styles.pinLabel}>{entry.label}</Text>
                    {note ? (
                      <Text style={[styles.pinNote, note.needs && styles.pinNoteNeeds]}>
                        {note.text}
                      </Text>
                    ) : null}
                  </Pressable>
                )
              })}
            </View>
            <MobileHqChatList client={client} onOpen={openChat} />
          </>
        ) : page === 'today' ? (
          <MobileHqRequestsTab client={client} onNotice={setNotice} show="requests" />
        ) : page === 'done' ? (
          <MobileHqRequestsTab client={client} onNotice={setNotice} show="done" />
        ) : page === 'notes' ? (
          <MobileHqNotesTab client={client} />
        ) : page === 'feed' ? (
          <MobileHqFeedPage client={client} />
        ) : page === 'reports' ? (
          <MobileHqReportsPage client={client} path={report} onOpen={setReport} />
        ) : (
          <MobileHqInboxTab client={client} onNotice={setNotice} />
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bgBase },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  title: { fontSize: typography.titleSize, fontWeight: '600', color: colors.textPrimary },
  content: { padding: spacing.lg, gap: spacing.md },
  pinned: {
    gap: 1,
    borderRadius: radii.row,
    overflow: 'hidden',
    backgroundColor: colors.borderSubtle
  },
  pin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgPanel
  },
  pinIcon: { width: 20, textAlign: 'center', color: colors.textSecondary },
  pinLabel: {
    flex: 1,
    fontSize: typography.bodySize,
    color: colors.textPrimary,
    fontWeight: '500'
  },
  pinNote: { fontSize: typography.metaSize, color: colors.textMuted },
  pinNoteNeeds: { color: colors.accentBlue, fontWeight: '600' },
  notice: {
    fontSize: typography.metaSize,
    color: colors.textPrimary,
    backgroundColor: colors.bgRaised,
    borderRadius: radii.row,
    padding: spacing.sm
  }
})
