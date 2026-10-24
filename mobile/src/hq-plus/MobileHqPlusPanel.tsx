// Custom build (hq-plus-phone): the panel that slides in from the right over the feed, with the
// desktop's views as tabs. Chats open in the phone's own session screen instead, as the old HQ did.
import { useCallback, useMemo } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusCard } from '../../../src/shared/hq-plus-log'
import { hqPlusGraph, hqPlusLanes, type HqPlusWait } from '../../../src/shared/hq-plus-river-graph'
import type { HqPlusScreenStats } from '../../../src/shared/hq-plus-screen'
import type { HqWaiting } from '../../../src/shared/hq-pulse-snapshot'
import { MobileHqReportsPage } from '../hq/MobileHqReportsPage'
import type { MobileHqSpaceFilter } from '../hq/mobile-hq-spaces'
import { useMobileHqPoll } from '../hq/use-mobile-hq-poll'
import { runRpcOperation } from '../transport/rpc-operation'
import type { RpcClient } from '../transport/rpc-client'
import { hqPlusPagesRead, hqPlusStatsRead } from './hq-plus-phone-operations'
import { HQP_TOUCH, hqp, hqpStyles, hqpWeb } from './hq-plus-phone-theme'
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import { HQP_VIEWS, type HqpView } from './mobile-hq-plus-views-model'
import {
  HqpAgentsView,
  HqpBrowserView,
  HqpDeferredView,
  HqpGraphView,
  HqpRiverView
} from './MobileHqPlusViewBodies'

type Pages = { slug: string; relations: string[] }[]

async function readStats(
  client: RpcClient
): Promise<{ value: HqPlusScreenStats } | { error: string }> {
  try {
    return { value: await runRpcOperation(client, hqPlusStatsRead, {}) }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

async function readPages(client: RpcClient): Promise<{ value: Pages } | { error: string }> {
  try {
    const reply = await runRpcOperation(client, hqPlusPagesRead)
    return reply.ok ? { value: reply.pages } : { error: reply.error }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function MobileHqPlusPanel({
  view,
  client,
  room,
  roomName,
  spaces,
  roomOfProject,
  chats,
  waits,
  names,
  deferred,
  browserUrl,
  report,
  now,
  ctx,
  onView,
  onReport,
  onClose,
  onBrowser
}: {
  /** The tab shown; null keeps the panel off screen. */
  view: HqpView | null
  client: RpcClient | null
  room: string | null
  roomName: string
  spaces: MobileHqSpaceFilter
  roomOfProject: (project: string | null) => string | null
  chats: readonly HqChatWireItem[]
  waits: readonly HqWaiting[]
  names: ReadonlyMap<string, string>
  deferred: readonly HqPlusCard[]
  browserUrl: string | null
  /** The report read in full in Reports; null for the list. */
  report: string | null
  now: number
  ctx: HqpFeedContext
  onView: (view: HqpView) => void
  onReport: (path: string | null) => void
  onClose: () => void
  onBrowser: (how: 'orca' | 'safari' | 'copy') => void
}) {
  const needsStats = view === 'river' || view === 'graph'
  const statsClient = needsStats ? client : null
  const stats = useMobileHqPoll(statsClient, readStats)
  const pages = useMobileHqPoll(view === 'graph' ? client : null, readPages)
  const inRoom = useCallback(
    (project: string | null) => !room || roomOfProject(project) === room,
    [room, roomOfProject]
  )
  const shaped = useMemo<HqPlusWait[]>(
    () =>
      waits
        .filter((wait) => inRoom(wait.project))
        .map((wait) => ({
          personId: wait.personId,
          personName: wait.personId ? (names.get(wait.personId) ?? null) : null,
          project: wait.project,
          title: wait.title,
          createdAt: wait.createdAt,
          direction: wait.direction
        })),
    [waits, inRoom, names]
  )
  const activity = useMemo(
    () =>
      stats.state.status === 'ready'
        ? stats.state.value.activity.filter((row) => !room || row.workspace === room)
        : [],
    [stats.state, room]
  )
  const lanes = useMemo(() => hqPlusLanes(activity, shaped, now), [activity, shaped, now])
  const graph = useMemo(
    () =>
      hqPlusGraph({
        waits: shaped,
        pages: (pages.state.status === 'ready' ? pages.state.value : [])
          .filter((page) => inRoom(page.slug))
          .map((page) => ({ ...page, room: roomOfProject(page.slug) ?? '' })),
        active: new Set(
          lanes.filter((lane) => lane.lastAt >= now - 24 * 60 * 60_000).map((lane) => lane.project)
        ),
        now
      }),
    [shaped, pages.state, inRoom, roomOfProject, lanes, now]
  )
  const label = HQP_VIEWS.find((entry) => entry.id === view)?.label ?? 'HQ+'
  return (
    <View
      aria-hidden={view === null}
      pointerEvents={view === null ? 'none' : 'auto'}
      style={[
        styles.panel,
        hqpWeb.grid,
        hqpWeb.slide,
        { transform: [{ translateX: view ? 0 : '102%' }] }
      ]}
      testID="hq-plus-panel"
    >
      <View style={styles.top}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to HQ+"
          onPress={onClose}
          style={styles.back}
        >
          <Text style={styles.backText}>‹ HQ+</Text>
        </Pressable>
        <View style={styles.title}>
          <Text style={styles.titleText}>{label}</Text>
          <Text style={styles.sub}>HQ+ · {roomName}</Text>
        </View>
        <View style={styles.back} />
      </View>
      <ScrollView
        horizontal
        style={[styles.tabs, hqpWeb.noScrollbar]}
        contentContainerStyle={styles.tabsRow}
      >
        {HQP_VIEWS.map((entry) => (
          <Pressable
            key={entry.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: entry.id === view }}
            onPress={() => onView(entry.id)}
            style={[styles.tab, entry.id === view && styles.tabOn]}
          >
            <Text style={[styles.tabLabel, entry.id === view && styles.tabLabelOn]}>
              {entry.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      <ScrollView style={hqpWeb.noScrollbar} contentContainerStyle={styles.body}>
        {view === 'agents' ? (
          <HqpAgentsView chats={chats} now={now} onOpen={ctx.openChat} />
        ) : view === 'river' ? (
          stats.state.status === 'error' ? (
            <Text style={hqpStyles.error}>{stats.state.message}</Text>
          ) : (
            <HqpRiverView lanes={lanes} />
          )
        ) : view === 'graph' ? (
          <HqpGraphView graph={graph} />
        ) : view === 'reports' && client ? (
          <MobileHqReportsPage client={client} path={report} onOpen={onReport} spaces={spaces} />
        ) : view === 'browser' ? (
          <HqpBrowserView
            url={browserUrl}
            onOrca={() => onBrowser('orca')}
            onSafari={() => onBrowser('safari')}
            onCopy={() => onBrowser('copy')}
          />
        ) : view === 'deferred' ? (
          <HqpDeferredView cards={deferred} ctx={ctx} />
        ) : null}
        {view === 'reports' && report ? (
          <Pressable accessibilityRole="button" onPress={() => onReport(null)}>
            <Text style={hqpStyles.link}>‹ All reports</Text>
          </Pressable>
        ) : null}
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
    borderBottomColor: hqp.line
  },
  back: { minWidth: 72, height: HQP_TOUCH, justifyContent: 'center', paddingHorizontal: 8 },
  backText: { color: hqp.ice, fontSize: 15, fontWeight: '500' },
  title: { flex: 1, alignItems: 'center', minWidth: 0 },
  titleText: { color: hqp.fg, fontSize: 14.5, fontWeight: '600' },
  sub: { color: hqp.faint, fontFamily: hqp.mono, fontSize: 10.5 },
  tabs: { flexGrow: 0, borderBottomWidth: 1, borderBottomColor: hqp.line },
  tabsRow: { gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  tab: {
    height: 32,
    paddingHorizontal: 13,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: hqp.line,
    justifyContent: 'center'
  },
  tabOn: { backgroundColor: hqp.ice, borderColor: hqp.ice },
  tabLabel: { color: hqp.mute, fontSize: 13, fontWeight: '500' },
  tabLabelOn: { color: hqp.ink },
  body: { padding: 14, gap: 12, paddingBottom: 40 }
})
