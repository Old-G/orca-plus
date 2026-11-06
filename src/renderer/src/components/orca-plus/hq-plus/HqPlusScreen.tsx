// Custom build (hq-plus-ui): HQ+ — the day's conversation with HQ in the middle (decisions as cards that
// stay in place), what waits on the owner and the live chats on the left, Граф / Река / Сессия / a report
// on the right, rooms above and Orca's composer below. Every button goes through the paths agents use.
import type { PulseInboxItem } from '../../../../../shared/pulse-types'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isWebClientLocation } from '@/lib/web-client-location'
import {
  HQ_PLUS_ANY_ROOM,
  hqPlusDayStart,
  hqPlusNotNowKey,
  type HqPlusCard,
  type HqPlusLogItem
} from '../../../../../shared/hq-plus-log'
import { hqPlusFeedLog } from '../../../../../shared/hq-plus-conversations'
import {
  hqPlusFoldChats,
  hqPlusLiftActiveChats,
  hqPlusWithLiveChats
} from '../../../../../shared/hq-plus-fold'
import {
  hqPlusMatchesSearch,
  type HqPlusFeedFilter
} from '../../../../../shared/hq-plus-feed-filter'
import {
  hqPlusProjectCardOf,
  hqPlusProjectFeed,
  type HqPlusProjectFilter,
  type HqPlusProjectInput
} from '../../../../../shared/hq-plus-project-cards'
import {
  hqPlusProjectChatLine,
  type HqPlusProjectChatInput
} from '../../../../../shared/hq-plus-project-lines'
import type { HqPlusMapChatState } from '../../../../../shared/hq-plus-map'
import { hqPlusNeedsOwner, type HqPlusBadge } from '../../../../../shared/hq-plus-kinds'
import {
  hqPlusGraph,
  hqPlusGraphMembers,
  hqPlusLanes,
  type HqPlusLane,
  type HqPlusWait
} from '../../../../../shared/hq-plus-river-graph'
import type { HqLiveSession } from '../../../../../shared/hq-sessions'
import { useNow } from '@/hooks/use-now'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useHqSpaces } from '../hq/use-hq-spaces'
import { useHqProjectPages } from '../hq/use-hq-project-pages'
import { findHqWorktreeId } from '../hq/hq-today-actions'
import { HqCommandBox } from '../hq/HqCommandBox'
import {
  acknowledgeHqChat,
  acknowledgeHqChats,
  setHqProjectKept,
  setShownHqChat
} from '../hq/hq-chat-actions'
import { useHqPeople } from '../hq/HqPeopleTab'
import { HqPlusPeople } from './HqPlusPeople'
import { rememberedHqChat } from '../hq/hq-chat-open'
import { clampSidebarResizeWidth, useSidebarResize } from '@/hooks/useSidebarResize'
import { useHqChatList, useHqProjectColor } from '../hq/use-hq-chat-list'
import { onHqTabRequested, takeRequestedHqTab } from '../hq/hq-view'
import { PulseBellButton } from '../pulse-bell/PulseBellButton'
import { openHqRouteChat } from '../pulse-bell/hq-route-send'
import { hqPlusThreadKey, hqPlusTileOf, type HqPlusLogContext } from './HqPlusLog'
import { HqPlusProjectChips, HqPlusProjectFeed } from './HqPlusProjectFeed'
import type { HqPlusProjectCardContext } from './HqPlusProjectParts'
import { useHqPlusDraftChats } from './use-hq-plus-drafts'
import { HqPlusSide, type HqPlusTile } from './HqPlusSide'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'
import { HqPlusTicker } from './HqPlusTicker'
import type { HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusChatBar, HqPlusChatSession } from './HqPlusChatSession'
import { canFinishHqPlusCard, finishHqPlusCard } from './hq-plus-actions'
import { HQ_PLUS_PANEL, readHqPlusPanelWidth, saveHqPlusPanelWidth } from './hq-plus-panel-widths'
import { HqPlusRiver } from './HqPlusRiver'
import { HqPlusGraph } from './HqPlusGraph'
import { HqPlusSession, type HqPlusPick } from './HqPlusSession'
import { HqPlusAgents } from './HqPlusAgents'
import { HqPlusRooms } from './HqPlusRooms'
import { LinkActionPopover } from '@/components/link-actions/LinkActionPopover'
import {
  closeLinkActionRequest,
  type LinkActionRequest
} from '@/components/link-actions/link-action-request'
import { hqPlusLinkClick, type HqPlusLinkClick } from './hq-plus-link-open'
import { readHqWaitingTags } from '../../../../../shared/hq-waiting-tags'
import { readHqWaitingReplyRef } from '../../../../../shared/hq-waiting-reply-bell'
import { HqPlusTakePanel } from './HqPlusTakePanel'
import {
  HQ_PLUS_VIEW_TABS,
  flushHqPlusViewState,
  readHqPlusViewState,
  saveHqPlusViewState,
  type HqPlusViewTab
} from './hq-plus-view-state'
import { HqPlusReportView } from './HqPlusReportView'
import { HqPlusCenterFile } from './HqPlusCenterFile'
import { HqPlusBrain, type HqPlusBrainActions } from './HqPlusBrain'
import { registerHqPlusBrain } from './hq-plus-brain-open'
import { hqBrainFileTarget } from './hq-plus-brain-view'
import { LOCAL_EXECUTION_HOST_ID } from '../../../../../shared/execution-host'
import { HqPlusCenterBrowser, openHqPlusBrowserPage } from './HqPlusCenterBrowser'
import { registerHqPlusCenterFile } from './hq-plus-center-file'
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
import { readHqPlusProjectFilter, saveHqPlusProjectFilter } from './HqPlusFeedBar'
import {
  closeHqPlusChat,
  hqPlusChatIsIdle,
  hqPlusChatOfSession,
  hqPlusLiveChats,
  hqPlusProjectChats,
  hqPlusTerminalTabMates
} from './hq-plus-chats'
import { setHqPlusLayout, useHqPlusLayout } from './hq-plus-layout'
import { HqPlusMapLayout } from './HqPlusMapLayout'
import { HqPlusLayoutSwitch } from './HqPlusLayoutSwitch'
import { startHqChat } from '../hq/hq-new-chat'
import { activateAndRevealWorktree } from '@/lib/workspace/activation/worktree-activation'
import { useHqPlusRootClass } from './hq-plus-theme'
import { OrcaPlusThemeMenu } from '../theme/OrcaPlusThemeMenu'
import './hq-plus.css'
import './hq-plus-map.css'
import './hq-plus-paper.css'

/** Custom build (hq-plus-map): the Map layout's «Card» tab — what is picked on the map. */
type HqPlusPanelCard = { label: string; active: boolean; body: React.ReactNode; onPick: () => void }

const TICK_MS = 30_000
/** Custom build (hq-project-cards): the chat list's groups as a project card's chat states. */
const CHAT_STATE: Record<string, HqPlusMapChatState> = {
  needs: 'asks',
  working: 'working',
  done: 'done',
  quiet: 'quiet'
}
/** The keys' chips (All, Your move, Chats, Inbox) as the project feed's. */
const KEY_FILTER: Record<HqPlusFeedFilter, HqPlusProjectFilter> = {
  all: 'all',
  move: 'move',
  waits: 'wait',
  chats: 'chats',
  inbox: 'fyi'
}
const NO_IDS: string[] = []
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

export function HqPlusScreen(): React.JSX.Element {
  const data = useHqPlusData()
  // Custom build (hq-plus-map): the Map layout behind its switch; the current one stays the default.
  const layout = useHqPlusLayout()
  const spaces = useHqSpaces()
  const pages = useHqProjectPages()
  const now = useNow(TICK_MS)
  const hqPath = useAppStore((state) => state.settings?.hqPath ?? null)
  const hqWorktreeId = useAppStore((state) =>
    findHqWorktreeId(state.settings?.hqPath, state.repos, state.worktreesByRepo)
  )
  // Custom build (hq-plus-ui-v5): the screen comes back as the owner left it.
  // Custom build (paper-theme): dark HUD or Paper, as Orca's theme.
  const rootClass = useHqPlusRootClass()
  const [view] = useState(readHqPlusViewState)
  const [scope, setScope] = useState<string | null>(view.scope)
  // Custom build (hq-project-cards): which sections the project cards show, remembered per viewer.
  const [feedFilter, setFeedFilter] = useState<HqPlusProjectFilter>(readHqPlusProjectFilter)
  const changeFeedFilter = (filter: HqPlusProjectFilter): void => {
    setFeedFilter(filter)
    saveHqPlusProjectFilter(filter)
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
  // Why: Browser opens in the center now; a panel left on it comes back on the chat.
  const [tab, setTab] = useState<Tab>(
    requestedChat || view.tab === 'browser' ? 'session' : view.tab
  )
  const [wide, setWide] = useState(view.wide)
  // Custom build (hq-plus-ui-v3): the open chat folded to a bar under Graph / River, until «Expand».
  const [chatFolded, setChatFolded] = useState(view.chatFolded)
  const [take, setTake] = useState<PulseInboxItem | null>(null)
  // Custom build (hq-plus-map): the Map layout's panel shows the picked card rather than a tab.
  const [panelCard, setPanelCard] = useState(true)
  // Custom build (hq-closed-loop): «Open» on the chat already open on the right lights it up briefly.
  const [chatFlash, setChatFlash] = useState(false)
  const chatFlashTimer = useRef<number | null>(null)
  // Custom build (hq-plus-ui-v3): where a project picked in the River or Graph came from, for «← Back».
  const [pickedFrom, setPickedFrom] = useState<'river' | 'graph' | null>(view.pickedFrom)
  const [leftWidth, setLeftWidth] = useState(() => readHqPlusPanelWidth('left'))
  const [rightWidth, setRightWidth] = useState(() => readHqPlusPanelWidth('right'))
  const [reportPath, setReportPath] = useState<string | null>(view.reportPath)
  // Custom build (hq-plus-links): where a clicked link should open — the popover chat links show.
  const [linkRequest, setLinkRequest] = useState<LinkActionRequest | null>(null)
  // Custom build (hq-plus-center-file): a file opened from HQ+ shows in the center over the feed.
  const [centerFile, setCenterFile] = useState(false)
  // Custom build (hq-plus-brain): the «Brain» screen over the feed — the queries walked, newest last.
  const [brainStack, setBrainStack] = useState<string[] | null>(null)
  const [brainFocus, setBrainFocus] = useState(0)
  useEffect(
    () =>
      registerHqPlusCenterFile(() => {
        setBrainStack(null)
        setCenterFile(true)
      }),
    []
  )
  // Custom build (hq-plus-center-browser): Orca's own browser over the feed, and whether it has the window.
  const [centerBrowser, setCenterBrowser] = useState(false)
  const [browserFull, setBrowserFull] = useState(false)
  /** Shows Orca's browser in the center, on `url` when given; false when this workspace cannot browse. */
  // Why: the HQ folder's workspace holds the browser tab; without it, the workspace open in Orca does.
  const activeWorktreeId = useAppStore((state) => state.activeWorktreeId)
  const browserWorktreeId = hqWorktreeId ?? activeWorktreeId
  const showBrowser = (url: string | null): boolean => {
    if (!browserWorktreeId || !openHqPlusBrowserPage(browserWorktreeId, url)) {
      return false
    }
    setCenterFile(false)
    setBrainStack(null)
    setCenterBrowser(true)
    return true
  }
  /** Brain on `query`: a new one is walked to, the same one stays; empty opens it on the search box. */
  const openBrain = (query: string): void => {
    setCenterFile(false)
    setCenterBrowser(false)
    setBrowserFull(false)
    if (!query) {
      setBrainFocus((count) => count + 1)
    }
    setBrainStack((stack) => {
      const current = stack?.at(-1)
      if (!stack) {
        return [query]
      }
      if (!query || query === current) {
        return stack
      }
      return current === '' ? [...stack.slice(0, -1), query] : [...stack, query]
    })
  }
  const backFromBrain = (): void =>
    setBrainStack((stack) => (stack && stack.length > 1 ? stack.slice(0, -1) : null))
  // eslint-disable-next-line react-hooks/exhaustive-deps -- openBrain only calls state setters
  useEffect(() => registerHqPlusBrain(openBrain), [])
  const closeBrowser = (): void => {
    setCenterBrowser(false)
    setBrowserFull(false)
  }
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
      // Why: a chat's question is a line under its project's «Your move», as on the Map and the phone.
      (data.feed ? hqPlusFeedLog(data.feed, dayStart, { chatQuestions: 'card' }) : []).map(
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
      // Custom build (hq-ledger-feed): a conversation shows every card folded into it.
      const ids =
        item.kind === 'card'
          ? [item.inbox?.id, ...(item.conversation?.parts ?? []).map((part) => part.inbox?.id)]
          : [item.id.replace(/^inbox:/, '')]
      return ids.filter((id): id is string => Boolean(id && unreadIds.has(id)))
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
  const keptProjectIds = useAppStore((state) => state.settings?.hqKeptProjectIds) ?? NO_IDS
  const markedChatKeys = useAppStore((state) => state.settings?.hqMarkedChatKeys) ?? NO_IDS
  // Custom build (hq-plus-chats-by-project): the left column lists chats by project, as the classic HQ.
  const sideChats = useMemo(
    () =>
      hqPlusProjectChats(
        chatItems.filter((item) => !room || (roomOfRepo.get(item.repoId) ?? room) === room),
        keptProjectIds,
        markedChatKeys,
        now
      ),
    [chatItems, room, roomOfRepo, keptProjectIds, markedChatKeys, now]
  )
  // Custom build (hq-plus-drafts): chats the owner left unsent on purpose, at the top of the column.
  const roomChats = useMemo(
    () => chatItems.filter((item) => !room || (roomOfRepo.get(item.repoId) ?? room) === room),
    [chatItems, room, roomOfRepo]
  )
  const draftChats = useHqPlusDraftChats(roomChats)
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
  // Custom build (hq-plus-cards): an answered waiting's text lives on its card; the row only leads there.
  const answerOfWaiting = useMemo(() => {
    const cards = new Map<string, HqPlusCard>()
    for (const item of all) {
      const waitingId =
        item.kind === 'card' && item.type === 'reply' && item.open
          ? readHqWaitingReplyRef(item.inbox?.refId ?? null)?.waitingId
          : undefined
      if (waitingId && item.kind === 'card') {
        cards.set(waitingId, item)
      }
    }
    return cards
  }, [all])
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
            sessionId: wait.agentSessionId ?? null,
            answer: answerOfWaiting.get(wait.id) ?? null
          }
        }),
    [data.waits, room, roomOfProject, names, answerOfWaiting]
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
  // Custom build (hq-project-cards): what the project cards are built from — the room's rows as the feed
  // shows them, its waits on people, its open chats and today's journal rows; one model for the feed
  // and the Map's panel (and the phone's, from the same src/shared).
  const projectInput = useMemo<HqPlusProjectInput>(() => {
    // Why: a thread picked from a card narrows every part of the cards to that thread.
    const inScope = (ref: { address?: string | null; sessionId: string | null }): boolean =>
      !scope || ref.address === scope || ref.sessionId === scope
    // Why: a thread picked by its address keeps the chats whose turns the scoped rows hold.
    const scopedSessions = new Set(
      shown.flatMap((item) => (item.sessionId ? [item.sessionId] : []))
    )
    return {
      items: shown,
      waits: waitsOnThem.filter(inScope).map((wait) => ({
        id: wait.id,
        personName: wait.who,
        project: wait.project,
        title: wait.title,
        at: wait.at,
        answerId: wait.answer?.id ?? null
      })),
      chats: roomChats.flatMap((item): HqPlusProjectChatInput[] => {
        const sessionId = item.kind === 'chat' ? item.tab.entityId : null
        return inScope({ sessionId }) || (sessionId !== null && scopedSessions.has(sessionId))
          ? [
              {
                key: item.key,
                project: slugOfRepo.get(item.repoId) ?? item.projectName,
                // Why: a chat opened a moment ago has no turn yet; it is starting, not done (hq-card-v2).
                state:
                  item.group === 'quiet' && !hqPlusChatIsIdle(item, now)
                    ? 'working'
                    : (CHAT_STATE[item.group] ?? 'quiet'),
                sessionId,
                title:
                  (item.kind === 'chat' ? item.tab.label : item.worktreeName) || item.projectName,
                at: item.sortAt
              }
            ]
          : []
      }),
      entries: (data.feed?.entries ?? []).filter((entry) => {
        const placed = spaceSlugs.has(entry.workspace)
          ? entry.workspace
          : entry.project
            ? (roomOfProject.get(entry.project) ?? null)
            : null
        return (!room || placed === room) && inScope(entry)
      }),
      since: dayStart
    }
  }, [
    shown,
    scope,
    waitsOnThem,
    roomChats,
    slugOfRepo,
    data.feed,
    spaceSlugs,
    roomOfProject,
    room,
    dayStart,
    now
  ])
  const projectFeed = useMemo(
    () =>
      hqPlusProjectFeed({
        ...projectInput,
        filter: feedFilter,
        search: search.query.trim()
          ? {
              query: search.query,
              matches: (item) =>
                hqPlusMatchesSearch(item, search.query, (id) => names.get(id) ?? null)
            }
          : null
      }),
    [projectInput, feedFilter, search.query, names]
  )
  // Why: the keys, ⌘F and «Done» walk the lines on view, in the order the cards show them.
  const feedItems = useMemo(
    () =>
      projectFeed.cards.flatMap((card) =>
        [...(card.shown.you ? card.you : []), ...(card.shown.fyi ? card.fyi : [])].map(
          (line) => line.card
        )
      ),
    [projectFeed]
  )
  const moveIds = useMemo(
    () => projectFeed.cards.flatMap((card) => card.you.map((line) => line.id)),
    [projectFeed]
  )
  // Why: ⌘F also walks the chats whose reply has the words, by their row's line id.
  const matchIds = useMemo(
    () =>
      search.query.trim()
        ? projectFeed.cards.flatMap((card) => [
            ...[...(card.shown.you ? card.you : []), ...(card.shown.fyi ? card.fyi : [])].map(
              (line) => line.id
            ),
            ...card.chats.flatMap((chat) => {
              const line = card.chatHits.includes(chat.key) ? hqPlusProjectChatLine(chat) : null
              return line ? [line.id] : []
            })
          ])
        : [],
    [projectFeed, search.query]
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
  const chatWaitsOn = (sessionId: string | null): HqPlusBadge | null => {
    const waitingOn = sessionId
      ? data.waits.find((wait) => wait.direction === 'on-them' && wait.agentSessionId === sessionId)
      : undefined
    if (!waitingOn) {
      return null
    }
    const who = waitingOn.personId ? names.get(waitingOn.personId) : null
    return { label: who ? `WAITS · ${who}` : 'WAITS', tone: 'waits' }
  }
  const chatStatus = (sessionId: string | null): HqPlusBadge | null => {
    const chat = hqPlusChatOfSession(chatItems, sessionId)
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
    setPanelCard(false)
    setChatKey(key)
    setChatFolded(false)
    setTab('session')
    acknowledgeHqChat(chatItems.find((item) => item.key === key))
  }
  const flashChat = (): void => {
    if (chatFlashTimer.current !== null) {
      window.clearTimeout(chatFlashTimer.current)
    }
    // Why: off, then on in the next frame, so a second click replays the glow.
    setChatFlash(false)
    window.requestAnimationFrame(() => setChatFlash(true))
    chatFlashTimer.current = window.setTimeout(() => setChatFlash(false), 1200)
  }
  useEffect(
    () => () => {
      if (chatFlashTimer.current !== null) {
        window.clearTimeout(chatFlashTimer.current)
      }
    },
    []
  )
  const openChat = (sessionId: string | null): (() => void) | null => {
    const listed = hqPlusChatOfSession(chatItems, sessionId)
    if (listed) {
      // Why: a chat already open on the right stays where it is — leaving HQ+ for its project
      // only lost the owner's place (25.10); the panel lights up so he sees where it is.
      return tab === 'session' && chatKey === listed.key && !chatFolded
        ? flashChat
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
  // Why: a line hidden by the chips brings the whole feed back before the scroll.
  const goToFeedItem = (goId: string, item: HqPlusLogItem | undefined): void => {
    // Why: a chat's turn is its chat's row in the project card (the row opens on the flash), and an FYI
    // line shows only under the FYI chip.
    const chatLine = projectFeed.cards
      .flatMap((card) => card.chats)
      .map((chat) => hqPlusProjectChatLine(chat))
      .find(
        (line) =>
          line !== null &&
          (line.id === goId ||
            (item?.kind === 'line' && item.sessionId !== null && line.sessionId === item.sessionId))
      )
    const id = chatLine?.id ?? goId
    if (chatLine && feedFilter !== 'all') {
      changeFeedFilter('all')
    } else if (!chatLine && item && !feedItems.some((shownItem) => shownItem.id === id)) {
      const fyi = projectFeed.cards.some((card) => card.fyi.some((line) => line.id === id))
      changeFeedFilter(fyi ? 'fyi' : 'all')
    }
    setTimeout(() => {
      const target = document.getElementById(`hqp-${id}`)
      const log = target?.closest('.hqp-log')
      // Why: a project card's line centres on its header, not on the card open under it.
      const head = target?.querySelector(':scope > .hqpc-rowwrap') ?? target
      if (target && head && log) {
        // Why: scrollIntoView would also scroll the screen's own clipped frame.
        const offset = head.getBoundingClientRect().top - log.getBoundingClientRect().top
        log.scrollTo({
          top: log.scrollTop + offset - log.clientHeight / 2 + head.clientHeight / 2,
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
    // Custom build (hq-plus-picked-chat): the card stays marked, so the owner sees which one it is.
    setSelectedId(card.id)
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
        if (!showBrowser(target)) {
          void window.api.shell.openUrl(target)
        }
      },
      request: setLinkRequest
    })
  const openReport = (path: string): void => {
    setReportPath(path)
    setTab('report')
  }
  // Custom build (hq-plus-ui-v3): × on a chat closes its tab; one open on the right gives way.
  const closerOf = (item: (typeof chatItems)[number]): HqPlusChatCloser =>
    item.kind === 'chat'
      ? {
          working: item.group === 'working',
          close: () => {
            closeHqPlusChat(item)
            if (chatKey === item.key) {
              setChatKey(null)
            }
            // Custom build (hq-closed-loop): a closed chat leaves the feed too; a later turn brings it back.
            const now = Date.now()
            dismissHqPlusChatCard(item.tab.entityId, now, now)
            setDismissVersion((version) => version + 1)
          }
        }
      : {
          // Custom build (hq-plus-close-terminal): a terminal agent closes too (owner, 01.11).
          working: item.group === 'working',
          terminal: true,
          mates: hqPlusTerminalTabMates(chatItems, item),
          close: () => {
            closeHqPlusChat(item)
            if (chatKey === item.key) {
              setChatKey(null)
            }
          }
        }
  const putOff = (id: string): void => {
    putOffHqPlusCard(id, Date.now())
    setNotNowVersion((version) => version + 1)
  }
  const queue: HqPlusQueueActions = {
    hqPath,
    hqWorktreeId,
    now,
    onJump: jump,
    openChat,
    onNotNow: (card) => putOff(hqPlusNotNowKey(card)),
    onChanged: data.reload,
    openLink
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
    chatWaitsOn,
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
      setPanelCard(false)
      setTake(item)
      setChatFolded(false)
    }
  }
  // Custom build (hq-project-cards): what a project card reaches for, in the feed and the Map's panel.
  const worktreeOfProject = (slug: string): string | null => {
    const repoId = repoOfSlug.get(slug)
    if (!repoId) {
      return null
    }
    // Why: a project's workspace — its open chat's, else its main checkout.
    const fromChat = chatItems.find((item) => item.repoId === repoId)?.worktreeId
    const worktrees = (useAppStore.getState().worktreesByRepo[repoId] ?? []).filter(
      (worktree) => !worktree.isArchived
    )
    return (
      fromChat ??
      (worktrees.find((worktree) => worktree.isMainWorktree) ?? worktrees[0])?.id ??
      null
    )
  }
  const waitById = new Map(waitsOnThem.map((wait) => [wait.id, wait]))
  const projectCtx: HqPlusProjectCardContext = {
    log: ctx,
    queue,
    now,
    flashId,
    roomName: (slug) => {
      const slugRoom = roomOfProject.get(slug)
      return slugRoom ? (spaceBySlug.get(slugRoom)?.name ?? null) : null
    },
    chatItem: (key) => chatItems.find((item) => item.key === key) ?? null,
    closerOf,
    showChat,
    newChat: (slug) => {
      const worktreeId = worktreeOfProject(slug)
      return worktreeId ? () => void startHqChat(worktreeId) : null
    },
    openInOrca: (slug) => {
      const worktreeId = worktreeOfProject(slug)
      return worktreeId ? () => void activateAndRevealWorktree(worktreeId) : null
    },
    personName: (id) => names.get(id) ?? null,
    waitsOf: (ids) => ids.flatMap((id) => waitById.get(id) ?? [])
  }
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
    // Custom build (hq-plus-brain): with Brain over the feed, the feed's keys have no rows to walk.
    items: brainStack ? [] : feedItems,
    moveIds: brainStack ? [] : moveIds,
    // Why: on «All» J/K walk the owner's lines first; on a chip, every line it shows.
    filter: feedFilter === 'all' ? 'all' : 'move',
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
    setFilter: (filter) => changeFeedFilter(KEY_FILTER[filter]),
    openSearch: () => {
      if (brainStack) {
        setBrainFocus((count) => count + 1)
        return
      }
      setSearch((current) => ({ ...current, open: true }))
      requestAnimationFrame(() => searchRef.current?.select())
    },
    openBrain: () => openBrain(''),
    escape: () => {
      // Why: the Map layout's own Esc closes its browser, chat and card.
      if (layout === 'map') {
        return false
      }
      if (brainStack) {
        backFromBrain()
        return true
      }
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

  // Custom build (hq-plus-map): back from the Map the Feed's panels mount anew, and the resize hook only
  // writes a width when it changes — so the widths the owner dragged are put back here (owner, 31.10).
  useLayoutEffect(() => {
    if (layout === 'map') {
      return
    }
    const sides: [HTMLElement | null, number][] = [
      [left.containerRef.current, leftWidth],
      [right.containerRef.current, rightWidth]
    ]
    for (const [element, width] of sides) {
      element?.style.setProperty('width', `${width}px`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout])

  /** The right panel's tabs and page; the Map layout adds its own «Card» tab in front (owner, 31.10). */
  const renderPanel = (card: HqPlusPanelCard | null): React.JSX.Element => (
    <>
      <div className="hqp-tabs">
        {/* Custom build (hq-closed-loop): only the tabs scroll sideways; «widen» stays in view. */}
        <div
          className="hqp-tabs-scroll"
          role="tablist"
          onWheel={(event) => {
            if (event.deltaY !== 0 && event.deltaX === 0) {
              event.currentTarget.scrollLeft += event.deltaY
            }
          }}
        >
          {card ? (
            <button
              type="button"
              role="tab"
              aria-selected={!take && card.active}
              className="hqp-tab"
              onClick={card.onPick}
            >
              {card.label}
            </button>
          ) : null}
          {TABS.map((name) => {
            const [key, fallback] = TAB_LABEL[name]
            return (
              <button
                key={name}
                type="button"
                role="tab"
                aria-selected={!take && !card?.active && tab === name}
                className="hqp-tab"
                onClick={() => {
                  // Custom build (hq-plus-center-browser): Browser opens Orca's own in the center.
                  if (name === 'browser') {
                    showBrowser(null)
                    return
                  }
                  // Why: leaving an open chat folds it to the bar at the foot, one click back.
                  if (name !== 'session' && tab === 'session' && chatItem) {
                    setChatFolded(true)
                  }
                  setTab(name)
                  setTake(null)
                  setPanelCard(false)
                  if (name === 'session') {
                    setChatFolded(false)
                  }
                }}
              >
                {translate(key, fallback)}
              </button>
            )
          })}
        </div>
        {card ? null : (
          <button
            type="button"
            className="hqp-tab hqp-exp"
            aria-label={
              wide
                ? translate('auto.hqPlus.narrow', 'Narrow the panel')
                : translate('auto.hqPlus.widen', 'Widen the panel')
            }
            title={
              wide
                ? translate('auto.hqPlus.narrow', 'Narrow the panel')
                : translate('auto.hqPlus.widen', 'Widen the panel')
            }
            aria-pressed={wide}
            onClick={() => setWide(!wide)}
          >
            {wide ? `⤡ ${translate('auto.hqPlus.collapse', 'Collapse')}` : '⤢'}
          </button>
        )}
      </div>
      <div className="hqp-pane" role="tabpanel">
        <div
          className={
            chatFlash && tab === 'session' && !take && !card?.active ? 'hqp-pv hqp-flash' : 'hqp-pv'
          }
          key={
            card?.active && !take
              ? 'card'
              : take
                ? `take:${take.id}`
                : tab === 'session'
                  ? `session:${chatItem ? chatItem.key : (pickKey ?? '')}`
                  : tab
          }
        >
          {card?.active && !take ? (
            card.body
          ) : take ? (
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
      {/* Custom build (hq-plus-map): over the map, the card tab keeps the open chat one click away. */}
      {chatItem && ((chatFolded && tab !== 'session') || (card?.active && !take)) ? (
        <HqPlusChatBar
          item={chatItem}
          onExpand={() => {
            setChatFolded(false)
            setTab('session')
            setPanelCard(false)
          }}
        />
      ) : null}
    </>
  )
  const roomsBar = (
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
  )
  // Custom build (hq-plus-map): Feed is the current layout, Map the new one — one switch (owner, 31.10).
  const layoutSwitch = <HqPlusLayoutSwitch layout={layout} onLayout={setHqPlusLayout} />
  const topTail = (
    <div className="hqp-meter">
      {/* Custom build (hq-plus-brain): Brain — everything about a task, an MR, a person or a project. */}
      <button
        type="button"
        className="hqp-pill hqp-brain-btn"
        aria-pressed={brainStack ? 'true' : 'false'}
        title={translate(
          'auto.hqPlus.brain.button',
          'Everything about a task, an MR, a person or a project (⌘K)'
        )}
        onClick={() => (brainStack ? setBrainStack(null) : openBrain(''))}
      >
        {translate('auto.hqPlus.brain', 'Brain')}
      </button>
      {/* Custom build (paper-theme): Dark, Paper or Auto, next to Brain (owner, 06.11). */}
      <OrcaPlusThemeMenu />
      <PulseBellButton />
    </div>
  )
  const side = (
    <HqPlusSide
      ticker={
        <HqPlusTicker
          items={all}
          onGo={(item) => {
            setScope(null)
            setSelectedId(item.id)
            goToFeedItem(item.id, item)
          }}
        />
      }
      waitsOnThem={waitsOnThem}
      chats={sideChats}
      drafts={draftChats}
      colorFor={colorFor}
      tileOfRepo={(repoId, name) => ({
        letters: hqPlusTileOf(slugOfRepo.get(repoId) ?? name),
        color: colorFor(repoId)
      })}
      onKeepProject={setHqProjectKept}
      onMarkDoneRead={acknowledgeHqChats}
      stats={data.stats}
      picked={tab === 'session' ? chatKey : null}
      tileOf={tileOfChat}
      closerOf={closerOf}
      queue={queue}
      onPickChat={(item) => showChat(item.key)}
      openChats={chatItems}
      chatLinks={data.chatLinks}
    />
  )
  // Custom build (hq-plus-brain): what Brain's rows open — a chat on the right, a link, an HQ page.
  const brainActions: HqPlusBrainActions = {
    openChat: (chat) => {
      const open = openChat(chat.sessionId)
      if (open) {
        open()
      } else if (chat.worktreeId) {
        void openHqRouteChat({ worktreeId: chat.worktreeId, sessionId: chat.sessionId })
      }
    },
    openLink,
    openFile: (path) => {
      const target = hqBrainFileTarget(path, hqPath)
      if (target?.kind === 'hq') {
        openReport(target.path)
      } else if (target?.kind === 'doc') {
        void window.api.shell.openFilePath(target.path, LOCAL_EXECUTION_HOST_ID)
      }
    }
  }
  const brainQuery = brainStack?.at(-1) ?? null
  const centerOverlay =
    brainStack && brainQuery !== null ? (
      <HqPlusBrain
        query={brainQuery}
        backLabel={
          brainStack.length > 1
            ? (brainStack.at(-2) ?? '') || translate('auto.hqPlus.brain', 'Brain')
            : layout === 'map'
              ? 'Map'
              : translate('auto.hqPlus.centerFile.back', 'Feed')
        }
        onQuery={openBrain}
        onBack={backFromBrain}
        actions={brainActions}
        now={now}
        focusSearch={brainFocus}
      />
    ) : centerFile ? (
      <HqPlusCenterFile
        onClose={() => setCenterFile(false)}
        backLabel={layout === 'map' ? 'Map' : null}
      />
    ) : centerBrowser && browserWorktreeId ? (
      <HqPlusCenterBrowser
        worktreeId={browserWorktreeId}
        full={browserFull}
        onFull={setBrowserFull}
        onClose={closeBrowser}
        backLabel={layout === 'map' ? 'Map' : null}
      />
    ) : null
  const linkPopover = (
    <LinkActionPopover
      request={linkRequest}
      onClose={(dismissed) =>
        setLinkRequest((current) => closeLinkActionRequest(current, dismissed))
      }
    />
  )
  if (layout === 'map') {
    return (
      <>
        <HqPlusMapLayout
          rooms={roomsBar}
          layoutSwitch={layoutSwitch}
          tail={topTail}
          room={room}
          roomName={spaces.active?.name ?? translate('auto.hqPlus.overview', 'All')}
          projects={
            spaces.active?.projects ??
            (pages.status === 'ready' ? pages.pages.map((page) => page.slug) : [])
          }
          items={roomItems}
          waits={waitsOnThem}
          chats={roomChats}
          slugOfChat={(item) => slugOfRepo.get(item.repoId) ?? item.projectName}
          closerOf={closerOf}
          panelWidth={rightWidth}
          onPanelWidth={(width) => {
            const next = clampSidebarResizeWidth(
              width,
              HQ_PLUS_PANEL.right.min,
              HQ_PLUS_PANEL.right.max
            )
            setRightWidth(next)
            saveHqPlusPanelWidth('right', next)
          }}
          ctx={ctx}
          queue={queue}
          chat={tab === 'session' && !panelCard ? chatItem : null}
          showChat={showChat}
          closeChat={() => setChatKey(null)}
          cardShown={panelCard}
          showCard={() => {
            setPanelCard(true)
            setTake(null)
          }}
          panel={renderPanel}
          overlay={centerOverlay}
          overlayKind={brainStack ? 'brain' : centerFile ? 'file' : 'browser'}
          closeOverlay={() => {
            setBrainStack(null)
            setCenterFile(false)
            closeBrowser()
          }}
          onYourMove={() => {
            changeFeedFilter('move')
            setHqPlusLayout('current')
          }}
          projectCard={(slug) => hqPlusProjectCardOf(projectInput, slug)}
          projectCtx={projectCtx}
          now={now}
        />
        {linkPopover}
      </>
    )
  }

  return (
    <div className={rootClass}>
      <header className="hqp-top">
        <span className="hqp-brand">
          <span className="hqp-arc" aria-hidden="true">
            <i />
          </span>
          HQ+
        </span>
        {roomsBar}
        {layoutSwitch}
        <span className="hqp-spacer" />
        {topTail}
      </header>

      <div
        className="hqp-body"
        data-wide={wide ? 'true' : undefined}
        data-center-full={centerBrowser && browserFull ? 'true' : undefined}
      >
        <div className="hqp-side-wrap" ref={left.containerRef}>
          {side}
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
                : translate('auto.hqPlus.feed.projects', 'projects · today')}
            </span>
            {scope ? (
              <button type="button" className="hqp-chip-btn" onClick={() => setScope(null)}>
                {translate('auto.hqPlus.feed.all', 'whole log')}
              </button>
            ) : null}
            <span className="hqp-spacer" />
            <HqPlusProjectChips
              filter={feedFilter}
              counts={projectFeed.counts}
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
          {data.error && !data.feed ? <p className="hqp-error">{data.error}</p> : null}
          <HqPlusProjectFeed
            feed={projectFeed}
            filter={feedFilter}
            onFilter={changeFeedFilter}
            ctx={projectCtx}
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
          {centerOverlay}
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
          {renderPanel(null)}
        </aside>
      </div>
      {linkPopover}
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
