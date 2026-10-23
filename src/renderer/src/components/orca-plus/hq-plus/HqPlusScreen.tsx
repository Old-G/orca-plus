// Custom build (hq-plus-ui): HQ+ — the day's conversation with HQ in the middle (decisions as cards that
// stay in place), what waits on the owner and the live chats on the left, Граф / Река / Сессия / a report
// on the right, rooms above and Orca's composer below. Every button goes through the paths agents use.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isWebClientLocation } from '@/lib/web-client-location'
import {
  HQ_PLUS_ANY_ROOM,
  hqPlusDayStart,
  hqPlusLog,
  hqPlusNotNowKey,
  type HqPlusCard
} from '../../../../../shared/hq-plus-log'
import { hqPlusFoldChats, hqPlusWithLiveChats } from '../../../../../shared/hq-plus-fold'
import {
  hqPlusIsFyi,
  hqPlusNeedsOwner,
  type HqPlusBadge
} from '../../../../../shared/hq-plus-kinds'
import {
  hqPlusGraph,
  hqPlusLanes,
  type HqPlusLane,
  type HqPlusWait
} from '../../../../../shared/hq-plus-river-graph'
import type { HqLiveSession } from '../../../../../shared/hq-sessions'
import { HQ_SESSION_UNREVIEWED_CAP } from '../../../../../shared/hq-sessions'
import { useNow } from '@/hooks/use-now'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useHqSpaces } from '../hq/use-hq-spaces'
import { useHqProjectPages } from '../hq/use-hq-project-pages'
import { findHqWorktreeId } from '../hq/hq-today-actions'
import { HqCommandBox } from '../hq/HqCommandBox'
import { acknowledgeHqChat, setShownHqChat, switchHqToCode } from '../hq/hq-chat-actions'
import { rememberedHqChat } from '../hq/hq-chat-open'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useHqChatList, useHqProjectColor } from '../hq/use-hq-chat-list'
import { onHqTabRequested, openHqScreen, takeRequestedHqTab } from '../hq/hq-view'
import { PulseBellButton } from '../pulse-bell/PulseBellButton'
import { openHqRouteChat } from '../pulse-bell/hq-route-send'
import { HqPlusLog, hqPlusThreadKey, hqPlusTileOf, type HqPlusLogContext } from './HqPlusLog'
import { HqPlusSide, type HqPlusTile } from './HqPlusSide'
import type { HqPlusOtherWait } from './HqPlusSideQueues'
import type { HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusChatBar, HqPlusChatSession } from './HqPlusChatSession'
import { markHqPlusDone } from './hq-plus-actions'
import { HQ_PLUS_PANEL, readHqPlusPanelWidth, saveHqPlusPanelWidth } from './hq-plus-panel-widths'
import { HqPlusRiver } from './HqPlusRiver'
import { HqPlusGraph } from './HqPlusGraph'
import { HqPlusSession, type HqPlusPick } from './HqPlusSession'
import { HqPlusReportView } from './HqPlusReportView'
import { setHqFlavor } from './hq-plus-flavor'
import { useHqPlusData } from './use-hq-plus-data'
import { putOffHqPlusCard, readHqPlusNotNow } from './hq-plus-not-now'
import { HqPlusThreadComposer } from './HqPlusThreadComposer'
import {
  closeHqPlusChat,
  hqPlusChatIsIdle,
  hqPlusChatOfSession,
  hqPlusLiveChats,
  hqPlusSideChats
} from './hq-plus-chats'
import './hq-plus.css'

const TICK_MS = 30_000
const FLASH_MS = 1800
const TABS = ['graph', 'river', 'session', 'report'] as const
type Tab = (typeof TABS)[number]

const TAB_LABEL: Record<Tab, [string, string]> = {
  graph: ['auto.hqPlus.tab.graph', 'Graph'],
  river: ['auto.hqPlus.tab.river', 'River'],
  session: ['auto.hqPlus.tab.session', 'Session'],
  report: ['auto.hqPlus.tab.report', 'Report']
}

function roomStyle(
  color: string | null
): (React.CSSProperties & Record<'--hqp-room', string>) | undefined {
  return color ? { '--hqp-room': color } : undefined
}

function ringStyle(share: number): React.CSSProperties & Record<'--hqp-p', string> {
  return { '--hqp-p': `${Math.round(Math.min(1, share) * 100)}%` }
}

export function HqPlusScreen(): React.JSX.Element {
  const data = useHqPlusData()
  const spaces = useHqSpaces()
  const pages = useHqProjectPages()
  const now = useNow(TICK_MS)
  const hqPath = useAppStore((state) => state.settings?.hqPath ?? null)
  const hqWorktreeId = useAppStore((state) =>
    findHqWorktreeId(state.settings?.hqPath, state.repos, state.worktreesByRepo)
  )
  const sidebarOpen = useAppStore((state) => state.sidebarOpen)
  const setSidebarOpen = useAppStore((state) => state.setSidebarOpen)
  const [scope, setScope] = useState<string | null>(null)
  const [pick, setPick] = useState<HqPlusPick | null>(null)
  // Custom build (hq-plus-ui-v2): a chat started from HQ opens straight in «Session».
  const [requestedChat] = useState<string | null>(() =>
    takeRequestedHqTab() === 'chats' ? rememberedHqChat() : null
  )
  const [tab, setTab] = useState<Tab>(requestedChat ? 'session' : 'graph')
  const [wide, setWide] = useState(false)
  // Custom build (hq-plus-ui-v3): the open chat folded to a bar under Graph / River, until «Expand».
  const [chatFolded, setChatFolded] = useState(false)
  // Custom build (hq-plus-ui-v3): where a project picked in the River or Graph came from, for «← Back».
  const [pickedFrom, setPickedFrom] = useState<'river' | 'graph' | null>(null)
  const [leftWidth, setLeftWidth] = useState(() => readHqPlusPanelWidth('left'))
  const [rightWidth, setRightWidth] = useState(() => readHqPlusPanelWidth('right'))
  const [reportPath, setReportPath] = useState<string | null>(null)
  // Custom build (hq-plus-ui): the chat open on the right — picked on the left, «Open» in the log, or a
  // chat started from HQ (the sidebar's new chat asks HQ to show it, as the classic HQ does).
  const [chatKey, setChatKey] = useState<string | null>(requestedChat)
  const { items: chatItems } = useHqChatList()
  const colorFor = useHqProjectColor()
  const [flashId, setFlashId] = useState<string | null>(null)

  const room = spaces.active?.slug ?? null
  const spaceBySlug = useMemo(
    () => new Map(spaces.spaces.map((space) => [space.slug, space])),
    [spaces.spaces]
  )
  const spaceSlugs = useMemo(
    () => new Set(spaces.spaces.map((space) => space.slug)),
    [spaces.spaces]
  )
  const roomOfProject = useMemo(() => {
    const map = new Map<string, string>()
    // Why: a room's projects.yaml may name fewer projects than its journal rows place there.
    for (const row of data.stats?.activity ?? []) {
      if (spaceSlugs.has(row.workspace)) {
        map.set(row.project, row.workspace)
      }
    }
    for (const space of spaces.spaces) {
      for (const project of space.projects) {
        map.set(project, space.slug)
      }
    }
    return map
  }, [spaces.spaces, spaceSlugs, data.stats])
  const roomColor = (slug: string): string | null => spaceBySlug.get(slug)?.color ?? null

  const dayStart = hqPlusDayStart(now)
  const [, setNotNowVersion] = useState(0)
  // Why: put-off cards are read back on every render; bumping the version makes one happen.
  const notNowIds = [...readHqPlusNotNow(now)].sort().join('\n')
  const notNow = useMemo(() => new Set(notNowIds ? notNowIds.split('\n') : []), [notNowIds])
  const all = useMemo(
    () =>
      (data.feed ? hqPlusLog(data.feed.entries, data.feed.inbox ?? [], dayStart) : []).map(
        (item) => {
          // Why: a bell item knows its project, not its room; HQ's rooms place it.
          const placed =
            item.room === HQ_PLUS_ANY_ROOM && item.project && roomOfProject.has(item.project)
              ? { ...item, room: roomOfProject.get(item.project) ?? item.room }
              : item
          return placed.kind === 'card' && placed.open && notNow.has(hqPlusNotNowKey(placed))
            ? { ...placed, open: false, done: { by: 'status' as const, status: 'not-now' } }
            : placed
        }
      ),
    [data.feed, dayStart, roomOfProject, notNow]
  )
  // Why: what has no room (HQ's own rows, a bell item of an unknown project) shows in All only.
  const roomItems = useMemo(() => all.filter((item) => !room || item.room === room), [all, room])
  // Why: what HQ+ has on screen is seen; the quiet count on its tab is for what came while away.
  useEffect(() => {
    const unreadIds = new Set(
      (data.feed?.inbox ?? []).flatMap((item) => (item.readAt === null ? [item.id] : []))
    )
    // Why: a short finished turn is a line whose id is its bell item's.
    const unread = roomItems.flatMap((item) => {
      const id = item.kind === 'card' ? (item.inbox?.id ?? null) : item.id.replace(/^inbox:/, '')
      return id && unreadIds.has(id) ? [id] : []
    })
    if (unread.length > 0 && !isWebClientLocation()) {
      void window.api.pulseBell.markRead(unread)
    }
  }, [roomItems, data.feed])
  // Custom build (hq-plus-ui-v3): a chat just started has its card at once, from the live chat list.
  const liveChats = useMemo(
    () =>
      hqPlusLiveChats(
        chatItems,
        dayStart,
        (project) => roomOfProject.get(project) ?? HQ_PLUS_ANY_ROOM
      ).filter((chat) => (!room || chat.room === room) && (!scope || chat.sessionId === scope)),
    [chatItems, dayStart, roomOfProject, room, scope]
  )
  const shown = useMemo(
    () =>
      hqPlusFoldChats(
        hqPlusWithLiveChats(
          scope ? roomItems.filter((item) => hqPlusThreadKey(item) === scope) : roomItems,
          liveChats
        )
      ),
    [roomItems, scope, liveChats]
  )
  const waiting = useMemo(
    () => roomItems.filter((item): item is HqPlusCard => hqPlusNeedsOwner(item)),
    [roomItems]
  )
  const fyi = useMemo(
    () => roomItems.filter((item): item is HqPlusCard => hqPlusIsFyi(item)),
    [roomItems]
  )
  const openByRoom = useMemo(() => {
    const counts = new Map<string, number>()
    for (const card of all.filter((item): item is HqPlusCard => hqPlusNeedsOwner(item))) {
      counts.set(card.room, (counts.get(card.room) ?? 0) + 1)
    }
    return counts
  }, [all])

  const roomOfRepo = useMemo(() => {
    const rooms = new Map<string, string>()
    if (pages.status === 'ready') {
      for (const page of pages.pages) {
        const pageRoom = roomOfProject.get(page.slug)
        if (pageRoom) {
          rooms.set(page.repoId, pageRoom)
        }
      }
    }
    return rooms
  }, [pages, roomOfProject])
  const sideChats = useMemo(
    () =>
      hqPlusSideChats(
        chatItems.filter((item) => !room || (roomOfRepo.get(item.repoId) ?? room) === room),
        now,
        // Why: the read, finished chats fold under «Idle», so the list keeps every open chat.
        Number.POSITIVE_INFINITY
      ),
    [chatItems, room, roomOfRepo, now]
  )
  const names = useMemo(
    () => new Map(data.people.map((person) => [person.id, person.name])),
    [data.people]
  )
  const waits = useMemo<HqPlusWait[]>(
    () =>
      data.waits
        .filter((wait) => !room || (wait.project && roomOfProject.get(wait.project) === room))
        .map((wait) => ({
          personId: wait.personId,
          personName: wait.personId ? (names.get(wait.personId) ?? null) : null,
          project: wait.project,
          title: wait.title,
          createdAt: wait.createdAt,
          direction: wait.direction
        })),
    [data.waits, room, roomOfProject, names]
  )
  const waitsOnThem = useMemo<HqPlusOtherWait[]>(
    () =>
      data.waits
        .filter(
          (wait) =>
            wait.direction === 'on-them' &&
            (!room || (wait.project && roomOfProject.get(wait.project) === room))
        )
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((wait) => ({
          id: wait.id,
          who: (wait.personId ? names.get(wait.personId) : null) ?? null,
          title: wait.title,
          at: wait.createdAt,
          sessionId: wait.agentSessionId ?? null
        })),
    [data.waits, room, roomOfProject, names]
  )
  const slugOfRepo = useMemo(
    () =>
      new Map(pages.status === 'ready' ? pages.pages.map((page) => [page.repoId, page.slug]) : []),
    [pages]
  )
  const repoOfSlug = useMemo(
    () =>
      new Map(pages.status === 'ready' ? pages.pages.map((page) => [page.slug, page.repoId]) : []),
    [pages]
  )
  // Why: one project looks the same everywhere — left list, feed and the session header.
  const projectColor = (slug: string | null): string | null => {
    const repoId = slug ? repoOfSlug.get(slug) : undefined
    return repoId ? colorFor(repoId) : null
  }
  const tileOfChat = (item: (typeof chatItems)[number]): HqPlusTile => ({
    letters: hqPlusTileOf(slugOfRepo.get(item.repoId) ?? item.projectName),
    color: colorFor(item.repoId)
  })
  const chatStatus = (sessionId: string | null): HqPlusBadge | null => {
    const chat = hqPlusChatOfSession(chatItems, sessionId)
    const waitingOn = sessionId
      ? data.waits.find((wait) => wait.direction === 'on-them' && wait.agentSessionId === sessionId)
      : undefined
    if (waitingOn) {
      const who = waitingOn.personId ? names.get(waitingOn.personId) : null
      return { label: who ? `WAITS · ${who}` : 'WAITS', tone: 'waits' }
    }
    switch (chat?.group) {
      case 'needs':
        return { label: 'WAITS · YOU', tone: 'move' }
      case 'working':
        return { label: 'WORKING', tone: 'working' }
      case 'done':
        return { label: 'DONE', tone: 'done' }
      default:
        // Custom build (hq-plus-ui-v3): a chat opened a moment ago has no turn yet — it is starting.
        return chat && !hqPlusChatIsIdle(chat, now) ? { label: 'WORKING', tone: 'working' } : null
    }
  }
  const activity = useMemo(
    () => (data.stats?.activity ?? []).filter((row) => !room || row.workspace === room),
    [data.stats, room]
  )
  const lanes = useMemo(() => hqPlusLanes(activity, waits, now), [activity, waits, now])
  const graph = useMemo(
    () =>
      hqPlusGraph({
        waits,
        pages:
          pages.status === 'ready'
            ? pages.pages.map((page) => ({
                slug: page.slug,
                room: roomOfProject.get(page.slug) ?? '',
                relations: page.relations
              }))
            : [],
        active: new Set(
          lanes.filter((lane) => lane.lastAt >= now - 24 * 60 * 60_000).map((lane) => lane.project)
        ),
        now
      }),
    [waits, pages, roomOfProject, lanes, now]
  )

  const liveOf = (sessionId: string | null): HqLiveSession | null =>
    sessionId
      ? (data.sessions?.sessions.find((session) => session.sessionId === sessionId) ?? null)
      : null
  const showChat = (key: string): void => {
    setChatKey(key)
    setChatFolded(false)
    setTab('session')
    acknowledgeHqChat(chatItems.find((item) => item.key === key))
  }
  const openChat = (sessionId: string | null): (() => void) | null => {
    const listed = hqPlusChatOfSession(chatItems, sessionId)
    if (listed) {
      return () => showChat(listed.key)
    }
    const live = liveOf(sessionId)
    if (!live?.worktreeId) {
      return null
    }
    const chat = { worktreeId: live.worktreeId, sessionId: live.sessionId }
    // Why: a closed chat comes back first; reopening asks HQ to show it, which lands on the right.
    return () => void openHqRouteChat(chat)
  }
  const pickProject = (project: string, sessionId: string | null): void => {
    const live = liveOf(sessionId)
    const newest = all.findLast((item) => item.project === project && item.address)
    setPick({
      project,
      address: live?.address ?? newest?.address ?? null,
      sessionId: live?.sessionId ?? sessionId,
      name: live?.name ?? null
    })
    // Why: «Session» shows the picked project's thread; an open chat would hide it.
    setChatKey(null)
    setPickedFrom(tab === 'river' || tab === 'graph' ? tab : null)
    setTab('session')
  }
  const backFromPick =
    tab === 'session' && !chatKey && pickedFrom
      ? {
          label: translate(...TAB_LABEL[pickedFrom]),
          go: () => {
            setTab(pickedFrom)
            setPickedFrom(null)
          }
        }
      : null
  // Esc first folds the wide panel, then steps back from a picked project.
  const backRef = useRef(backFromPick)
  backRef.current = backFromPick
  const canGoBack = backFromPick !== null
  useEffect(() => {
    if (!wide && !canGoBack) {
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) {
        return
      }
      event.preventDefault()
      if (wide) {
        setWide(false)
      } else {
        backRef.current?.go()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [wide, canGoBack])
  const jump = (card: HqPlusCard): void => {
    setScope(null)
    // Why: the card may be hidden by a thread filter; scroll once the whole log is back.
    setTimeout(() => {
      const target = document.getElementById(`hqp-${card.id}`)
      const log = target?.closest('.hqp-log')
      if (target && log) {
        // Why: scrollIntoView would also scroll the screen's own clipped frame.
        const offset = target.getBoundingClientRect().top - log.getBoundingClientRect().top
        log.scrollTo({
          top: log.scrollTop + offset - log.clientHeight / 2 + target.clientHeight / 2,
          behavior: 'smooth'
        })
      }
      setFlashId(card.id)
      setTimeout(() => setFlashId(null), FLASH_MS)
    }, 40)
  }
  const openReport = (path: string): void => {
    setReportPath(path)
    setTab('report')
  }
  // Custom build (hq-plus-ui-v3): × on a chat closes its tab; one open on the right gives way.
  const closerOf = (item: (typeof chatItems)[number]): HqPlusChatCloser | null =>
    item.kind === 'chat'
      ? {
          working: item.group === 'working',
          close: () => {
            closeHqPlusChat(item)
            if (chatKey === item.key) {
              setChatKey(null)
            }
          }
        }
      : null
  const putOff = (id: string): void => {
    putOffHqPlusCard(id, Date.now())
    setNotNowVersion((version) => version + 1)
  }
  const ctx: HqPlusLogContext = {
    hqPath,
    hqWorktreeId,
    roomColor,
    openChat,
    onScope: (key) => {
      setScope(key)
      const item = all.findLast((candidate) => hqPlusThreadKey(candidate) === key)
      if (item) {
        setPick({
          project: item.project,
          address: item.address,
          sessionId: item.sessionId,
          name: liveOf(item.sessionId)?.name ?? null
        })
      }
    },
    onOpenReport: openReport,
    onNotNow: putOff,
    onChanged: data.reload,
    chatStatus,
    closeChat: (sessionId) => {
      const listed = hqPlusChatOfSession(chatItems, sessionId)
      return listed ? closerOf(listed) : null
    },
    projectColor,
    isOpenChat: (sessionId) =>
      tab === 'session' && chatItem !== null && hqPlusChatOfSession([chatItem], sessionId) !== null
  }
  const pickKey = pick ? hqPlusThreadKey(pick) : null
  const chatItem = chatKey ? (chatItems.find((item) => item.key === chatKey) ?? null) : null
  const shownChat = tab === 'session' ? chatItem : null
  useEffect(
    () =>
      onHqTabRequested((requested) => {
        const key = requested === 'chats' ? rememberedHqChat() : null
        if (key) {
          takeRequestedHqTab()
          setChatKey(key)
          setTab('session')
        }
      }),
    []
  )
  // Why: the chat on the right counts as shown, so its own news needs no popup (as in the classic HQ).
  useEffect(() => {
    setShownHqChat(shownChat)
    return () => setShownHqChat(null)
  }, [shownChat])
  const scopedItem = scope ? all.findLast((item) => hqPlusThreadKey(item) === scope) : undefined
  // Why: a thread without an address is keyed by its session id, which means nothing to the owner.
  const scopeLabel =
    scopedItem?.address ??
    (scopedItem?.project
      ? `${scopedItem.project} · ${liveOf(scopedItem.sessionId)?.name ?? translate('auto.hqPlus.chat', 'chat')}`
      : (scope ?? ''))
  const tabs = TABS.filter((name) => name !== 'report' || reportPath)
  const left = useSidebarResize<HTMLDivElement>({
    isOpen: true,
    width: leftWidth,
    minWidth: HQ_PLUS_PANEL.left.min,
    maxWidth: HQ_PLUS_PANEL.left.max,
    deltaSign: 1,
    setWidth: useCallback((width: number) => {
      setLeftWidth(width)
      saveHqPlusPanelWidth('left', width)
    }, [])
  })
  const right = useSidebarResize<HTMLElement>({
    isOpen: true,
    // Why: the hook writes this width inline; the wide panel is an overlay sized by CSS instead.
    width: rightWidth,
    minWidth: HQ_PLUS_PANEL.right.min,
    maxWidth: HQ_PLUS_PANEL.right.max,
    deltaSign: -1,
    setWidth: useCallback((width: number) => {
      setWide(false)
      setRightWidth(width)
      saveHqPlusPanelWidth('right', width)
    }, [])
  })
  const clearFyi = (): void => {
    void Promise.all(fyi.map((card) => markHqPlusDone(card, 'seen'))).then(() => data.reload())
  }
  const unreviewed = data.sessions?.unreviewed ?? null

  return (
    <div className="hq-plus dark">
      <header className="hqp-top">
        <button
          type="button"
          className="hqp-icon"
          aria-label={translate('auto.hqPlus.projects', 'Projects and new chat')}
          aria-pressed={sidebarOpen}
          onClick={() => setSidebarOpen(!sidebarOpen)}
        >
          ☰
        </button>
        <span className="hqp-brand">
          <span className="hqp-arc" aria-hidden="true">
            <i />
          </span>
          HQ+
        </span>
        <div
          className="hqp-rooms"
          role="group"
          aria-label={translate('auto.hqPlus.rooms', 'Rooms')}
        >
          <button
            type="button"
            className="hqp-room"
            aria-pressed={room === null}
            onClick={() => spaces.setActive(null)}
          >
            <i aria-hidden="true" />
            {translate('auto.hqPlus.overview', 'All')}
            {waitingCount(openByRoom, null) ? <em>{waitingCount(openByRoom, null)}</em> : null}
          </button>
          {spaces.spaces.map((space) => (
            <button
              key={space.slug}
              type="button"
              className="hqp-room"
              style={roomStyle(space.color)}
              aria-pressed={room === space.slug}
              onClick={() => {
                spaces.setActive(space.slug)
                setScope(null)
              }}
            >
              <i aria-hidden="true" />
              {space.name}
              {openByRoom.get(space.slug) ? <em>{openByRoom.get(space.slug)}</em> : null}
            </button>
          ))}
        </div>
        <span className="hqp-spacer" />
        <div className="hqp-meter">
          {unreviewed !== null ? (
            <span
              className="hqp-meter-n"
              title={translate('auto.hqPlus.reviewHint', 'Finished chats waiting for your look')}
            >
              <span
                className="hqp-ring"
                style={ringStyle(unreviewed / HQ_SESSION_UNREVIEWED_CAP)}
                aria-hidden="true"
              />
              {translate('auto.hqPlus.review', 'to review {{count}} of {{cap}}', {
                count: unreviewed,
                cap: HQ_SESSION_UNREVIEWED_CAP
              })}
            </span>
          ) : null}
          <div
            className="hqp-mode"
            role="group"
            aria-label={translate('auto.hq.mode.label', 'Mode')}
          >
            <button type="button" aria-pressed="true">
              {translate('auto.hq.mode.hqPlus', 'HQ+')}
            </button>
            <button
              type="button"
              aria-pressed="false"
              onClick={() => {
                setHqFlavor('classic')
                openHqScreen('chats')
              }}
            >
              {translate('auto.hq.mode.hq', 'HQ')}
            </button>
            <button type="button" aria-pressed="false" onClick={switchHqToCode}>
              {translate('auto.hq.mode.code', 'Code')}
            </button>
          </div>
          <PulseBellButton />
        </div>
      </header>

      <div className="hqp-body" data-wide={wide ? 'true' : undefined}>
        <div className="hqp-side-wrap" ref={left.containerRef}>
          <HqPlusSide
            waiting={waiting}
            fyi={fyi}
            waitsOnThem={waitsOnThem}
            chats={sideChats}
            stats={data.stats}
            picked={tab === 'session' ? chatKey : null}
            tileOf={tileOfChat}
            closerOf={closerOf}
            queue={{
              hqPath,
              hqWorktreeId,
              now,
              onJump: jump,
              openChat,
              onNotNow: (card) => putOff(hqPlusNotNowKey(card)),
              onChanged: data.reload
            }}
            onPickChat={(item) => showChat(item.key)}
            onClearFyi={clearFyi}
          />
        </div>
        <button
          type="button"
          className="hqp-resize"
          data-active={left.isResizing ? 'true' : undefined}
          aria-label={translate('auto.hqPlus.resizeLeft', 'Resize the left panel')}
          onMouseDown={left.onResizeStart}
        >
          <i aria-hidden="true" />
        </button>

        <main
          className="hqp-feed"
          aria-label={translate('auto.hqPlus.feed', 'Conversation with HQ')}
        >
          <div className="hqp-fh">
            <span className="hqp-hl">
              {scope
                ? translate('auto.hqPlus.feed.thread', 'thread · {{key}}', { key: scopeLabel })
                : translate('auto.hqPlus.feed.today', 'conversation with HQ · today')}
            </span>
            {scope ? (
              <button type="button" className="hqp-chip-btn" onClick={() => setScope(null)}>
                {translate('auto.hqPlus.feed.all', 'whole log')}
              </button>
            ) : null}
          </div>
          {data.error && !data.feed ? <p className="hqp-error">{data.error}</p> : null}
          <HqPlusLog
            key={`${room ?? ''}|${scope ?? ''}`}
            items={shown}
            flashId={flashId}
            ctx={ctx}
          />
          <div className="hqp-composer">
            {scope ? (
              <HqPlusThreadComposer
                key={scope}
                target={{
                  address: scopedItem?.address ?? null,
                  sessionId: scopedItem?.sessionId ?? null,
                  replyTo: null,
                  about: null
                }}
                openQuestion={
                  all.findLast(
                    (item): item is HqPlusCard =>
                      item.kind === 'card' &&
                      item.type === 'move' &&
                      item.open &&
                      hqPlusThreadKey(item) === scope
                  ) ?? null
                }
                label={scopeLabel}
                hqPath={hqPath}
                onSent={data.reload}
              />
            ) : (
              <HqCommandBox hqWorktreeId={hqWorktreeId} />
            )}
          </div>
        </main>

        <button
          type="button"
          className="hqp-resize"
          data-active={right.isResizing ? 'true' : undefined}
          aria-label={translate('auto.hqPlus.resizeRight', 'Resize the right panel')}
          onMouseDown={right.onResizeStart}
        >
          <i aria-hidden="true" />
        </button>
        <aside
          className="hqp-ctx"
          ref={right.containerRef}
          aria-label={translate('auto.hqPlus.panel', 'Graph, River, Session')}
        >
          <div className="hqp-tabs" role="tablist">
            {tabs.map((name) => {
              const [key, fallback] = TAB_LABEL[name]
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={tab === name}
                  className="hqp-tab"
                  onClick={() => {
                    setTab(name)
                    if (name === 'session') {
                      setChatFolded(false)
                    }
                  }}
                >
                  {translate(key, fallback)}
                </button>
              )
            })}
            <span className="hqp-spacer" />
            {tab === 'session' && chatItem ? (
              <button
                type="button"
                className="hqp-tab hqp-exp"
                aria-label={translate('auto.hqPlus.foldChat', 'Fold the chat to the bottom')}
                title={translate('auto.hqPlus.foldChat', 'Fold the chat to the bottom')}
                onClick={() => {
                  setChatFolded(true)
                  setWide(false)
                  setTab(pickedFrom ?? 'graph')
                }}
              >
                ⌄
              </button>
            ) : null}
            <button
              type="button"
              className="hqp-tab hqp-exp"
              aria-label={
                wide
                  ? translate('auto.hqPlus.narrow', 'Narrow the panel')
                  : translate('auto.hqPlus.widen', 'Widen the panel')
              }
              aria-pressed={wide}
              onClick={() => setWide(!wide)}
            >
              {wide ? `⤡ ${translate('auto.hqPlus.collapse', 'Collapse')}` : '⤢'}
            </button>
          </div>
          <div className="hqp-pane" role="tabpanel">
            <div
              className="hqp-pv"
              key={tab === 'session' ? `session:${chatItem ? chatItem.key : (pickKey ?? '')}` : tab}
            >
              {tab === 'session' && chatItem ? (
                <HqPlusChatSession
                  item={chatItem}
                  status={statusOfGroup(chatItem.group)}
                  tile={tileOfChat(chatItem)}
                  color={colorFor(chatItem.repoId)}
                  siblings={chatItems.filter(
                    (item) => item.kind === 'chat' && item.repoId === chatItem.repoId
                  )}
                  onPick={(item) => showChat(item.key)}
                />
              ) : tab === 'session' && chatKey ? (
                <p className="hqp-empty">
                  {translate('auto.hqPlus.chat.starting', 'The chat is starting…')}
                </p>
              ) : tab === 'graph' ? (
                <HqPlusGraph
                  graph={graph}
                  roomColor={roomColor}
                  onPickProject={(project) =>
                    pickProject(
                      project,
                      lanes.find((lane) => lane.project === project)?.sessionId ?? null
                    )
                  }
                />
              ) : tab === 'river' ? (
                <HqPlusRiver
                  lanes={lanes}
                  upcoming={data.upcoming}
                  current={pick?.project ?? null}
                  now={now}
                  onPick={(lane: HqPlusLane) => pickProject(lane.project, lane.sessionId)}
                />
              ) : tab === 'session' ? (
                <HqPlusSession
                  pick={pick}
                  live={liveOf(pick?.sessionId ?? null)}
                  hqPath={hqPath}
                  now={now}
                  scoped={Boolean(pickKey && scope === pickKey)}
                  onScope={() => setScope(pickKey && scope !== pickKey ? pickKey : null)}
                  onOpenChat={openChat(pick?.sessionId ?? null)}
                  onDispatched={data.reload}
                  onBack={backFromPick}
                />
              ) : (
                <HqPlusReportView path={reportPath} />
              )}
            </div>
          </div>
          {chatFolded && chatItem && tab !== 'session' ? (
            <HqPlusChatBar
              item={chatItem}
              onExpand={() => {
                setChatFolded(false)
                setTab('session')
              }}
            />
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function waitingCount(counts: Map<string, number>, room: string | null): number {
  return room ? (counts.get(room) ?? 0) : [...counts.values()].reduce((sum, n) => sum + n, 0)
}

function statusOfGroup(group: string): HqPlusBadge | null {
  switch (group) {
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
