// Custom build (hq-plus-phone): HQ+ on the phone, as the desktop's HQ+ laid out for one hand — the
// feed in the centre, everything else in a drawer on the left (☰ or a swipe from the edge), views on
// a panel from the right, links in a sheet from the bottom. The same reads and feed rules as the
// desktop; approvals of outgoing messages show their text and stay on the Mac.
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import type { HqPlusFeedFilter } from '../../../src/shared/hq-plus-feed-filter'
import type { HqPlusCard } from '../../../src/shared/hq-plus-log'
import { HQ_DEFERRED_KIND } from '../../../src/shared/hq-morning-briefing'
import { hqChatSessionHref } from '../hq/MobileHqChatList'
import { MobileVoicePromptSheet } from '../hq/MobileVoicePromptSheet'
import { hostStackHostRoute } from '../navigation/host-stack-navigation'
import { useRouteHandoff } from '../navigation/route-handoff'
import { firstParam } from '../navigation/route-param-reader'
import { useHostClient } from '../transport/host-client-hooks'
import { runRpcOperation } from '../transport/rpc-operation'
import { hqPlusPhoneChatOf, hqPlusPhoneFeed, hqPlusPhoneRoomOf } from './hq-plus-phone-feed'
import { hqPlusSettingsRead } from './hq-plus-phone-operations'
import { hqp, hqpWeb } from './hq-plus-phone-theme'
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import type { HqpView } from './mobile-hq-plus-views-model'
import { MobileHqPlusComposer } from './MobileHqPlusComposer'
import { MobileHqPlusDrawer, type HqpWeWait } from './MobileHqPlusDrawer'
import { MobileHqPlusFeed } from './MobileHqPlusFeed'
import { MobileHqPlusHeader } from './MobileHqPlusHeader'
import { MobileHqPlusLinkSheet } from './MobileHqPlusLinkSheet'
import { MobileHqPlusPanel } from './MobileHqPlusPanel'
import { useHqPlusPhoneData } from './use-hq-plus-phone-data'
import { useHqPlusPhoneLinks } from './use-hq-plus-phone-links'

const TICK_MS = 30_000
const EDGE = 24
const SWIPE = 60

// Why: the room and chip picked stay while the app runs, as the old HQ kept its workspace.
let remembered: { room: string | null; filter: HqPlusFeedFilter } = { room: null, filter: 'all' }

export function MobileHqPlusScreen() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const router = useRouteHandoff()
  const insets = useSafeAreaInsets()
  const { client } = useHostClient(hostId)
  const [now, setNow] = useState(() => Date.now())
  const [room, setRoom] = useState(remembered.room)
  const [filter, setFilter] = useState(remembered.filter)
  const [search, setSearch] = useState<string | null>(null)
  const [drawer, setDrawer] = useState(false)
  const [view, setView] = useState<HqpView | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [browserUrl, setBrowserUrl] = useState<string | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [hqPath, setHqPath] = useState<string | null>(null)
  const touch = useRef<{ x: number; y: number } | null>(null)
  const data = useHqPlusPhoneData(client, drawer || view !== null)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    remembered = { room, filter }
  }, [room, filter])
  useEffect(() => {
    if (!client) {
      return
    }
    void runRpcOperation(client, hqPlusSettingsRead)
      .then((reply) => setHqPath(reply.settings.hqPath ?? null))
      .catch(() => {})
  }, [client])
  useEffect(() => {
    if (!notice) {
      return
    }
    const timer = setTimeout(() => setNotice(null), 2400)
    return () => clearTimeout(timer)
  }, [notice])
  useEffect(() => {
    if (!flash) {
      return
    }
    const timer = setTimeout(() => setFlash(null), 1600)
    return () => clearTimeout(timer)
  }, [flash])

  const spaces = data.spaces
  // Why: a room the Mac removed falls back to All instead of an empty feed.
  const activeRoom = room && spaces.some((space) => space.slug === room) ? room : null
  const roomName = spaces.find((space) => space.slug === activeRoom)?.name ?? 'All'
  const names = useMemo(
    () => new Map((data.pulse?.people ?? []).map((person) => [person.id, person.name])),
    [data.pulse]
  )
  const feed = useMemo(
    () =>
      hqPlusPhoneFeed({
        feed: data.feed,
        spaces,
        chats: data.chats,
        room: activeRoom,
        filter,
        query: search ?? '',
        personName: (id) => names.get(id) ?? null,
        now
      }),
    [data.feed, spaces, data.chats, activeRoom, filter, search, names, now]
  )
  const roomOfProject = useCallback(
    (project: string | null) => (project ? hqPlusPhoneRoomOf(spaces, { project }) : null),
    [spaces]
  )
  const roomChats = useMemo(
    () =>
      data.chats.filter(
        (chat) =>
          !activeRoom ||
          hqPlusPhoneRoomOf(spaces, { repoId: chat.repoId, project: chat.projectName }) ===
            activeRoom
      ),
    [data.chats, spaces, activeRoom]
  )
  const weWait = useMemo<HqpWeWait[]>(
    () =>
      (data.pulse?.waitings ?? [])
        .filter(
          (wait) =>
            wait.direction === 'on-them' &&
            (!activeRoom || roomOfProject(wait.project) === activeRoom)
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((wait) => ({
          ...wait,
          who: wait.personId ? (names.get(wait.personId) ?? null) : null
        })),
    [data.pulse, activeRoom, roomOfProject, names]
  )
  const deferred = useMemo(
    () =>
      feed.all.filter(
        (item): item is HqPlusCard =>
          item.kind === 'card' &&
          item.open &&
          item.inbox?.kind === HQ_DEFERRED_KIND &&
          (!activeRoom || item.room === activeRoom)
      ),
    [feed.all, activeRoom]
  )
  const colorByProject = useMemo(() => {
    const colors = new Map<string, string>()
    for (const chat of data.chats) {
      if (chat.color) {
        colors.set(chat.projectName, chat.color)
      }
    }
    return colors
  }, [data.chats])

  const openChat = useCallback(
    (chat: HqChatWireItem) => {
      const href = hostId ? hqChatSessionHref(hostId, chat) : null
      if (href) {
        setDrawer(false)
        router.push(href)
      } else {
        setNotice('This chat has no pane on the Mac yet; open it there first.')
      }
    },
    [hostId, router]
  )
  const pickLink = useHqPlusPhoneLinks({ client, hostId, hqPath, onNotice: setNotice })
  const ctx = useMemo<HqpFeedContext>(
    () => ({
      client,
      hqPath,
      chatOf: (sessionId) => hqPlusPhoneChatOf(data.chats, sessionId),
      colorOf: (project) => (project ? (colorByProject.get(project) ?? null) : null),
      openChat,
      openLink: setLink,
      openReport: (path) => {
        setReport(path)
        setView('reports')
      },
      onChanged: data.reload
    }),
    [client, hqPath, data.chats, data.reload, colorByProject, openChat]
  )
  const pickCard = (id: string): void => {
    setDrawer(false)
    setFilter('all')
    setSearch(null)
    setFlash((previous) => ({ id, n: (previous?.n ?? 0) + 1 }))
  }
  const back = (): void => {
    if (router.canGoBack()) {
      router.back()
    } else if (hostId) {
      router.replace(hostStackHostRoute(hostId))
    }
  }
  const onTouchStart = (event: GestureResponderEvent): void => {
    const { pageX, pageY } = event.nativeEvent
    touch.current = { x: pageX, y: pageY }
  }
  const onTouchEnd = (event: GestureResponderEvent): void => {
    const start = touch.current
    touch.current = null
    if (!start) {
      return
    }
    const dx = event.nativeEvent.pageX - start.x
    if (Math.abs(event.nativeEvent.pageY - start.y) > SWIPE) {
      return
    }
    if (view && start.x < EDGE * 2 && dx > SWIPE + 20) {
      setView(null)
    } else if (!view && !drawer && start.x < EDGE && dx > SWIPE) {
      setDrawer(true)
    } else if (drawer && dx < -SWIPE) {
      setDrawer(false)
    }
  }

  return (
    <SafeAreaView style={[styles.root, hqpWeb.grid]} edges={['top']} testID="mobile-hq-plus-screen">
      <View style={styles.screen} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <MobileHqPlusHeader
          spaces={spaces}
          room={activeRoom}
          openByRoom={feed.openByRoom}
          moveCount={feed.waiting.length}
          filter={filter}
          inboxCount={feed.inboxOpen}
          search={search}
          onMenu={() => setDrawer(true)}
          onRoom={setRoom}
          onNewRoom={() => setNotice('Make a room on the Mac: HQ+ → «+» beside the rooms.')}
          onSearch={setSearch}
          onViews={() => setView('agents')}
          onFilter={setFilter}
        />
        {data.error && !data.feed ? (
          <Text style={styles.error}>{data.error}</Text>
        ) : (
          <MobileHqPlusFeed
            items={feed.items}
            now={now}
            ctx={ctx}
            flash={flash}
            empty={
              data.loading
                ? 'Loading HQ+…'
                : search
                  ? 'Nothing matches.'
                  : 'Nothing here yet today.'
            }
          />
        )}
        <MobileHqPlusComposer
          client={client}
          roomName={roomName}
          bottom={insets.bottom}
          onNotice={setNotice}
        />
        <MobileHqPlusDrawer
          open={drawer}
          roomName={roomName}
          waiting={feed.waiting}
          weWait={weWait}
          chats={roomChats}
          now={now}
          viewNotes={{ deferred: deferred.length > 0 ? String(deferred.length) : undefined }}
          onClose={() => setDrawer(false)}
          onPickCard={pickCard}
          onOpenChat={openChat}
          onOpenWait={(wait) => {
            const chat = hqPlusPhoneChatOf(data.chats, wait.agentSessionId ?? null)
            if (chat) {
              openChat(chat)
            } else if (wait.sourceRef?.startsWith('https://')) {
              setDrawer(false)
              setLink(wait.sourceRef)
            } else {
              setNotice(`${wait.who ?? 'Waiting'}: ${wait.title}`)
            }
          }}
          onOpenView={(next) => {
            setDrawer(false)
            setView(next)
          }}
          onWorkspaces={back}
        />
        <MobileHqPlusPanel
          view={view}
          client={client}
          room={activeRoom}
          roomName={roomName}
          spaces={{ spaces, active: activeRoom }}
          roomOfProject={roomOfProject}
          chats={roomChats}
          waits={data.pulse?.waitings ?? []}
          names={names}
          deferred={deferred}
          browserUrl={browserUrl}
          report={report}
          now={now}
          ctx={ctx}
          onView={(next) => {
            setReport(null)
            setView(next)
          }}
          onReport={setReport}
          onClose={() => setView(null)}
          onBrowser={(how) => (browserUrl ? pickLink(browserUrl, how) : undefined)}
        />
        <MobileHqPlusLinkSheet
          url={link}
          bottom={insets.bottom}
          onClose={() => setLink(null)}
          onPick={(choice) => {
            const url = link
            setLink(null)
            if (url) {
              setBrowserUrl(url)
              pickLink(url, choice)
            }
          }}
        />
        {notice ? (
          <View pointerEvents="none" style={[styles.toast, { bottom: insets.bottom + 80 }]}>
            <Text style={styles.toastText}>{notice}</Text>
          </View>
        ) : null}
      </View>
      <MobileVoicePromptSheet client={client} showToast={setNotice} />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: hqp.bg },
  screen: { flex: 1, overflow: 'hidden' },
  error: { color: hqp.rose, fontSize: 14, padding: 24, textAlign: 'center', flex: 1 },
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
    zIndex: 12
  },
  toastText: {
    backgroundColor: '#102230',
    borderWidth: 1,
    borderColor: hqp.line2,
    color: hqp.fg,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 12,
    fontSize: 13,
    overflow: 'hidden'
  }
})
