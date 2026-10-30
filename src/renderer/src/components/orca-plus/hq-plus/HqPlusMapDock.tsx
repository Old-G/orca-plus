// Custom build (hq-plus-map): the «Card» tab of the panel over the map — what is picked there: a project's
// card (what waits, whom it waits for, its chats), a person's waits or one talk's card; with nothing
// picked, what waits on the owner.
import type { HqPlusLogItem } from '../../../../../shared/hq-plus-log'
import type { HqPlusMapLeaf, HqPlusMapModel } from '../../../../../shared/hq-plus-map'
import type { HqChatItem } from '../hq/hq-chat-list'
import { HqPlusLog } from './HqPlusLog'
import { HqPlusWaitsView } from './HqPlusWaitsView'
import { HqPlusMapChatName } from './HqPlusMapLeaf'
import { HQ_PLUS_SOURCE_COLOR, trunc } from './hq-plus-map-geometry'
import type { HqPlusLogContext } from './HqPlusLog'
import type { HqPlusOtherWait, HqPlusQueueActions } from './HqPlusSideQueues'

export type HqPlusMapDockPick =
  | { kind: 'project'; slug: string }
  | { kind: 'leaf'; slug: string; key: string }
  | { kind: 'item'; id: string }

export function hqPlusItemTitle(item: HqPlusLogItem): string {
  return item.kind === 'me' ? item.text : item.title
}

export function HqPlusMapDock({
  pick,
  model,
  itemById,
  youItems,
  chatByKey,
  showChat,
  onPickItem,
  onPickLeaf,
  onToFeed,
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
  chatByKey: ReadonlyMap<string, HqChatItem>
  onPickItem: (id: string) => void
  onPickLeaf: (slug: string, leaf: HqPlusMapLeaf) => void
  onToFeed: () => void
}): React.JSX.Element {
  if (!pick) {
    return (
      <div className="hqm-pane">
        <div className="hqm-top">
          Nothing picked<span className="hqm-pill you">Your move · {youItems.length}</span>
        </div>
        <p className="hqm-sub">
          Pick a project, a person or a chat on the map, or start from what waits for you:
        </p>
        <ul className="hqm-list">
          {youItems.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onPickItem(item.id)}>
                <span className="dot you" />
                <span className="t">{trunc(hqPlusItemTitle(item), 64)}</span>
                <span className="age">{item.project ?? ''}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }
  if (pick.kind === 'item') {
    const item = itemById.get(pick.id)
    return item ? (
      <div className="hqm-pane hqm-cardpane">
        <HqPlusLog key={item.id} items={[item]} flashId={null} ctx={ctx} />
      </div>
    ) : (
      <p className="hqp-empty">This card is gone.</p>
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
          <HqPlusLog key={item.id} items={[item]} flashId={null} ctx={ctx} />
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
  // The project's card.
  const talks = project.leaves.filter((leaf) => leaf.kind === 'talk')
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
      {talks.length ? (
        <>
          <div className="hqm-sec">Your move</div>
          <ul className="hqm-list">
            {talks.map((leaf) => (
              <li key={leaf.key}>
                <button type="button" onClick={() => onPickLeaf(project.slug, leaf)}>
                  <span className="dot you" />
                  <span className="t">{trunc(leaf.title, 60)}</span>
                </button>
              </li>
            ))}
          </ul>
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
      {chatLeaves.length ? (
        <>
          <div className="hqm-sec">Chats</div>
          <ul className="hqm-list">
            {chatLeaves.map((leaf) => {
              const item = leaf.kind === 'chat' ? chatByKey.get(leaf.chatKey) : undefined
              return leaf.kind === 'chat' && item ? (
                <li key={leaf.key}>
                  <button type="button" onClick={() => onPickLeaf(project.slug, leaf)}>
                    <span className={`dot ${leaf.state === 'asks' ? 'you' : ''}`} />
                    <span className="t">
                      <HqPlusMapChatName item={item} max={48} />
                    </span>
                    <span className="age">{leaf.state === 'asks' ? 'asks you' : leaf.state}</span>
                  </button>
                </li>
              ) : null
            })}
          </ul>
        </>
      ) : null}
    </div>
  )
}
