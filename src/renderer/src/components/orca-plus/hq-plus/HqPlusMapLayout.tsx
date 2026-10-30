// Custom build (hq-plus-map): HQ+'s Map layout (owner, 30.10: decisions 1a 2a 3a 4a). Feed | Map on top;
// the map is the room's hub → sources → projects → people, chats and talks; the feed is one card per
// conversation in All · Your move · Waiting · FYI · Done with the chat list on the left. What is picked
// shows in the dock on the right — over the map it slides in and folds — and a chat opens in its place.
// A crumb line says where the owner is; Esc closes the top layer: browser → chat → card.
import { useEffect, useMemo, useState } from 'react'
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'
import {
  HQ_PLUS_MAP_UNSORTED,
  hqPlusMapFeedPlace,
  hqPlusMapFeedRows,
  hqPlusMapModel,
  type HqPlusMapChatState,
  type HqPlusMapFeedTab,
  type HqPlusMapLeaf,
  type HqPlusMapProject
} from '../../../../../shared/hq-plus-map'
import type { HqChatGroup, HqChatItem } from '../hq/hq-chat-list'
import { HqPlusLog, type HqPlusLogContext } from './HqPlusLog'
import { HqPlusWaitsView } from './HqPlusWaitsView'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'
import { HqPlusMap, type HqPlusMapPick } from './HqPlusMap'
import { HqPlusMapDock, hqPlusItemTitle, type HqPlusMapDockPick } from './HqPlusMapDock'
import { trunc } from './hq-plus-map-geometry'
import { HqPlusMapCrumbs, type HqPlusMapCrumb } from './HqPlusLayoutSwitch'
import { readHqPlusMapView, saveHqPlusMapView, type HqPlusMapCamera } from './hq-plus-map-view'

type Pick = HqPlusMapDockPick

function rememberCamera(camera: HqPlusMapCamera): void {
  saveHqPlusMapView({ camera })
}

const TAB_LABEL: Record<HqPlusMapFeedTab, string> = {
  all: 'All',
  you: 'Your move',
  wait: 'Waiting',
  fyi: 'FYI',
  done: 'Done'
}

const CHAT_STATE: Record<HqChatGroup, HqPlusMapChatState> = {
  needs: 'asks',
  working: 'working',
  done: 'done',
  quiet: 'quiet'
}

export type HqPlusMapLayoutProps = {
  /** The top bar's own parts: the rooms and what sits at its right end. */
  rooms: React.ReactNode
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
  ctx: HqPlusLogContext
  queue: HqPlusQueueActions
  /** The chat list on the Feed's left. */
  side: React.ReactNode
  /** The chat open in the dock and how it is drawn there. */
  chat: HqChatItem | null
  renderChat: (item: HqChatItem) => React.ReactNode
  showChat: (key: string) => void
  closeChat: () => void
  /** Orca's browser over the map or feed, when open. */
  browser: React.ReactNode
  closeBrowser: () => void
  composer: React.ReactNode
  /** The project's workspace, for a new chat and «Open in Orca». */
  newChat: (slug: string) => (() => void) | null
  openInOrca: (slug: string) => (() => void) | null
  now: number
}

export function HqPlusMapLayout(props: HqPlusMapLayoutProps): React.JSX.Element {
  const { items, waits, chats, ctx, chat, now } = props
  const [saved] = useState(readHqPlusMapView)
  const [view, setView] = useState(saved.view)
  const [tab, setTab] = useState(saved.tab)
  const [expandedByRoom, setExpandedByRoom] = useState(saved.expanded)
  const [dockFolded, setDockFolded] = useState(saved.dockFolded)
  const roomKey = props.room ?? ''
  // Why: a pick belongs to its room; another room starts with nothing picked.
  const [picked, setPicked] = useState<{ room: string; pick: Pick } | null>(null)
  const pick = picked?.room === roomKey ? picked.pick : null
  const setPick = (next: Pick | null): void =>
    setPicked(next ? { room: roomKey, pick: next } : null)
  const expanded = useMemo(() => new Set(expandedByRoom[roomKey] ?? []), [expandedByRoom, roomKey])
  useEffect(
    () => saveHqPlusMapView({ view, tab, expanded: expandedByRoom, dockFolded }),
    [view, tab, expandedByRoom, dockFolded]
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
  const projectOf = (slug: string): HqPlusMapProject | undefined =>
    model.projects.find((project) => project.slug === slug)
  const leafOf = (slug: string, key: string): HqPlusMapLeaf | undefined =>
    projectOf(slug)?.leaves.find((leaf) => leaf.key === key)

  const youItems = useMemo(
    () => items.filter((item) => hqPlusMapFeedPlace(item) === 'you').toReversed(),
    [items]
  )
  const counts: Record<HqPlusMapFeedTab, number> = {
    all: hqPlusMapFeedRows(items, 'all').length,
    you: youItems.length,
    wait: waits.length,
    fyi: hqPlusMapFeedRows(items, 'fyi').length,
    done: hqPlusMapFeedRows(items, 'done').length
  }
  const rows = useMemo(() => hqPlusMapFeedRows(items, tab), [items, tab])

  const setExpanded = (slug: string, open: boolean): void =>
    setExpandedByRoom((current) => {
      const list = (current[roomKey] ?? []).filter((id) => id !== slug)
      return { ...current, [roomKey]: open ? [...list, slug] : list }
    })
  const pickProject = (slug: string): void => {
    props.closeChat()
    setDockFolded(false)
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
    if (leaf.kind === 'chat') {
      setPick({ kind: 'leaf', slug, key: leaf.key })
      props.showChat(leaf.chatKey)
      return
    }
    props.closeChat()
    setPick({ kind: 'leaf', slug, key: leaf.key })
  }
  const pickItem = (id: string): void => {
    props.closeChat()
    setDockFolded(false)
    setPick({ kind: 'item', id })
  }

  // Esc closes the top layer: the browser, the chat, then the card.
  const layers = { browser: Boolean(props.browser), chat: Boolean(chat), pick: Boolean(pick) }
  useEffect(() => {
    if (!layers.browser && !layers.chat && !layers.pick) {
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
      if (layers.browser) {
        props.closeBrowser()
      } else if (layers.chat) {
        props.closeChat()
      } else {
        setPick(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers.browser, layers.chat, layers.pick])

  const mapPick: HqPlusMapPick | null =
    pick?.kind === 'project' || pick?.kind === 'leaf'
      ? pick
      : pick?.kind === 'item'
        ? (() => {
            const project = model.projects.find((candidate) =>
              candidate.leaves.some((leaf) => leaf.kind === 'talk' && leaf.itemId === pick.id)
            )
            return project
              ? { kind: 'leaf' as const, slug: project.slug, key: `talk:${pick.id}` }
              : null
          })()
        : null

  // The crumb line: room › view › project › what is picked › chat › browser.
  const crumbs: HqPlusMapCrumb[] = [
    {
      id: 'room',
      label: props.roomName,
      go: () => {
        setPick(null)
        props.closeChat()
        props.closeBrowser()
      }
    },
    {
      id: 'view',
      label: view === 'map' ? 'Map' : 'Feed',
      go: () => {
        setPick(null)
        props.closeChat()
        props.closeBrowser()
      }
    }
  ]
  if (pick?.kind === 'project' || pick?.kind === 'leaf') {
    const slug = pick.slug
    crumbs.push({
      id: 'project',
      label: slug,
      go:
        pick.kind === 'leaf'
          ? () => {
              props.closeChat()
              props.closeBrowser()
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
  } else if (pick?.kind === 'item') {
    const item = itemById.get(pick.id)
    if (item) {
      crumbs.push({ id: 'project', label: item.project ?? HQ_PLUS_MAP_UNSORTED, go: null })
      crumbs.push({ id: 'item', label: trunc(hqPlusItemTitle(item), 40), go: null })
    }
  }
  if (chat) {
    crumbs.push({
      id: 'chat',
      label: `Chat · ${chat.projectName}`,
      go: props.browser ? props.closeBrowser : null
    })
  }
  if (props.browser) {
    crumbs.push({ id: 'browser', label: 'Browser', go: null })
  }
  const escWhat = props.browser ? 'browser' : chat ? 'chat' : pick ? 'card' : null

  const dock = (
    <HqPlusMapDock
      {...props}
      pick={pick}
      model={model}
      itemById={itemById}
      youItems={youItems}
      chatByKey={chatByKey}
      onPickItem={pickItem}
      onPickLeaf={pickLeaf}
      onBackToCard={pick ? props.closeChat : null}
      onToFeed={() => {
        setView('feed')
        setTab('all')
        setPick(null)
      }}
    />
  )
  // Why: over the map the dock is a sheet that folds to the edge; in the feed it is a column, shown for
  // a chat or a picked person or project (cards are already whole in the feed).
  const feedDock = chat || (pick && pick.kind !== 'item')

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
        <div className="hqm-seg" role="tablist" aria-label="View">
          {(['feed', 'map'] as const).map((name) => (
            <button
              key={name}
              type="button"
              role="tab"
              aria-selected={view === name}
              onClick={() => {
                setView(name)
                props.closeBrowser()
              }}
            >
              {name === 'map' ? 'Map' : 'Feed'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="hqm-you"
          onClick={() => {
            setView('feed')
            setTab('you')
          }}
        >
          Your move · {counts.you}
        </button>
        <span className="hqp-spacer" />
        {props.tail}
      </header>

      <div className="hqm-body">
        <HqPlusMapCrumbs crumbs={crumbs} esc={escWhat} />

        {view === 'map' ? (
          <div className="hqm-stage">
            <HqPlusMap
              hub={{ letters: hubLetters(props.roomName), name: props.roomName }}
              model={model}
              expanded={expanded}
              pick={mapPick}
              camera={saved.camera}
              now={now}
              chats={chatByKey}
              onCamera={rememberCamera}
              onPickProject={pickProject}
              onPickLeaf={pickLeaf}
              onClear={() => {
                if (!chat) {
                  setPick(null)
                }
              }}
            />
            {model.projects.length === 0 ? (
              <p className="hqm-empty-map">Nothing in this room yet.</p>
            ) : null}
            <aside
              className="hqm-dock hqm-sheet"
              data-folded={dockFolded ? 'true' : undefined}
              data-wide={chat ? 'true' : undefined}
              aria-label="Card and chat"
            >
              <button
                type="button"
                className="hqm-fold"
                aria-label={dockFolded ? 'Show the panel' : 'Fold the panel'}
                title={dockFolded ? 'Show the panel' : 'Fold the panel'}
                onClick={() => setDockFolded(!dockFolded)}
              >
                {dockFolded ? '‹' : '›'}
              </button>
              {dockFolded ? null : dock}
            </aside>
            {props.browser ? <div className="hqm-browser">{props.browser}</div> : null}
          </div>
        ) : (
          <div className="hqm-feedview" data-dock={feedDock ? 'true' : undefined}>
            <div className="hqm-side">{props.side}</div>
            <main className="hqp-feed hqm-feed" aria-label="Feed">
              <div className="hqm-tabs" role="tablist">
                {(['all', 'you', 'wait', 'fyi', 'done'] as const).map((name) => (
                  <button
                    key={name}
                    type="button"
                    role="tab"
                    aria-selected={tab === name}
                    data-you={name === 'you' ? 'true' : undefined}
                    onClick={() => setTab(name)}
                  >
                    {TAB_LABEL[name]} · {counts[name]}
                  </button>
                ))}
              </div>
              {tab === 'wait' ? (
                <HqPlusWaitsView waits={waits} actions={props.queue} ctx={ctx} />
              ) : rows.length === 0 ? (
                <p className="hqp-empty">Nothing here.</p>
              ) : (
                <HqPlusLog key={`${roomKey}|${tab}`} items={rows} flashId={null} ctx={ctx} />
              )}
              <div className="hqp-composer">{props.composer}</div>
              {props.browser ? <div className="hqm-browser">{props.browser}</div> : null}
            </main>
            {feedDock ? (
              <aside className="hqm-dock hqm-column" aria-label="Card and chat">
                {dock}
              </aside>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}

function hubLetters(name: string): string {
  const words = name.split(/[\s_-]+/).filter(Boolean)
  return (words.length > 1 ? words.map((word) => word[0]).join('') : name.slice(0, 2))
    .slice(0, 3)
    .toUpperCase()
}
