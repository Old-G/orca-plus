// Custom build (hq-mobile): HQ on the phone — the requests to the owner and what was done for him,
// his notes, and the bell. Approvals of outgoing messages stay on the Mac.
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { hostStackHostRoute } from '../navigation/host-stack-navigation'
import { useRouteHandoff } from '../navigation/route-handoff'
import { firstParam } from '../navigation/route-param-reader'
import { useHostClient } from '../transport/host-client-hooks'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { hqStyles } from './mobile-hq-parts'
import { MobileHqInboxTab } from './MobileHqInboxTab'
import { MobileHqNotesTab } from './MobileHqNotesTab'
import { MobileHqRequestsTab } from './MobileHqRequestsTab'

const TABS = [
  { id: 'requests', label: 'Requests' },
  { id: 'notes', label: 'Notes' },
  { id: 'inbox', label: 'Inbox' }
] as const

type TabId = (typeof TABS)[number]['id']

export function MobileHqScreen() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const router = useRouteHandoff()
  const { client } = useHostClient(hostId)
  const [tab, setTab] = useState<TabId>('requests')
  const [notice, setNotice] = useState<string | null>(null)
  const select = (next: TabId): void => {
    setNotice(null)
    setTab(next)
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']} testID="mobile-hq-screen">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to workspaces"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace(hostStackHostRoute(hostId))
          }
        >
          <Text style={hqStyles.link}>‹ Workspaces</Text>
        </Pressable>
        <Text style={styles.title}>HQ</Text>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {TABS.map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="tab"
            accessibilityLabel={entry.label}
            accessibilityState={{ selected: tab === entry.id }}
            onPress={() => select(entry.id)}
            style={[styles.tab, tab === entry.id && styles.tabSelected]}
          >
            <Text style={[styles.tabLabel, tab === entry.id && styles.tabLabelSelected]}>
              {entry.label}
            </Text>
          </Pressable>
        ))}
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {!client ? (
          <Text style={hqStyles.meta}>Loading…</Text>
        ) : tab === 'requests' ? (
          <MobileHqRequestsTab client={client} onNotice={setNotice} />
        ) : tab === 'notes' ? (
          <MobileHqNotesTab client={client} />
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
  tabs: {
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md
  },
  tab: {
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.bgPanel
  },
  tabSelected: { backgroundColor: colors.bgRaised },
  tabLabel: { fontSize: typography.bodySize, color: colors.textSecondary },
  tabLabelSelected: { color: colors.textPrimary, fontWeight: '600' },
  content: { padding: spacing.lg, gap: spacing.md },
  notice: {
    fontSize: typography.metaSize,
    color: colors.textPrimary,
    backgroundColor: colors.bgRaised,
    borderRadius: radii.row,
    padding: spacing.sm
  }
})
