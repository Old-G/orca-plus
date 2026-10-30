// Custom build (hq-plus-map): the «Card» tab of the panel over the map — what is picked there: a project's
// card (what waits, whom it waits for, its chats), a person's waits or one talk's card; with nothing
// picked, what waits on the owner. Custom build (hq-plus-map, owner 31.10): what waits shows as the cards
// themselves, decided right here; «Chats» lists the room's open chats, each with its ×.
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'
import {
  hqPlusMapProjectOf,
  type HqPlusMapLeaf,
  type HqPlusMapModel
} from '../../../../../shared/hq-plus-map'
import type { HqChatItem } from '../hq/hq-chat-list'
import { HqPlusLogCards } from './HqPlusLog'
import { HqPlusCloseChat, type HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusWaitsView } from './HqPlusWaitsView'
import { HqPlusMapChatName } from './HqPlusMapLeaf'
import { HQ_PLUS_SOURCE_COLOR, trunc } from './hq-plus-map-geometry'
import type { HqPlusLogContext } from './HqPlusLog'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'

export type HqPlusMapDockPick =
  | { kind: 'project'; slug: string }
  | { kind: 'leaf'; slug: string; key: string }
  | { kind: 'chats' }

export function HqPlusMapDock({
  pick,
  model,
  itemById,
  youItems,
  showChat,
  onPickLeaf,
  onToFeed,
  chats,
  slugOfChat,
  stateOfChat,
  closerOf,
  ctx,
  queue,
  waits,
  newChat,
  openInOrca,
  now
}: {
  ctx: HqPlusLogContext
  queue: HqPlusQueueActions
  waits: readonly HqPlusOtherWait[]
  newChat: (slug: string) => (() => void) | null
  openInOrca: (slug: string) => (() => void) | null
  now: number
  showChat: (key: string) => void
  pick: HqPlusMapDockPick | null
  model: HqPlusMapModel
  itemById: ReadonlyMap<string, HqPlusLogItem>
  youItems: readonly HqPlusLogItem[]
  onPickLeaf: (slug: string, leaf: HqPlusMapLeaf) => void
  onToFeed: () => void
  /** The room's open chats, their project and state, and × for each. */
  chats: readonly HqChatItem[]
  slugOfChat: (item: HqChatItem) => string
  stateOfChat: (item: HqChatItem) => string
  closerOf: (item: HqChatItem) => HqPlusChatCloser | null
}): React.JSX.Element {
  const chatRow = (item: HqChatItem, max: number, onOpen: () => void): React.JSX.Element => {
    const state = stateOfChat(item)
    const closer = closerOf(item)
    return (
      <li key={item.key} className="hqm-chatrow">
        <button type="button" onClick={onOpen}>
          <span className={`dot ${state === 'asks you' ? 'you' : ''}`} />
          <span className="t">
            <HqPlusMapChatName item={item} max={max} />
          </span>
          <span className="age">{state}</span>
        </button>
        {closer ? <HqPlusCloseChat closer={closer} name={item.projectName} /> : null}
      </li>
    )
  }
  if (pick?.kind === 'chats') {
    const bySlug = new Map<string, HqChatItem[]>()
    for (const item of chats) {
      const slug = slugOfChat(item)
      bySlug.set(slug, [...(bySlug.get(slug) ?? []), item])
    }
    return (
      <div className="hqm-pane">
        <div className="hqm-top">
          Open chats<span className="hqm-pill">{chats.length}</span>
        </div>
        <p className="hqm-sub">
          {chats.length
            ? 'A click opens the chat on the right; × closes it, History keeps it.'
            : 'No chat is open in this room.'}
        </p>
        {[...bySlug.entries()].map(([slug, list]) => (
          <div key={slug}>
            <div className="hqm-sec">
              {slug} · {list.length}
            </div>
            <ul className="hqm-list">
              {list.map((item) => chatRow(item, 56, () => showChat(item.key)))}
            </ul>
          </div>
        ))}
      </div>
    )
  }
  if (!pick) {
    return (
      <div className="hqm-pane">
        <div className="hqm-top">
          Nothing picked<span className="hqm-pill you">Your move · {youItems.length}</span>
        </div>
        <p className="hqm-sub">
          {youItems.length
            ? 'What waits for you — decide it here, or pick a project, a person or a chat on the map.'
            : 'Nothing waits for you. Pick a project, a person or a chat on the map.'}
        </p>
        <HqPlusLogCards items={youItems} ctx={ctx} />
      </div>
    )
  }
  const project = model.projects.find((candidate) => candidate.slug === pick.slug)
  if (!project) {
    return <p className="hqp-empty">Nothing here now.</p>
  }
  if (pick.kind === 'leaf') {
    const leaf = project.leaves.find((candidate) => candidate.key === pick.key)
    if (leaf?.kind === 'talk') {
      const item = itemById.get(leaf.itemId)
      return item ? (
        <div className="hqm-pane hqm-cardpane">
          <HqPlusLogCards items={[item]} ctx={ctx} />
        </div>
      ) : (
        <p className="hqp-empty">This card is gone.</p>
      )
    }
    if (leaf?.kind === 'person') {
      const ids = new Set(leaf.waits.map((wait) => wait.id))
      return (
        <div className="hqm-pane">
          <div className="hqm-top">
            <span className="dot" style={{ background: leaf.answered ? '#5fe0a0' : '#5d7d8a' }} />
            {project.slug}
            {leaf.answered ? <span className="hqm-pill you">{leaf.answered} replied</span> : null}
          </div>
          <h4 className="hqm-h">{leaf.name}</h4>
          <p className="hqm-sub">
            You wait for {leaf.waits.length} {leaf.waits.length === 1 ? 'thing' : 'things'}; what
            you asked and what came back:
          </p>
          <HqPlusWaitsView
            waits={waits.filter((wait) => ids.has(wait.id))}
            actions={queue}
            ctx={ctx}
          />
        </div>
      )
    }
  }
  // The project's card: what waits on the owner here as cards, then whom it waits for, then its chats.
  const yourMove = youItems.filter((item) => hqPlusMapProjectOf(item) === project.slug)
  const projectChats = chats.filter((item) => slugOfChat(item) === project.slug)
  const persons = project.leaves.filter((leaf) => leaf.kind === 'person')
  const chatLeaves = project.leaves.filter((leaf) => leaf.kind === 'chat')
  const asking = chatLeaves.find((leaf) => leaf.state === 'asks') ?? chatLeaves[0]
  const startChat = project.unsorted ? null : newChat(project.slug)
  const leave = project.unsorted ? null : openInOrca(project.slug)
  return (
    <div className="hqm-pane">
      <div className="hqm-top">
        {Object.entries(project.sources).map(([source]) => (
          <span
            key={source}
            className="dot"
            style={{
              background: HQ_PLUS_SOURCE_COLOR[source as keyof typeof HQ_PLUS_SOURCE_COLOR]
            }}
          />
        ))}
        {project.unsorted ? 'conversations with no project' : 'project'}
        {project.you ? <span className="hqm-pill you">Your move · {project.you}</span> : null}
      </div>
      <h4 className="hqm-h">{project.slug}</h4>
      <p className="hqm-sub">
        {[
          project.waits ? `${project.waits} waits` : null,
          project.chats ? `${project.chats} chats` : null,
          project.oldestWaitAt !== null
            ? `oldest wait ${Math.max(0, Math.floor((now - project.oldestWaitAt) / 86_400_000))} d`
            : null
        ]
          .filter(Boolean)
          .join(' · ') || 'Nothing waits here.'}
      </p>
      <div className="hqm-acts">
        {asking?.kind === 'chat' ? (
          <button
            type="button"
            className="hqp-pill hqm-pri"
            onClick={() => showChat(asking.chatKey)}
          >
            Chat
          </button>
        ) : null}
        {startChat ? (
          <button type="button" className="hqp-pill" onClick={startChat}>
            + New chat
          </button>
        ) : null}
        {leave ? (
          <button
            type="button"
            className="hqp-pill"
            onClick={leave}
            title="Leaves HQ+ for this project in Orca"
          >
            Open in Orca ⇥
          </button>
        ) : null}
        {project.unsorted ? (
          <button type="button" className="hqp-pill" onClick={onToFeed}>
            Sort in the Feed
          </button>
        ) : null}
      </div>
      {yourMove.length ? (
        <>
          <div className="hqm-sec">Your move · {yourMove.length}</div>
          <HqPlusLogCards items={yourMove} ctx={ctx} />
        </>
      ) : null}
      {persons.length ? (
        <>
          <div className="hqm-sec">You wait for</div>
          <ul className="hqm-list">
            {persons.map((leaf) =>
              leaf.kind === 'person' ? (
                <li key={leaf.key}>
                  <button type="button" onClick={() => onPickLeaf(project.slug, leaf)}>
                    <span
                      className="dot"
                      style={{ background: leaf.answered ? '#5fe0a0' : '#5d7d8a' }}
                    />
                    <span className="t">
                      {leaf.name} · {trunc(leaf.waits[0]?.title ?? '', 44)}
                    </span>
                    <span className="age">
                      {leaf.answered ? `${leaf.answered} replied` : `${leaf.waits.length}`}
                    </span>
                  </button>
                </li>
              ) : null
            )}
          </ul>
        </>
      ) : null}
      {projectChats.length ? (
        <>
          <div className="hqm-sec">Chats · {projectChats.length}</div>
          <ul className="hqm-list">
            {projectChats.map((item) => {
              const leaf = chatLeaves.find(
                (candidate) => candidate.kind === 'chat' && candidate.chatKey === item.key
              )
              return chatRow(item, 48, () =>
                leaf ? onPickLeaf(project.slug, leaf) : showChat(item.key)
              )
            })}
          </ul>
        </>
      ) : null}
    </div>
  )
}
