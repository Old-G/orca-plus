// Custom build (hq-plus-ui): HQ+ — the day's conversation with HQ in the middle (decisions as cards that
// stay in place), what waits on the owner and the live chats on the left, Граф / Река / Сессия / a report
// on the right, rooms above and Orca's composer below. Every button goes through the paths agents use.
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isWebClientLocation } from '@/lib/web-client-location'
import {
  HQ_PLUS_ANY_ROOM,
  hqPlusDayStart,
  hqPlusLog,
  hqPlusNotNowKey,
  type HqPlusCard,
  type HqPlusLogItem
} from '../../../../../shared/hq-plus-log'
import {
  hqPlusFoldChats,
  hqPlusLiftActiveChats,
  hqPlusWithLiveChats
} from '../../../../../shared/hq-plus-fold'
import {
  hqPlusInFeedFilter,
  hqPlusMatchesSearch,
  type HqPlusFeedFilter
} from '../../../../../shared/hq-plus-feed-filter'
import {
  hqPlusIsFyi,
  hqPlusNeedsOwner,
  type HqPlusBadge
} from '../../../../../shared/hq-plus-kinds'
import {
  hqPlusGraph,
  hqPlusGraphMembers,
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
import { acknowledgeHqChat, openHqChatInProject, setShownHqChat } from '../hq/hq-chat-actions'
import { useHqPeople } from '../hq/HqPeopleTab'
import { HqPlusPeople, HqPlusSidePeople } from './HqPlusPeople'
import { rememberedHqChat } from '../hq/hq-chat-open'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { useHqChatList, useHqProjectColor } from '../hq/use-hq-chat-list'
import { onHqTabRequested, takeRequestedHqTab } from '../hq/hq-view'
import { PulseBellButton } from '../pulse-bell/PulseBellButton'
import { openHqRouteChat } from '../pulse-bell/hq-route-send'
import { HqPlusLog, hqPlusThreadKey, hqPlusTileOf, type HqPlusLogContext } from './HqPlusLog'
import { HqPlusSide, type HqPlusTile } from './HqPlusSide'
import type { HqPlusOtherWait } from './HqPlusSideQueues'
import type { HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusChatBar, HqPlusChatSession } from './HqPlusChatSession'
import { canFinishHqPlusCard, finishHqPlusCard, markHqPlusDone } from './hq-plus-actions'
import { HQ_PLUS_PANEL, readHqPlusPanelWidth, saveHqPlusPanelWidth } from './hq-plus-panel-widths'
import { HqPlusRiver } from './HqPlusRiver'
import { HqPlusGraph } from './HqPlusGraph'
import { HqPlusSession, type HqPlusPick } from './HqPlusSession'
import { HqPlusAgents } from './HqPlusAgents'
import { HqPlusBrowser, type HqPlusBrowserAsk } from './HqPlusBrowser'
import { HqPlusRooms } from './HqPlusRooms'
import { LinkActionPopover } from '@/components/link-actions/LinkActionPopover'
import {
  closeLinkActionRequest,
  type LinkActionRequest
} from '@/components/link-actions/link-action-request'
import { hqPlusLinkClick, type HqPlusLinkClick } from './hq-plus-link-open'
import { readHqWaitingTags } from '../../../../../shared/hq-waiting-tags'
import { HqPlusTakePanel } from './HqPlusTakePanel'
import {
  HQ_PLUS_VIEW_TABS,
  flushHqPlusViewState,
  readHqPlusViewState,
  saveHqPlusViewState,
  type HqPlusViewTab
} from './hq-plus-view-state'
import { HqPlusReportView } from './HqPlusReportView'
import { useHqPlusData } from './use-hq-plus-data'
import { putOffHqPlusCard, readHqPlusNotNow } from './hq-plus-not-now'
import {
  dismissHqPlusChatCard,
  hqPlusChatCardShown,
  readHqPlusDismissed
} from './hq-plus-dismissed'
import { HqPlusThreadComposer } from './HqPlusThreadComposer'
import { HqPlusFeedSearch } from './HqPlusFeedSearch'
import { useHqPlusNewMarks } from './use-hq-plus-new-marks'
import { useHqPlusFeedKeys } from './use-hq-plus-feed-keys'
import {
  HqPlusFeedChips,
  HqPlusSinceLine,
  HqPlusYourMoveLine,
  readHqPlusFeedFilter,
  saveHqPlusFeedFilter
} from './HqPlusFeedBar'
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
const TABS = HQ_PLUS_VIEW_TABS
type Tab = HqPlusViewTab

const TAB_LABEL: Record<Tab, [string, string]> = {
  graph: ['auto.hqPlus.tab.graph', 'Graph'],
  river: ['auto.hqPlus.tab.river', 'River'],
  session: ['auto.hqPlus.tab.session', 'Session'],
  report: ['auto.hqPlus.tab.reports', 'Reports'],
  agents: ['auto.hqPlus.tab.agents', 'Agents'],
  people: ['auto.hqPlus.tab.people', 'People'],
  browser: ['auto.hqPlus.tab.browser', 'Browser']
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
  // Custom build (hq-plus-ui-v5): the screen comes back as the owner left it.
  const [view] = useState(readHqPlusViewState)
  const [scope, setScope] = useState<string | null>(view.scope)
  // Custom build (hq-plus-ui-v4): which rows the feed shows, remembered per viewer.
  const [feedFilter, setFeedFilter] = useState<HqPlusFeedFilter>(readHqPlusFeedFilter)
  const changeFeedFilter = (filter: HqPlusFeedFilter): void => {
    setFeedFilter(filter)
    saveHqPlusFeedFilter(filter)
  }
  // Custom build (hq-plus-ui-v4): unfolded cards and the card the keys act on live here, so keys and
  // clicks fold the same cards; ⌘F's words and where it stands.
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(() => new Set(view.expanded))
  const setExpanded = useCallback((id: string, open: boolean) => {
    setExpandedIds((current) => {
      if (current.has(id) === open) {
        return current
      }
      const next = new Set(current)
      if (open) {
        next.add(id)
      } else {
        next.delete(id)
      }
      return next
    })
  }, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState<{ open: boolean; query: string; at: number }>({
    open: false,
    query: '',
    at: -1
  })
  const searchRef = useRef<HTMLInputElement>(null)
  const [pick, setPick] = useState<HqPlusPick | null>(view.pick)
  // Custom build (hq-plus-ui-v2): a chat started from HQ opens straight in «Session».
  const [requestedChat] = useState<string | null>(() =>
    takeRequestedHqTab() === 'chats' ? rememberedHqChat() : null
  )
  const [tab, setTab] = useState<Tab>(requestedChat ? 'session' : view.tab)
  const [wide, setWide] = useState(view.wide)
  // Custom build (hq-plus-ui-v3): the open chat folded to a bar under Graph / River, until «Expand».
  const [chatFolded, setChatFolded] = useState(view.chatFolded)
  const [take, setTake] = useState<PulseInboxItem | null>(null)
  // Custom build (hq-plus-ui-v3): where a project picked in the River or Graph came from, for «← Back».
  const [pickedFrom, setPickedFrom] = useState<'river' | 'graph' | null>(view.pickedFrom)
  const [leftWidth, setLeftWidth] = useState(() => readHqPlusPanelWidth('left'))
  const [rightWidth, setRightWidth] = useState(() => readHqPlusPanelWidth('right'))
  const [reportPath, setReportPath] = useState<string | null>(view.reportPath)
  // Custom build (hq-plus-round6): the page asked of the Browser tab; it stays mounted once opened.
  const [browserAsk, setBrowserAsk] = useState<HqPlusBrowserAsk | null>(
    view.browserUrl ? { url: view.browserUrl, n: 0 } : null
  )
  // Why: a new ask each time, so the same link clicked again comes back from wherever the page went.
  const askBrowser = (url: string): void =>
    setBrowserAsk((previous) => ({ url, n: (previous?.n ?? 0) + 1 }))
  // Custom build (hq-plus-links): where a clicked link should open — the popover chat links show.
  const [linkRequest, setLinkRequest] = useState<LinkActionRequest | null>(null)
  // Custom build (hq-plus-ui): the chat open on the right — picked on the left, «Open» in the log, or a
  // chat started from HQ (the sidebar's new chat asks HQ to show it, as the classic HQ does).
  const [chatKey, setChatKey] = useState<string | null>(requestedChat ?? view.chatKey)
  const { items: chatItems } = useHqChatList()
  // Custom build (hq-closed-loop): People — the left block, the right tab and the graph's members.
  const peopleState = useHqPeople()
  const [personKey, setPersonKey] = useState<string | null>(null)
  useEffect(() => {
    saveHqPlusViewState({
      scope,
      tab,
      wide,
      chatFolded,
      pickedFrom,
      pick,
      reportPath,
      chatKey,
      expanded: [...expandedIds]
    })
  }, [scope, tab, wide, chatFolded, pickedFrom, pick, reportPath, chatKey, expandedIds])
  useEffect(() => {
    window.addEventListener('pagehide', flushHqPlusViewState)
    return () => {
      window.removeEventListener('pagehide', flushHqPlusViewState)
      flushHqPlusViewState()
    }
  }, [])
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
  const rightChat =
    tab === 'session' && !chatFolded ? chatItems.find((c) => c.key === chatKey) : null
  const shownSessionId = rightChat?.kind === 'chat' ? rightChat.tab.entityId : null
  const all = useMemo(
    () =>
      (data.feed ? hqPlusLog(data.feed.entries, data.feed.inbox ?? [], dayStart) : []).map(
        (item): HqPlusLogItem => {
          // Why: a bell item knows its project, not its room; HQ's rooms place it.
          const placed =
            item.room === HQ_PLUS_ANY_ROOM && item.project && roomOfProject.has(item.project)
              ? { ...item, room: roomOfProject.get(item.project) ?? item.room }
              : item
          if (placed.kind !== 'card' || !placed.open) {
            return placed
          }
          // Custom build (hq-closed-loop): the chat open on the right asks there, not twice.
          if (placed.type === 'move' && placed.sessionId && placed.sessionId === shownSessionId) {
            const { id, at, room, project, address, sessionId, title, body, entry } = placed
            return {
              kind: 'line',
              id,
              at,
              room,
              project,
              address,
              sessionId,
              tone: 'agent',
              title,
              body,
              journalKind: entry?.kind ?? null
            }
          }
          return notNow.has(hqPlusNotNowKey(placed))
            ? { ...placed, open: false, done: { by: 'status' as const, status: 'not-now' } }
            : placed
        }
      ),
    [data.feed, dayStart, roomOfProject, notNow, shownSessionId]
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
  const [dismissVersion, setDismissVersion] = useState(0)
  const shown = useMemo(() => {
    const dismissed = readHqPlusDismissed()
    return hqPlusLiftActiveChats(
      hqPlusFoldChats(
        hqPlusWithLiveChats(
          scope ? roomItems.filter((item) => hqPlusThreadKey(item) === scope) : roomItems,
          liveChats
        )
      ),
      liveChats
    ).filter(
      (item) =>
        item.kind !== 'line' ||
        item.tone !== 'agent' ||
        hqPlusChatCardShown(dismissed, item.sessionId ?? item.address, item.at)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomItems, scope, liveChats, dismissVersion])
  const names = useMemo(
    () => new Map(data.people.map((person) => [person.id, person.name])),
    [data.people]
  )
  const newMarks = useHqPlusNewMarks(all, Boolean(data.feed))
  const feedItems = useMemo(
    () => shown.filter((item) => hqPlusInFeedFilter(item, feedFilter)),
    [shown, feedFilter]
  )
  const matchIds = useMemo(
    () =>
      search.query.trim()
        ? feedItems.flatMap((item) =>
            hqPlusMatchesSearch(item, search.query, (id) => names.get(id) ?? null) ? [item.id] : []
          )
        : [],
    [feedItems, search.query, names]
  )
  const moveIds = useMemo(
    () => shown.flatMap((item) => (hqPlusNeedsOwner(item) ? [item.id] : [])),
    [shown]
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
        .map((wait) => {
          const tags = readHqWaitingTags(wait.detail)
          return {
            id: wait.id,
            who: (wait.personId ? names.get(wait.personId) : null) ?? null,
            title: wait.title,
            detail: tags.text,
            rawDetail: wait.detail,
            task: tags.task,
            snoozedUntil: tags.snoozedUntil,
            checked: tags.checked,
            link: wait.sourceRef,
            project: wait.project,
            at: wait.createdAt,
            sessionId: wait.agentSessionId ?? null
          }
        }),
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
  const tileOfRepo = (repoName: string): HqPlusTile => {
    const repoId = useAppStore.getState().repos.find((repo) => repo.displayName === repoName)?.id
    return {
      letters: hqPlusTileOf((repoId ? slugOfRepo.get(repoId) : undefined) ?? repoName),
      color: repoId ? colorFor(repoId) : null
    }
  }
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
        return chat && !hqPlusChatIsIdle(chat, now) ? { label: 'STARTING', tone: 'working' } : null
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
        members: hqPlusGraphMembers(peopleState.people),
        now
      }),
    [waits, pages, roomOfProject, lanes, now, peopleState.people]
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
  const showPerson = (key: string | null): void => {
    setPersonKey(key)
    setTake(null)
    setTab('people')
  }
  const openChat = (sessionId: string | null): (() => void) | null => {
    const listed = hqPlusChatOfSession(chatItems, sessionId)
    if (listed) {
      // Why: a chat already open on the right opens whole, in its project, rather than doing nothing.
      return tab === 'session' && chatKey === listed.key && !chatFolded
        ? () => void openHqChatInProject(listed)
        : () => showChat(listed.key)
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
  // Why: a card hidden by the chips brings the whole feed back before the scroll.
  const goToFeedItem = (id: string, item: HqPlusLogItem | undefined): void => {
    if (item && !hqPlusInFeedFilter(item, feedFilter)) {
      changeFeedFilter('all')
    }
    setTimeout(() => {
      const target = document.getElementById(`hqp-${id}`)
      const log = target?.closest('.hqp-log')
      if (target && log) {
        // Why: scrollIntoView would also scroll the screen's own clipped frame.
        const offset = target.getBoundingClientRect().top - log.getBoundingClientRect().top
        log.scrollTo({
          top: log.scrollTop + offset - log.clientHeight / 2 + target.clientHeight / 2,
          behavior: 'smooth'
        })
      }
      setFlashId(id)
      setTimeout(() => setFlashId(null), FLASH_MS)
    }, 40)
  }
  const jump = (card: HqPlusCard): void => {
    // Why: the card may be hidden by a thread filter; scroll once the whole log is back.
    setScope(null)
    goToFeedItem(card.id, card)
  }
  const openLink = (url: string, event?: HqPlusLinkClick): void =>
    hqPlusLinkClick(url, event, {
      settings: useAppStore.getState().settings,
      // Why: a web client has no browser session to show a page in.
      canOpenInOrca: !isWebClientLocation(),
      open: (target, destination) => {
        if (destination === 'system') {
          void window.api.shell.openUrl(target)
          return
        }
        askBrowser(target)
        setTab('browser')
      },
      request: setLinkRequest
    })
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
    openLink,
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
    closeChat: (sessionId, fallback) => {
      const listed = hqPlusChatOfSession(chatItems, sessionId)
      const closer = listed ? closerOf(listed) : null
      const dismiss = (): void => {
        if (fallback) {
          dismissHqPlusChatCard(fallback.key, fallback.at, Date.now())
          setDismissVersion((version) => version + 1)
        }
      }
      // Custom build (hq-plus-ui-v5): × on a feed card closes its chat and hides the card in one click.
      if (closer) {
        return {
          ...closer,
          close: () => {
            closer.close()
            dismiss()
          }
        }
      }
      // Why: a chat whose tab is gone still gets ×; it dismisses the card, the journal keeps it.
      return fallback ? { working: false, dismiss: true, close: dismiss } : null
    },
    projectColor,
    chatOf: (sessionId) => {
      const item = hqPlusChatOfSession(chatItems, sessionId)
      const name = liveOf(sessionId)?.name ?? null
      return item || name ? { item, name } : null
    },
    isOpenChat: (sessionId) =>
      tab === 'session' && chatItem !== null && hqPlusChatOfSession([chatItem], sessionId) !== null,
    isExpanded: (id) => expandedIds.has(id),
    setExpanded,
    selectedId,
    onSelect: setSelectedId,
    isNew: (id) => newMarks.newIds.has(id),
    newKeys: [...newMarks.newIds].join('\n'),
    markSeen: newMarks.markSeen,
    now,
    openPane: (paneKey) =>
      chatItems.some((entry) => entry.key === paneKey) ? () => showChat(paneKey) : null,
    tileOfRepo,
    toWork: (item) => {
      setTake(item)
      setChatFolded(false)
    }
  }
  const sinceIds = shown.flatMap((item) => (newMarks.newIds.has(item.id) ? [item.id] : []))
  const stepSearch = (direction: 1 | -1): void => {
    if (matchIds.length === 0) {
      return
    }
    const at =
      search.at === -1 && direction === -1
        ? matchIds.length - 1
        : (search.at + direction + matchIds.length) % matchIds.length
    setSearch({ ...search, at })
    setSelectedId(matchIds[at])
    goToFeedItem(matchIds[at], undefined)
  }
  const closeSearch = (): void => setSearch({ open: false, query: '', at: -1 })
  useHqPlusFeedKeys({
    items: feedItems,
    moveIds,
    filter: feedFilter,
    selectedId,
    select: setSelectedId,
    isExpanded: (id) => expandedIds.has(id),
    setExpanded,
    open: (item) => {
      const report = item.kind === 'card' && item.type === 'report' ? item.inbox?.refId : null
      const chat = openChat(item.sessionId)
      if (chat) {
        chat()
      } else if (report) {
        openReport(report)
      }
    },
    done: (item) => {
      if (item.kind === 'card' && hqPlusNeedsOwner(item) && canFinishHqPlusCard(item)) {
        void finishHqPlusCard(item).then(data.reload)
      }
    },
    setFilter: changeFeedFilter,
    openSearch: () => {
      setSearch((current) => ({ ...current, open: true }))
      requestAnimationFrame(() => searchRef.current?.select())
    },
    escape: () => {
      if (search.open) {
        closeSearch()
        return true
      }
      if (expandedIds.size > 0) {
        setExpandedIds(new Set())
        return true
      }
      return false
    }
  })
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
        <HqPlusRooms
          spaces={spaces.spaces}
          active={room}
          allLabel={translate('auto.hqPlus.overview', 'All')}
          countOf={(slug) => waitingCount(openByRoom, slug)}
          onPick={(slug) => {
            spaces.setActive(slug)
            if (slug !== null) {
              setScope(null)
            }
          }}
        />
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
              onChanged: data.reload,
              openLink
            }}
            onPickChat={(item) => showChat(item.key)}
            onClearFyi={clearFyi}
            peopleBlock={
              <HqPlusSidePeople
                state={peopleState}
                picked={tab === 'people' ? personKey : null}
                onPick={(key) => showPerson(key)}
                onAll={() => showPerson(null)}
              />
            }
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
            <span className="hqp-spacer" />
            <HqPlusFeedChips
              filter={feedFilter}
              moves={moveIds.length}
              onFilter={changeFeedFilter}
            />
          </div>
          {search.open ? (
            <HqPlusFeedSearch
              query={search.query}
              matches={matchIds.length}
              at={search.at}
              inputRef={searchRef}
              onQuery={(query) => setSearch({ open: true, query, at: -1 })}
              onStep={stepSearch}
              onClose={closeSearch}
            />
          ) : null}
          <div className="hqp-pins">
            <HqPlusYourMoveLine
              ids={moveIds}
              onGo={(id) => {
                setSelectedId(id)
                goToFeedItem(
                  id,
                  shown.find((item) => item.id === id)
                )
              }}
            />
            <HqPlusSinceLine
              ids={sinceIds}
              onGo={(id) => {
                setSelectedId(id)
                goToFeedItem(
                  id,
                  shown.find((item) => item.id === id)
                )
              }}
            />
          </div>
          {data.error && !data.feed ? <p className="hqp-error">{data.error}</p> : null}
          <HqPlusLog
            key={`${room ?? ''}|${scope ?? ''}|${feedFilter}`}
            items={feedItems}
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
          aria-label={translate('auto.hqPlus.panel', 'Graph, River, Session, Agents')}
        >
          <div className="hqp-tabs" role="tablist">
            {TABS.map((name) => {
              const [key, fallback] = TAB_LABEL[name]
              return (
                <button
                  key={name}
                  type="button"
                  role="tab"
                  aria-selected={!take && tab === name}
                  className="hqp-tab"
                  onClick={() => {
                    setTab(name)
                    setTake(null)
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
            {browserAsk !== null || tab === 'browser' ? (
              <div className="hqp-pv" hidden={tab !== 'browser' || Boolean(take)}>
                <HqPlusBrowser
                  ask={browserAsk}
                  onOpen={askBrowser}
                  onUrl={(url) => saveHqPlusViewState({ browserUrl: url })}
                />
              </div>
            ) : null}
            <div
              hidden={tab === 'browser' && !take}
              className="hqp-pv"
              key={
                take
                  ? `take:${take.id}`
                  : tab === 'session'
                    ? `session:${chatItem ? chatItem.key : (pickKey ?? '')}`
                    : tab
              }
            >
              {take ? (
                <HqPlusTakePanel
                  item={take}
                  onCancel={() => setTake(null)}
                  onDone={(sessionId) => {
                    setTake(null)
                    data.reload()
                    openChat(sessionId)?.()
                  }}
                />
              ) : tab === 'session' && chatItem ? (
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
              ) : tab === 'people' ? (
                <HqPlusPeople
                  state={peopleState}
                  picked={personKey}
                  onPick={setPersonKey}
                  hqWorktreeId={hqWorktreeId}
                />
              ) : tab === 'agents' ? (
                <HqPlusAgents
                  items={chatItems}
                  tileOf={tileOfChat}
                  now={now}
                  onOpen={(item) => showChat(item.key)}
                  tileOfRepo={tileOfRepo}
                  openPane={ctx.openPane}
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
              ) : tab === 'browser' ? null : (
                <HqPlusReportView path={reportPath} onPick={setReportPath} />
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
      <LinkActionPopover
        request={linkRequest}
        onClose={(dismissed) =>
          setLinkRequest((current) => closeLinkActionRequest(current, dismissed))
        }
      />
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
