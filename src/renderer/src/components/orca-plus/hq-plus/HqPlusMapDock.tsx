// Custom build (hq-plus-map): the «Card» tab of the panel over the map — what is picked there: a project's
// card (what waits, whom it waits for, its chats), a person's waits or one talk's card; with nothing
// picked, what waits on the owner. Custom build (hq-plus-map, owner 31.10): what waits shows as the cards
// themselves, decided right here; «Chats» lists the room's open chats, each with its ×. Custom build
// (hq-project-cards): a picked project shows the feed's own project card.
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'
import type { HqPlusMapModel } from '../../../../../shared/hq-plus-map'
import type { HqPlusProjectCard as ProjectCard } from '../../../../../shared/hq-plus-project-cards'
import type { HqChatItem } from '../hq/hq-chat-list'
import { HqPlusLogCards } from './HqPlusLog'
import { HqPlusCloseChat, type HqPlusChatCloser } from './HqPlusCloseChat'
import { HqPlusWaitsView } from './HqPlusWaitsView'
import { HqPlusMapChatName } from './HqPlusMapLeaf'
import { HqPlusProjectCard } from './HqPlusProjectCard'
import type { HqPlusProjectCardContext } from './HqPlusProjectParts'
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
  chats,
  slugOfChat,
  stateOfChat,
  closerOf,
  ctx,
  queue,
  waits,
  projectCard,
  projectCtx
}: {
  ctx: HqPlusLogContext
  queue: HqPlusQueueActions
  waits: readonly HqPlusOtherWait[]
  projectCard: (slug: string) => ProjectCard
  projectCtx: HqPlusProjectCardContext
  showChat: (key: string) => void
  pick: HqPlusMapDockPick | null
  model: HqPlusMapModel
  itemById: ReadonlyMap<string, HqPlusLogItem>
  youItems: readonly HqPlusLogItem[]
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
  // The project's card: the same card the feed shows for it.
  return (
    <div className="hqm-pane">
      <HqPlusProjectCard key={project.slug} card={projectCard(project.slug)} ctx={projectCtx} />
    </div>
  )
}
