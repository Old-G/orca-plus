// Custom build (hq-plus-ui-v5): HQ+'s «Agents» tab — how many agents work now and which, as a live map
// (projects → agents → their subagents, a line from an agent to the one it started; lines flow while
// an agent works) and a list with each agent's project, state, run time, subagents and last words.
import { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import { formatRelativeTime } from '@/components/activity/activity-thread-presentation'
import type { HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'
import { layoutHqPlusAgents, type HqPlusAgentNode } from './hq-plus-agents-layout'
import type { HqPlusTile } from './HqPlusSide'
import { HqPlusDeferredList, useHqPlusDeferred } from './HqPlusDeferred'

function tileStyle(
  color: string | null
): (React.CSSProperties & Record<'--hqp-room', string>) | undefined {
  return color ? { '--hqp-room': color } : undefined
}

const LIVE_GROUPS: ReadonlySet<HqChatItem['group']> = new Set(['working', 'needs'])

function isLive(item: HqChatItem): boolean {
  return item.group === 'working'
}

function groupLabel(group: HqChatItem['group']): string {
  switch (group) {
    case 'working':
      return translate('auto.hqPlus.agents.working', 'WORKING')
    case 'needs':
      return translate('auto.hqPlus.agents.needs', 'WAITS · YOU')
    case 'done':
      return translate('auto.hqPlus.agents.done', 'DONE')
    case 'quiet':
      return translate('auto.hqPlus.agents.idle', 'IDLE')
  }
}

const TONE: Record<HqChatItem['group'], string> = {
  working: 'working',
  needs: 'move',
  done: 'done',
  quiet: 'bg'
}

function AgentRow({
  item,
  tile,
  now,
  onOpen
}: {
  item: HqChatItem
  tile: HqPlusTile
  now: number
  onOpen: (item: HqChatItem) => void
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  const card = item.card
  const subs = card?.subagents ?? []
  const working = subs.filter((sub) => sub.dotState === 'working').length
  const since = card?.startedAt ? formatRelativeTime(card.startedAt, now) : null
  const said = card?.lastAgentMessage?.replace(/\s+/g, ' ').trim()
  return (
    <li className="hqp-agent" data-live={isLive(item) ? 'true' : undefined}>
      <span className="hqp-tile" style={tileStyle(tile.color)} aria-hidden="true">
        {tile.letters}
      </span>
      <span className="hqp-agent-main">
        <span className="hqp-agent-h">
          <strong>{title}</strong>
          <span className="hqp-badge" data-tone={TONE[item.group]}>
            {groupLabel(item.group)}
          </span>
        </span>
        <span className="hqp-agent-meta">
          {[
            item.projectName,
            item.agentType,
            since
              ? translate('auto.hqPlus.agents.started', 'started {{when}}', { when: since })
              : null,
            subs.length > 0
              ? translate('auto.hqPlus.agents.subs', '{{count}} subagents ({{working}} working)', {
                  count: subs.length,
                  working
                })
              : null
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
        {said ? <span className="hqp-agent-said">{said}</span> : null}
      </span>
      <button type="button" className="hqp-pill" onClick={() => onOpen(item)}>
        {translate('auto.hqPlus.open', 'Open')}
      </button>
    </li>
  )
}

function nodeTitle(node: HqPlusAgentNode, names: ReadonlyMap<string, string>): string {
  return node.kind === 'project' ? node.label : (names.get(node.id) ?? node.id)
}

export function HqPlusAgents({
  items,
  tileOf,
  now,
  onOpen,
  tileOfRepo,
  openPane
}: {
  items: readonly HqChatItem[]
  tileOf: (item: HqChatItem) => HqPlusTile
  now: number
  onOpen: (item: HqChatItem) => void
  tileOfRepo: (repoName: string) => HqPlusTile
  openPane: (paneKey: string) => (() => void) | null
}): React.JSX.Element {
  const deferred = useHqPlusDeferred()
  // Why: the map and the list are about agents at work or waiting; finished ones stay in Chats.
  const active = useMemo(() => items.filter((item) => LIVE_GROUPS.has(item.group)), [items])
  const counts = useMemo(
    () => ({
      working: items.filter((item) => item.group === 'working').length,
      needs: items.filter((item) => item.group === 'needs').length,
      done: items.filter((item) => item.group === 'done').length
    }),
    [items]
  )
  const layout = useMemo(
    () =>
      layoutHqPlusAgents(
        active.map((item) => ({
          key: item.key,
          project: item.projectName,
          paneKey: item.card?.paneKey ?? null,
          parentPaneKey: item.card?.parentPaneKey ?? null,
          live: isLive(item),
          subagents: (item.card?.subagents ?? []).map((sub) => ({
            id: sub.id,
            live: sub.dotState === 'working'
          }))
        }))
      ),
    [active]
  )
  const names = useMemo(
    () =>
      new Map(
        active.flatMap((item) => [
          [item.key, item.card?.conversationName ?? item.projectName] as const,
          ...(item.card?.subagents ?? []).map((sub) => [`${item.key}/${sub.id}`, sub.name] as const)
        ])
      ),
    [active]
  )
  const colorOf = useMemo(
    () => new Map(active.map((item) => [item.projectName, tileOf(item).color] as const)),
    [active, tileOf]
  )
  const at = new Map(layout.nodes.map((node) => [node.id, node]))
  return (
    <div className="hqp-agents">
      <p className="hqp-agents-sum">
        {translate(
          'auto.hqPlus.agents.summary',
          '{{working}} working · {{needs}} wait on you · {{done}} done',
          counts
        )}
      </p>
      {active.length === 0 ? (
        <p className="hqp-empty">
          {translate('auto.hqPlus.agents.none', 'No agent is working right now.')}
        </p>
      ) : (
        <>
          <div className="hqp-agents-map">
            <svg
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              width={layout.width}
              height={layout.height}
              role="img"
              aria-label={translate('auto.hqPlus.agents.map', 'Map of working agents')}
            >
              {layout.edges.map((edge) => {
                const from = at.get(edge.from)
                const to = at.get(edge.to)
                if (!from || !to) {
                  return null
                }
                const d =
                  edge.kind === 'spawn'
                    ? `M${from.x},${from.y} Q${(from.x + to.x) / 2},${from.y + 40} ${to.x},${to.y}`
                    : `M${from.x},${from.y} L${to.x},${to.y}`
                return (
                  <path
                    key={`${edge.from}>${edge.to}`}
                    d={d}
                    className="hqp-agents-edge"
                    data-kind={edge.kind}
                    data-live={edge.live ? 'true' : undefined}
                  />
                )
              })}
              {layout.nodes.map((node) => (
                <g
                  key={node.id}
                  className="hqp-agents-node"
                  data-kind={node.kind}
                  data-live={node.kind !== 'project' && node.live ? 'true' : undefined}
                >
                  <title>{nodeTitle(node, names)}</title>
                  {node.kind === 'project' ? (
                    <>
                      <rect
                        x={node.x - 50}
                        y={node.y - 12}
                        width={100}
                        height={24}
                        rx={7}
                        style={{ stroke: colorOf.get(node.label) ?? undefined }}
                      />
                      <text x={node.x} y={node.y + 4}>
                        {node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}
                      </text>
                    </>
                  ) : (
                    <circle cx={node.x} cy={node.y} r={node.kind === 'agent' ? 9 : 4.5} />
                  )}
                </g>
              ))}
            </svg>
          </div>
          <ul className="hqp-agents-list">
            {active.map((item) => (
              <AgentRow key={item.key} item={item} tile={tileOf(item)} now={now} onOpen={onOpen} />
            ))}
          </ul>
        </>
      )}
      {deferred.sessions.length > 0 ? (
        <section className="hqp-agents-dfr">
          <p className="hqp-agents-sum">
            {translate('auto.hqPlus.agents.unfinished', 'Unfinished · {{count}}', {
              count: deferred.sessions.length
            })}
          </p>
          <HqPlusDeferredList
            sessions={deferred.sessions}
            close={deferred.close}
            now={now}
            tileOf={tileOfRepo}
            onOpen={openPane}
          />
        </section>
      ) : null}
    </div>
  )
}
