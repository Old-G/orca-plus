// Custom build (hq-plus-map): one unfolded leaf on the map — a person the project waits on, one of its
// chats, or a talk that waits on the owner; and a project's own node.
import type { HqPlusMapLeaf, HqPlusMapProject } from '../../../../../shared/hq-plus-map'
import type { HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'
import {
  AMBER,
  H_PRJ,
  HQ_PLUS_SOURCE_COLOR,
  W_LEAF,
  W_PRJ,
  age,
  squares,
  trunc
} from './hq-plus-map-geometry'

/** A chat's name, read from its tab. */
export function HqPlusMapChatName({
  item,
  max
}: {
  item: HqChatItem
  max: number
}): React.JSX.Element {
  return <>{trunc(useHqChatTitle(item), max)}</>
}

export function HqPlusMapLeafView({
  leaf,
  now,
  chat
}: {
  leaf: HqPlusMapLeaf
  now: number
  chat: HqChatItem | undefined
}): React.JSX.Element {
  const right = W_LEAF - 10
  if (leaf.kind === 'person') {
    return (
      <>
        <circle
          cx={16}
          cy={14}
          r={8}
          className="hqm-avatar"
          stroke={leaf.answered ? '#5fe0a0' : '#5d7d8a'}
        />
        <text x={16} y={17.5} textAnchor="middle" className="hqm-initial">
          {leaf.name.slice(0, 1)}
        </text>
        <text x={32} y={18} className="hqm-leaf">
          {trunc(leaf.name, 24)}
        </text>
        <text
          x={right}
          y={18}
          textAnchor="end"
          className="hqm-det hqm-lod-mid"
          fill={leaf.answered ? AMBER : undefined}
        >
          {leaf.waits.length} {leaf.waits.length === 1 ? 'wait' : 'waits'}
          {leaf.answered ? ` · ${leaf.answered} replied` : ''} · {age(leaf.oldestAt, now)}
        </text>
      </>
    )
  }
  if (leaf.kind === 'chat') {
    const label = { asks: 'asks you', working: 'working', done: 'done', quiet: 'quiet' }[leaf.state]
    return (
      <>
        <rect
          x={9}
          y={7}
          width={14}
          height={14}
          rx={3}
          fill={leaf.state === 'asks' ? AMBER : leaf.state === 'working' ? '#2c6b85' : '#1b3340'}
        />
        <text x={32} y={18} className="hqm-leaf">
          {chat ? <HqPlusMapChatName item={chat} max={34} /> : 'Chat'}
        </text>
        <text
          x={right}
          y={18}
          textAnchor="end"
          className="hqm-det hqm-lod-mid"
          fill={leaf.state === 'asks' ? AMBER : undefined}
        >
          {label}
        </text>
      </>
    )
  }
  const color = leaf.source ? HQ_PLUS_SOURCE_COLOR[leaf.source] : AMBER
  return (
    <>
      <circle cx={16} cy={14} r={5} fill="none" stroke={color} strokeWidth={1.8} />
      <text x={32} y={18} className="hqm-leaf">
        {trunc(leaf.title, 33)}
      </text>
      <text x={right} y={18} textAnchor="end" className="hqm-det hqm-lod-mid" fill={AMBER}>
        your move
      </text>
    </>
  )
}

/** A project's node: what waits on the owner, its name, waits and chats, and the strip of squares. */
export function HqPlusMapProjectBody({
  project,
  open,
  now
}: {
  project: HqPlusMapProject
  open: boolean
  now: number
}): React.JSX.Element {
  const nameX = project.you >= 10 ? 60 : 48
  const parts = [
    project.waits ? `${project.waits} ${project.waits === 1 ? 'wait' : 'waits'}` : '',
    project.chats ? `${project.chats} ${project.chats === 1 ? 'chat' : 'chats'}` : '',
    project.oldestWaitAt !== null && now - project.oldestWaitAt >= 7 * 86_400_000
      ? `oldest ${age(project.oldestWaitAt, now)}`
      : ''
  ].filter(Boolean)
  return (
    <>
      <rect
        className="hqm-box"
        width={W_PRJ}
        height={H_PRJ}
        rx={12}
        strokeDasharray={project.unsorted ? '4 4' : undefined}
      />
      <text x={16} y={42} className="hqm-big" fill={project.you ? AMBER : '#33505c'}>
        {project.you}
      </text>
      <text x={nameX} y={28} className="hqm-name">
        {trunc(project.slug, 24)}
      </text>
      <text x={nameX} y={45} className="hqm-sub hqm-lod-mid">
        {parts.join(' · ') || (project.you ? 'your move only' : 'quiet')}
      </text>
      {squares(project).map((kind, index) => (
        <rect
          key={index}
          x={nameX + index * 10}
          y={54}
          width={7}
          height={7}
          rx={1.5}
          fill={kind === 'you' ? AMBER : kind === 'chat' ? '#2c6b85' : 'none'}
          stroke={kind === 'wait' ? '#5d7d8a' : 'none'}
          strokeWidth={1.2}
        />
      ))}
      <text x={W_PRJ - 14} y={H_PRJ - 10} textAnchor="end" className="hqm-sub">
        {project.leaves.length ? (open ? '–' : '+') : ''}
      </text>
    </>
  )
}
