// Custom build (hq-plus-ui-v2): «Session» with a chat open — the live chat and its composer under a short
// header; «History» swaps the chat for every chat of its project, open ones first, and a click opens it.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import type { HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'
import { HqChatBody } from '../hq/HqChatPane'
import { HqProjectHistoryList } from '../hq/HqProjectHistoryList'
import { useHqProjectHistory } from '../hq/use-hq-project-history'
import type { HqPlusTile } from './HqPlusSide'
import type { HqPlusBadge } from '../../../../../shared/hq-plus-kinds'
import { HqPlusBadges } from './HqPlusBadge'
import { HqPlusProject } from './HqPlusProject'

function tileStyle(
  color: string | null
): (React.CSSProperties & Record<'--hqp-room', string>) | undefined {
  return color ? { '--hqp-room': color } : undefined
}

function OpenChatRow({
  item,
  current,
  onPick
}: {
  item: HqChatItem
  current: boolean
  onPick: (item: HqChatItem) => void
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  return (
    <button
      type="button"
      className="hqp-qi ses"
      aria-current={current ? 'true' : undefined}
      onClick={() => onPick(item)}
    >
      <span className="hqp-dot" />
      <span className="t">{title}</span>
      <span className="ag">{translate('auto.hqPlus.history.open', 'open')}</span>
    </button>
  )
}

function History({
  item,
  siblings,
  color,
  onPick
}: {
  item: HqChatItem
  siblings: readonly HqChatItem[]
  color: string | undefined
  onPick: (item: HqChatItem) => void
}): React.JSX.Element {
  const past = useHqProjectHistory(item.worktreeId, item.repoId)
  return (
    <div className="hqp-hist">
      <div className="hqp-hist-h">
        {translate('auto.hqPlus.history.title', 'all chats · {{project}}', {
          project: item.projectName
        })}
      </div>
      {siblings.map((chat) => (
        <OpenChatRow key={chat.key} item={chat} current={chat.key === item.key} onPick={onPick} />
      ))}
      {past.length > 0 ? (
        <HqProjectHistoryList
          key={item.worktreeId}
          chats={past}
          projectName={item.projectName}
          color={color ?? 'var(--hqp-faint)'}
        />
      ) : null}
    </div>
  )
}

export function HqPlusChatSession({
  item,
  tile,
  status,
  color,
  siblings,
  onPick
}: {
  item: HqChatItem
  tile: HqPlusTile
  status: HqPlusBadge | null
  color: string | undefined
  /** The project's chats open as tabs, this one included. */
  siblings: readonly HqChatItem[]
  onPick: (item: HqChatItem) => void
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  const [history, setHistory] = useState(false)
  // Custom build (hq-plus-ui-v3): «Project» stays in HQ+ — files, source control, checks here.
  const [project, setProject] = useState(false)
  if (project) {
    return <HqPlusProject item={item} onBack={() => setProject(false)} />
  }
  return (
    <div className="hqp-chat flex h-full min-h-0 flex-col">
      <div className="hqp-ses-h">
        <span className="hqp-tile" style={tileStyle(tile.color)} aria-hidden="true">
          {tile.letters}
        </span>
        <span className="t" title={title}>
          {title}
        </span>
        {status ? <HqPlusBadges badges={[status]} /> : null}
        <button
          type="button"
          className="hqp-pill"
          aria-pressed={history}
          onClick={() => setHistory(!history)}
        >
          {translate('auto.hqPlus.history', 'History')}
        </button>
        <button type="button" className="hqp-pill" onClick={() => setProject(true)}>
          {translate('auto.hqPlus.openProject', 'Project')}
        </button>
      </div>
      {history ? (
        <History
          item={item}
          siblings={siblings}
          color={color}
          onPick={(picked) => {
            setHistory(false)
            onPick(picked)
          }}
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <HqChatBody key={item.key} item={item} />
        </div>
      )}
    </div>
  )
}
