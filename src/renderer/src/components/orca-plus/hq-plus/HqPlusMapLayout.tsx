// Custom build (hq-plus-map): HQ+'s Map layout (owner, 30.10: decisions 1a 2a 3a 4a; 31.10: Feed is the
// current layout). The map is the room's hub → sources → projects → people, chats and talks. The panel over
// it on the right holds what is picked in its «Card» tab beside the current layout's tabs (Graph, River,
// Session, Reports, Agents…); a chat opens in Session in its place. The panel moves, stretches and folds.
// A crumb line says where the owner is; Esc closes the top layer: file or browser → chat → card.
import { useEffect, useMemo, useState } from 'react'
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'
import {
  hqPlusMapFeedPlace,
  hqPlusMapModel,
  type HqPlusMapChatState,
  type HqPlusMapLeaf
} from '../../../../../shared/hq-plus-map'
import type { HqChatGroup, HqChatItem } from '../hq/hq-chat-list'
import type { HqPlusLogContext } from './HqPlusLog'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'
import { HqPlusMap, type HqPlusMapPick } from './HqPlusMap'
import { HqPlusMapDock, type HqPlusMapDockPick } from './HqPlusMapDock'
import type { HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusMapSheet } from './HqPlusMapSheet'
import { trunc } from './hq-plus-map-geometry'
import { HqPlusMapCrumbs, type HqPlusMapCrumb } from './HqPlusLayoutSwitch'
import { setHqPlusLayout } from './hq-plus-layout'
import {
  readHqPlusMapView,
  saveHqPlusMapView,
  type HqPlusMapCamera,
  type HqPlusMapDockPlace
} from './hq-plus-map-view'

type Pick = HqPlusMapDockPick

const CHAT_STATE: Record<HqChatGroup, HqPlusMapChatState> = {
  needs: 'asks',
  working: 'working',
  done: 'done',
  quiet: 'quiet'
}

const CHAT_STATE_LABEL: Record<HqPlusMapChatState, string> = {
  asks: 'asks you',
  working: 'working',
  done: 'done',
  quiet: 'quiet'
}

function rememberCamera(camera: HqPlusMapCamera): void {
  saveHqPlusMapView({ camera })
}

function hubLetters(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean)
  return (words.length > 1 ? words.map((word) => word[0]).join('') : name.slice(0, 2))
    .slice(0, 3)
    .toUpperCase()
}

/** The right panel as HQ+ draws it, with a «Card» tab in front for the Map layout. */
export type HqPlusMapPanel = (
  card: { label: string; active: boolean; body: React.ReactNode; onPick: () => void } | null
) => React.JSX.Element

export type HqPlusMapLayoutProps = {
  /** The top bar's parts: the rooms, Feed | Map, and what sits at its right end. */
  rooms: React.ReactNode
  layoutSwitch: React.ReactNode
  tail: React.ReactNode
  room: string | null
  roomName: string
  /** The room's projects, in its order. */
  projects: readonly string[]
  /** The room's feed rows, oldest first. */
  items: readonly HqPlusLogItem[]
  waits: readonly HqPlusOtherWait[]
  /** The room's open chats. */
  chats: readonly HqChatItem[]
  slugOfChat: (item: HqChatItem) => string
  /** × on a chat: closes its tab (History keeps it); null for a row that is not a chat. */
  closerOf: (item: HqChatItem) => HqPlusChatCloser | null
  /** The docked panel's width, shared with the Feed's right panel (owner, 31.10). */
  panelWidth: number
  onPanelWidth: (width: number) => void
  ctx: HqPlusLogContext
  queue: HqPlusQueueActions
  /** The chat on view in the panel's Session tab; null when another tab or the card shows. */
  chat: HqChatItem | null
  showChat: (key: string) => void
  closeChat: () => void
  /** The panel shows the «Card» tab. */
  cardShown: boolean
  showCard: () => void
  panel: HqPlusMapPanel
  /** A file or Orca's browser over the map, when open. */
  overlay: React.ReactNode
  overlayKind: 'file' | 'browser'
  closeOverlay: () => void
  /** «Your move» on top: the feed, filtered to what waits on the owner. */
  onYourMove: () => void
  /** The project's workspace, for a new chat and «Open in Orca». */
  newChat: (slug: string) => (() => void) | null
  openInOrca: (slug: string) => (() => void) | null
  now: number
}

export function HqPlusMapLayout(props: HqPlusMapLayoutProps): React.JSX.Element {
  const { items, waits, chats, chat, now } = props
  const [saved] = useState(readHqPlusMapView)
  const [expandedByRoom, setExpandedByRoom] = useState(saved.expanded)
  const [dock, setDock] = useState<HqPlusMapDockPlace>(saved.dock)
  const [dockFolded, setDockFolded] = useState(saved.dockFolded)
  const roomKey = props.room ?? ''
  // Why: a pick belongs to its room; another room starts with nothing picked.
  const [picked, setPicked] = useState<{ room: string; pick: Pick } | null>(null)
  const pick = picked?.room === roomKey ? picked.pick : null
  const setPick = (next: Pick | null): void =>
    setPicked(next ? { room: roomKey, pick: next } : null)
  const expanded = useMemo(() => new Set(expandedByRoom[roomKey] ?? []), [expandedByRoom, roomKey])
  useEffect(
    () => saveHqPlusMapView({ expanded: expandedByRoom, dock, dockFolded }),
    [expandedByRoom, dock, dockFolded]
  )

  const chatByKey = useMemo(() => new Map(chats.map((item) => [item.key, item])), [chats])
  const model = useMemo(
    () =>
      hqPlusMapModel({
        projects: props.projects,
        items,
        waits: waits.map((wait) => ({
          id: wait.id,
          personName: wait.who,
          project: wait.project,
          title: wait.title,
          at: wait.at,
          answerId: wait.answer?.id ?? null
        })),
        chats: chats.map((item) => ({
          key: item.key,
          project: props.slugOfChat(item),
          state: CHAT_STATE[item.group],
          sessionId: item.kind === 'chat' ? item.tab.entityId : null
        }))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.projects, items, waits, chats]
  )
  const itemById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const youItems = useMemo(
    () => items.filter((item) => hqPlusMapFeedPlace(item) === 'you').toReversed(),
    [items]
  )
  const leafOf = (slug: string, key: string): HqPlusMapLeaf | undefined =>
    model.projects.find((project) => project.slug === slug)?.leaves.find((leaf) => leaf.key === key)

  const setExpanded = (slug: string, open: boolean): void =>
    setExpandedByRoom((current) => {
      const list = (current[roomKey] ?? []).filter((id) => id !== slug)
      return { ...current, [roomKey]: open ? [...list, slug] : list }
    })
  // Why: whatever is picked shows in the panel at once, even folded or on another tab.
  const reveal = (): void => {
    setDockFolded(false)
    props.showCard()
  }
  const pickProject = (slug: string): void => {
    reveal()
    if (pick?.kind === 'project' && pick.slug === slug && expanded.has(slug)) {
      setExpanded(slug, false)
      setPick(null)
      return
    }
    setExpanded(slug, true)
    setPick({ kind: 'project', slug })
  }
  const pickLeaf = (slug: string, leaf: HqPlusMapLeaf): void => {
    setDockFolded(false)
    setPick({ kind: 'leaf', slug, key: leaf.key })
    if (leaf.kind === 'chat') {
      props.showChat(leaf.chatKey)
      return
    }
    props.showCard()
  }
  const pickChats = (): void => {
    reveal()
    setPick({ kind: 'chats' })
  }

  // Esc closes the top layer: the file or browser, the chat (back to the card), then the card.
  const layers = { overlay: Boolean(props.overlay), chat: Boolean(chat), pick: Boolean(pick) }
  useEffect(() => {
    if (!layers.overlay && !layers.chat && !layers.pick) {
      return
    }
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable || target.closest('input, textarea, select') !== null)
      if (event.key !== 'Escape' || event.defaultPrevented || typing) {
        return
      }
      event.preventDefault()
      if (layers.overlay) {
        props.closeOverlay()
      } else if (layers.chat) {
        props.showCard()
      } else {
        setPick(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.overlay, layers.chat, layers.pick])

  const mapPick: HqPlusMapPick | null =
    pick?.kind === 'project' || pick?.kind === 'leaf' ? pick : null

  const home = (): void => {
    setPick(null)
    props.closeOverlay()
    props.showCard()
  }
  // The crumb line: room › Map › project › what is picked › chat › file or browser.
  const crumbs: HqPlusMapCrumb[] = [
    { id: 'room', label: props.roomName, go: home },
    { id: 'view', label: 'Map', go: home }
  ]
  if (pick?.kind === 'project' || pick?.kind === 'leaf') {
    const slug = pick.slug
    crumbs.push({
      id: 'project',
      label: slug,
      go:
        pick.kind === 'leaf' || chat || props.overlay
          ? () => {
              props.closeOverlay()
              props.showCard()
              setPick({ kind: 'project', slug })
            }
          : null
    })
    const leaf = pick.kind === 'leaf' ? leafOf(slug, pick.key) : undefined
    if (leaf && leaf.kind !== 'chat') {
      crumbs.push({
        id: 'leaf',
        label: trunc(leaf.kind === 'person' ? leaf.name : leaf.title, 40),
        go: null
      })
    }
  } else if (pick?.kind === 'chats') {
    crumbs.push({ id: 'chats', label: 'Open chats', go: null })
  }
  if (chat) {
    crumbs.push({
      id: 'chat',
      label: `Chat · ${chat.projectName}`,
      go: props.overlay ? props.closeOverlay : null
    })
  }
  const overlayName = props.overlayKind === 'file' ? 'File' : 'Browser'
  if (props.overlay) {
    crumbs.push({ id: 'overlay', label: overlayName, go: null })
  }
  const escWhat = props.overlay ? overlayName.toLowerCase() : chat ? 'chat' : pick ? 'card' : null

  const card = (
    <HqPlusMapDock
      pick={pick}
      model={model}
      itemById={itemById}
      youItems={youItems}
      chats={chats}
      slugOfChat={props.slugOfChat}
      stateOfChat={(item) => CHAT_STATE_LABEL[CHAT_STATE[item.group]]}
      closerOf={props.closerOf}
      ctx={props.ctx}
      queue={props.queue}
      waits={waits}
      newChat={props.newChat}
      openInOrca={props.openInOrca}
      now={now}
      showChat={props.showChat}
      onPickLeaf={pickLeaf}
      onToFeed={() => setHqPlusLayout('current')}
    />
  )

  return (
    <div className="hq-plus dark hqm">
      <header className="hqp-top">
        <span className="hqp-brand">
          <span className="hqp-arc" aria-hidden="true">
            <i />
          </span>
          HQ+
        </span>
        {props.rooms}
        {props.layoutSwitch}
        <button type="button" className="hqm-you" onClick={props.onYourMove}>
          Your move · {youItems.length}
        </button>
        {/* Custom build (hq-plus-map): how many chats are open, at a glance; a click lists them with × (owner, 31.10). */}
        <button
          type="button"
          className="hqm-chats"
          aria-pressed={pick?.kind === 'chats'}
          onClick={pickChats}
        >
          Chats · {chats.length}
        </button>
        <span className="hqp-spacer" />
        {props.tail}
      </header>

      <div className="hqm-body">
        <HqPlusMapCrumbs crumbs={crumbs} esc={escWhat} />
        <div className="hqm-stage">
          <HqPlusMap
            hub={{ letters: hubLetters(props.roomName), name: props.roomName }}
            model={model}
            expanded={expanded}
            pick={mapPick}
            camera={saved.camera}
            now={now}
            chats={chatByKey}
            closerOfChat={(key) => {
              const item = chatByKey.get(key)
              return item ? props.closerOf(item) : null
            }}
            onCamera={rememberCamera}
            onPickProject={pickProject}
            onPickLeaf={pickLeaf}
            onClear={() => {
              if (props.cardShown) {
                setPick(null)
              }
            }}
          />
          {model.projects.length === 0 ? (
            <p className="hqm-empty-map">Nothing in this room yet.</p>
          ) : null}
          <HqPlusMapSheet
            // Why: docked, the panel is the Feed's right panel and keeps its width both ways; dragged
            // out over the map it is a window of its own size.
            place={dock.float ? dock : { ...dock, width: props.panelWidth }}
            folded={dockFolded}
            foldedLabel={props.cardShown ? 'Card' : chat ? 'Chat' : 'Panel'}
            onPlace={(place) => {
              // Why: docking a dragged-out panel brings back the shared width, not the window's own.
              if (!place.float && !dock.float) {
                props.onPanelWidth(place.width)
              }
              setDock(place)
            }}
            onFold={setDockFolded}
          >
            <div className="hqp-ctx hqm-ctx">
              {props.panel({
                label: 'Card',
                active: props.cardShown,
                body: card,
                onPick: props.showCard
              })}
            </div>
          </HqPlusMapSheet>
          {props.overlay ? <div className="hqm-overlay">{props.overlay}</div> : null}
        </div>
      </div>
    </div>
  )
}
