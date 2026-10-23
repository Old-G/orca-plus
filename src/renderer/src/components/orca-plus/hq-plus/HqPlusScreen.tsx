// Custom build (hq-plus-ui): HQ+ — the day's conversation with HQ in the middle (decisions as cards that
// stay in place), what waits on the owner and the live chats on the left, Граф / Река / Сессия / a report
// on the right, rooms above and Orca's composer below. Every button goes through the paths agents use.
import { useMemo, useState } from 'react'
import {
  HQ_PLUS_ANY_ROOM,
  hqPlusDayStart,
  hqPlusLog,
  hqPlusWaiting,
  type HqPlusCard
} from '../../../../../shared/hq-plus-log'
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
import { switchHqToCode } from '../hq/hq-chat-actions'
import { openHqScreen } from '../hq/hq-view'
import { PulseBellButton } from '../pulse-bell/PulseBellButton'
import { openHqRouteChat } from '../pulse-bell/hq-route-send'
import { HqPlusLog, hqPlusThreadKey, type HqPlusLogContext } from './HqPlusLog'
import { HqPlusSide } from './HqPlusSide'
import { HqPlusRiver } from './HqPlusRiver'
import { HqPlusGraph } from './HqPlusGraph'
import { HqPlusSession, type HqPlusPick } from './HqPlusSession'
import { HqPlusReportView } from './HqPlusReportView'
import { setHqFlavor } from './hq-plus-flavor'
import { useHqPlusData } from './use-hq-plus-data'
import './hq-plus.css'

const TICK_MS = 30_000
const FLASH_MS = 1800
/** Live chats first; the rest is in History. */
const SIDE_SESSIONS = 6
const TABS = ['graph', 'river', 'session', 'report'] as const
type Tab = (typeof TABS)[number]

const TAB_LABEL: Record<Tab, [string, string]> = {
  graph: ['auto.hqPlus.tab.graph', 'Graph'],
  river: ['auto.hqPlus.tab.river', 'River'],
  session: ['auto.hqPlus.tab.session', 'Session'],
  report: ['auto.hqPlus.tab.report', 'Report']
}

function roomStyle(color: string | null): (React.CSSProperties & Record<'--hqp-room', string>) | undefined {
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
  const [tab, setTab] = useState<Tab>('graph')
  const [wide, setWide] = useState(false)
  const [reportPath, setReportPath] = useState<string | null>(null)
  const [flashId, setFlashId] = useState<string | null>(null)

  const room = spaces.active?.slug ?? null
  const spaceBySlug = useMemo(
    () => new Map(spaces.spaces.map((space) => [space.slug, space])),
    [spaces.spaces]
  )
  const spaceSlugs = useMemo(() => new Set(spaces.spaces.map((space) => space.slug)), [spaces.spaces])
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
  const all = useMemo(
    () => (data.feed ? hqPlusLog(data.feed.entries, data.feed.inbox ?? [], dayStart) : []),
    [data.feed, dayStart]
  )
  const roomItems = useMemo(
    () => all.filter((item) => !room || item.room === room || item.room === HQ_PLUS_ANY_ROOM),
    [all, room]
  )
  const shown = useMemo(
    () => (scope ? roomItems.filter((item) => hqPlusThreadKey(item) === scope) : roomItems),
    [roomItems, scope]
  )
  const waiting = useMemo(() => hqPlusWaiting(roomItems), [roomItems])
  const openByRoom = useMemo(() => {
    const counts = new Map<string, number>()
    for (const card of hqPlusWaiting(all)) {
      counts.set(card.room, (counts.get(card.room) ?? 0) + 1)
    }
    return counts
  }, [all])

  const sessions = useMemo(
    () =>
      (data.sessions?.sessions ?? [])
        .filter(
          (session) =>
            session.state !== 'closed' &&
            (!room || session.workspace === room || session.workspace === HQ_PLUS_ANY_ROOM)
        )
        .sort(
          (a, b) =>
            Number(b.state !== 'done') - Number(a.state !== 'done') ||
            b.lastActivityAt - a.lastActivityAt
        )
        .slice(0, SIDE_SESSIONS),
    [data.sessions, room]
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
  const openChat = (sessionId: string | null): (() => void) | null => {
    const live = liveOf(sessionId)
    if (!live?.worktreeId) {
      return null
    }
    const chat = { worktreeId: live.worktreeId, sessionId: live.sessionId }
    return () => {
      setHqFlavor('classic')
      void openHqRouteChat(chat)
    }
  }
  const pickSession = (session: HqLiveSession): void => {
    setPick({
      project: session.project,
      address: session.address,
      sessionId: session.sessionId,
      name: session.name
    })
    setTab('session')
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
    setTab('session')
  }
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
    onChanged: data.reload
  }
  const pickKey = pick ? hqPlusThreadKey(pick) : null
  const tabs = TABS.filter((name) => name !== 'report' || reportPath)
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
        <div className="hqp-rooms" role="group" aria-label={translate('auto.hqPlus.rooms', 'Rooms')}>
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
          <div className="hqp-mode" role="group" aria-label={translate('auto.hq.mode.label', 'Mode')}>
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
        <HqPlusSide
          waiting={waiting}
          sessions={sessions}
          stats={data.stats}
          picked={pick?.sessionId ?? null}
          now={now}
          roomColor={roomColor}
          onJump={jump}
          onPickSession={pickSession}
        />

        <main className="hqp-feed" aria-label={translate('auto.hqPlus.feed', 'Conversation with HQ')}>
          <div className="hqp-fh">
            <span className="hqp-hl">
              {scope
                ? translate('auto.hqPlus.feed.thread', 'thread · {{key}}', { key: scope })
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
            <HqCommandBox hqWorktreeId={hqWorktreeId} />
          </div>
        </main>

        <aside
          className="hqp-ctx"
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
                  onClick={() => setTab(name)}
                >
                  {translate(key, fallback)}
                </button>
              )
            })}
            <span className="hqp-spacer" />
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
              {wide ? '⤡' : '⤢'}
            </button>
          </div>
          <div className="hqp-pane" role="tabpanel">
            <div className="hqp-pv" key={tab === 'session' ? `session:${pickKey ?? ''}` : tab}>
              {tab === 'graph' ? (
                <HqPlusGraph
                  graph={graph}
                  roomColor={roomColor}
                  onPickProject={(project) =>
                    pickProject(project, lanes.find((lane) => lane.project === project)?.sessionId ?? null)
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
                />
              ) : (
                <HqPlusReportView path={reportPath} />
              )}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

function waitingCount(counts: Map<string, number>, room: string | null): number {
  return room ? (counts.get(room) ?? 0) : [...counts.values()].reduce((sum, n) => sum + n, 0)
}
