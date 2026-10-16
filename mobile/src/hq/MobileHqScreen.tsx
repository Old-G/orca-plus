// Custom build (hq-mobile): HQ on the phone — the requests to the owner from Slack and ClickUp with
// their answers, then what was done for him this week. Approvals of outgoing messages stay on the Mac.
import { useLocalSearchParams } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { HqSlackScoutDone } from '../../../src/shared/hq-slack-scout'
import { hostStackHostRoute } from '../navigation/host-stack-navigation'
import { useRouteHandoff } from '../navigation/route-handoff'
import { firstParam } from '../navigation/route-param-reader'
import { useHostClient } from '../transport/host-client-hooks'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'
import { hqRequestRestore } from './hq-operations'
import { MobileHqRequestCard } from './MobileHqRequestCard'
import { errorText, useMobileHqRequests } from './use-mobile-hq-requests'

const DONE_LABEL: Record<HqSlackScoutDone['decision'], string> = {
  created: 'Task created',
  taken: 'Task taken',
  answered: 'Replied',
  rejected: 'Skipped'
}

function ago(at: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  return minutes < 60
    ? `${minutes}m`
    : minutes < 24 * 60
      ? `${Math.round(minutes / 60)}h`
      : `${Math.round(minutes / (24 * 60))}d`
}

function DoneRow({
  client,
  entry,
  now,
  onRestored
}: {
  client: RpcClient
  entry: HqSlackScoutDone
  now: number
  onRestored: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const restore = (): void => {
    void runRpcOperation(client, hqRequestRestore, { id: entry.id })
      .then((reply) => (reply.ok ? onRestored() : setError(reply.error)))
      .catch((failure: unknown) => setError(errorText(failure)))
  }
  return (
    <View style={styles.doneRow}>
      <View style={styles.doneLine}>
        <Text style={styles.doneLabel}>{DONE_LABEL[entry.decision]}</Text>
        <Text style={styles.doneTitle} numberOfLines={2}>
          {entry.title || entry.id}
        </Text>
        <Text style={styles.meta}>{ago(entry.at, now)}</Text>
      </View>
      {entry.author ? <Text style={styles.meta}>{entry.author}</Text> : null}
      {entry.decision === 'rejected' ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Bring back" onPress={restore}>
          <Text style={styles.link}>Bring back</Text>
        </Pressable>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  )
}

export function MobileHqScreen() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const router = useRouteHandoff()
  const { client } = useHostClient(hostId)
  const { state, refresh } = useMobileHqRequests(client)
  const [notice, setNotice] = useState<string | null>(null)

  return (
    <View style={styles.root} testID="mobile-hq-screen">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to workspaces"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace(hostStackHostRoute(hostId))
          }
        >
          <Text style={styles.link}>‹ Workspaces</Text>
        </Pressable>
        <Text style={styles.title}>HQ</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {state.status === 'loading' || !client ? (
          <Text style={styles.meta}>Loading…</Text>
        ) : state.status === 'error' ? (
          <Text style={styles.error}>{state.message}</Text>
        ) : (
          <>
            <Text style={styles.section}>Needs you · {state.requests.drafts.length}</Text>
            {state.requests.drafts.length === 0 ? (
              <Text style={styles.meta}>Nothing needs you right now.</Text>
            ) : (
              state.requests.drafts.map((request) => (
                <MobileHqRequestCard
                  key={request.id}
                  client={client}
                  request={request}
                  onDone={(next) => {
                    setNotice(next)
                    refresh()
                  }}
                />
              ))
            )}
            <Text style={styles.section}>Done for you</Text>
            {state.requests.done.length === 0 ? (
              <Text style={styles.meta}>Nothing done for you yet this week.</Text>
            ) : (
              <View style={styles.doneList}>
                {state.requests.done.map((entry) => (
                  <DoneRow
                    key={entry.id}
                    client={client}
                    entry={entry}
                    now={state.loadedAt}
                    onRestored={() => {
                      setNotice('The request is back.')
                      refresh()
                    }}
                  />
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
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
  section: {
    fontSize: typography.metaSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    marginTop: spacing.sm
  },
  notice: {
    fontSize: typography.metaSize,
    color: colors.textPrimary,
    backgroundColor: colors.bgRaised,
    borderRadius: radii.row,
    padding: spacing.sm
  },
  doneList: { backgroundColor: colors.bgPanel, borderRadius: radii.card, padding: spacing.md },
  doneRow: {
    gap: 2,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle
  },
  doneLine: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  doneLabel: { fontSize: typography.metaSize, color: colors.textSecondary },
  doneTitle: { flex: 1, fontSize: typography.bodySize, color: colors.textPrimary },
  meta: { fontSize: typography.metaSize, color: colors.textMuted },
  link: { fontSize: typography.bodySize, color: colors.accentBlue },
  error: { fontSize: typography.metaSize, color: colors.statusRed }
})
