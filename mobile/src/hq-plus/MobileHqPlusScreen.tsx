// Custom build (hq-plus-phone): HQ+ on the phone, as the desktop's HQ+ laid out for one hand — the
// feed in the centre, everything else in a drawer on the left (☰ or a swipe from the edge), views on
// a panel from the right, links in a sheet from the bottom. The same reads and feed rules as the
// desktop; approvals of outgoing messages show their text and stay on the Mac.
// Custom build (hq-plus-phone-map): Feed | Map — the Map's tiles in the centre instead of the feed, a
// project's screen from the right, the room's open chats in a sheet from the bottom.
// Custom build (hq-project-cards): the feed is one card per project, the desktop's own cards.
import { useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View, type GestureResponderEvent } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import type { HqChatWireItem } from '../../../src/shared/hq-chat-wire'
import { hqPlusMatchesSearch } from '../../../src/shared/hq-plus-feed-filter'
import { hqPlusDayStart, type HqPlusCard } from '../../../src/shared/hq-plus-log'
import {
  hqPlusProjectCardOf,
  hqPlusProjectFeed,
  type HqPlusProjectFilter
} from '../../../src/shared/hq-plus-project-cards'
import { HQ_DEFERRED_KIND } from '../../../src/shared/hq-morning-briefing'
import { hqChatSessionHref } from '../hq/MobileHqChatList'
import { MobileVoicePromptSheet } from '../hq/MobileVoicePromptSheet'
import { hostStackHostRoute } from '../navigation/host-stack-navigation'
import { useRouteHandoff } from '../navigation/route-handoff'
import { firstParam } from '../navigation/route-param-reader'
import { useHostClient } from '../transport/connection/host-client-hooks'
import { runRpcOperation } from '../transport/rpc/rpc-operation'
import { hqPlusPhoneChatOf, hqPlusPhoneFeed, hqPlusPhoneRoomOf } from './hq-plus-phone-feed'
import { hqPlusSettingsRead } from './hq-plus-phone-operations'
import { hqp, hqpWeb } from './hq-plus-phone-theme'
import type { HqpFeedContext } from './mobile-hq-plus-feed-context'
import type { HqpView } from './mobile-hq-plus-views-model'
import { MobileHqPlusComposer } from './MobileHqPlusComposer'
import { MobileHqPlusDrawer, type HqpWeWait } from './MobileHqPlusDrawer'
import { MobileHqPlusProjectFeed } from './MobileHqPlusProjectFeed'
import type { HqpProjectContext } from './MobileHqPlusProjectParts'
import { hqPlusPhoneProjectInput } from './hq-plus-phone-projects'
import { MobileHqPlusHeader, type HqpLayout } from './MobileHqPlusHeader'
import { MobileHqPlusLinkSheet } from './MobileHqPlusLinkSheet'
import { MobileHqPlusMap } from './MobileHqPlusMap'
import { MobileHqPlusMapLayers } from './MobileHqPlusMapLayers'
import { MobileHqPlusPanel } from './MobileHqPlusPanel'
import { useHqPlusPhoneData } from './use-hq-plus-phone-data'
import { useHqPlusPhoneLinks } from './use-hq-plus-phone-links'
import { useHqPlusPhoneMap } from './use-hq-plus-phone-map'

const TICK_MS = 30_000
const EDGE = 24
const SWIPE = 60

// Why: the room and chip picked stay while the app runs, as the old HQ kept its workspace.
let remembered: { room: string | null; filter: HqPlusProjectFilter; layout: HqpLayout } = {
  room: null,
  filter: 'all',
  layout: 'feed'
}

export function MobileHqPlusScreen() {
  const params = useLocalSearchParams<{ hostId?: string | string[] }>()
  const hostId = firstParam(params.hostId)
  const router = useRouteHandoff()
  const insets = useSafeAreaInsets()
  const { client } = useHostClient(hostId)
  const [now, setNow] = useState(() => Date.now())
  const [room, setRoom] = useState(remembered.room)
  const [filter, setFilter] = useState(remembered.filter)
  const [layout, setLayout] = useState(remembered.layout)
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
  // Why: the project cards show whom we wait for, so the waits on people are read with the feed.
  const data = useHqPlusPhoneData(client)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => {
    remembered = { room, filter, layout }
  }, [room, filter, layout])
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
        // Why: the project cards take the chip; the rows come unfiltered.
        filter: 'all',
        query: '',
        personName: (id) => names.get(id) ?? null,
        now
      }),
    [data.feed, spaces, data.chats, activeRoom, names, now]
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
  // Custom build (hq-project-cards): the desktop's project cards from the phone's reads.
  const projectInput = useMemo(
    () =>
      hqPlusPhoneProjectInput({
        feed: data.feed,
        spaces,
        room: activeRoom,
        shown: feed.shown,
        waits: weWait,
        chats: roomChats,
        since: hqPlusDayStart(now)
      }),
    [data.feed, spaces, activeRoom, feed.shown, weWait, roomChats, now]
  )
  const projects = useMemo(
    () =>
      hqPlusProjectFeed({
        ...projectInput,
        filter,
        search: search?.trim()
          ? {
              query: search,
              matches: (item) => hqPlusMatchesSearch(item, search, (id) => names.get(id) ?? null)
            }
          : null
      }),
    [projectInput, filter, search, names]
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
  const map = useHqPlusPhoneMap({
    shown: layout === 'map',
    client,
    hostId,
    spaces,
    room: activeRoom,
    items: feed.all,
    waits: weWait,
    chats: roomChats,
    push: (href) => router.push(href),
    onNotice: setNotice,
    onChanged: data.reload
  })
  const toFeed = (next: HqPlusProjectFilter): void => {
    setFilter(next)
    setLayout('feed')
  }
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
  const projectCtx: HqpProjectContext = {
    feed: ctx,
    now,
    roomName: (slug) => {
      const slugRoom = hqPlusPhoneRoomOf(spaces, { project: slug })
      return spaces.find((space) => space.slug === slugRoom)?.name ?? null
    },
    personName: (id) => names.get(id) ?? null,
    chatOf: (key) => data.chats.find((chat) => chat.key === key) ?? null,
    closeChat: map.closeChat,
    workspace: map.workspaceOf
  }
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
    } else if (map.project && start.x < EDGE * 2 && dx > SWIPE + 20) {
      map.setProject(null)
    } else if (!view && !map.project && !drawer && start.x < EDGE && dx > SWIPE) {
      setDrawer(true)
    } else if (drawer && dx < -SWIPE) {
      setDrawer(false)
    }
  }

  return (
    <SafeAreaView style={[styles.root, hqpWeb.grid]} edges={['top']} testID="mobile-hq-plus-screen">
      <View style={styles.screen} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <MobileHqPlusHeader
          layout={layout}
          mapChats={map.chats.length}
          onLayout={setLayout}
          onMapChats={() => map.setSheet(true)}
          spaces={spaces}
          room={activeRoom}
          openByRoom={feed.openByRoom}
          moveCount={projects.counts.move}
          filter={filter}
          counts={projects.counts}
          search={search}
          onMenu={() => setDrawer(true)}
          onRoom={setRoom}
          onNewRoom={() => setNotice('Make a room on the Mac: HQ+ → «+» beside the rooms.')}
          onSearch={setSearch}
          onViews={() => setView('agents')}
          onFilter={toFeed}
        />
        {data.error && !data.feed ? (
          <Text style={styles.error}>{data.error}</Text>
        ) : layout === 'map' ? (
          <MobileHqPlusMap
            rooms={map.rooms}
            all={activeRoom === null}
            now={now}
            colorOf={(slug) => colorByProject.get(slug) ?? null}
            onProject={(slug, picked) => map.setProject({ room: slug, slug: picked })}
          />
        ) : (
          <MobileHqPlusProjectFeed
            feed={projects}
            filter={filter}
            ctx={projectCtx}
            flash={flash}
            onFilter={setFilter}
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
        <MobileHqPlusMapLayers
          map={map}
          ctx={ctx}
          projectCard={(slug) => hqPlusProjectCardOf(projectInput, slug)}
          projectCtx={projectCtx}
          bottom={insets.bottom}
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
