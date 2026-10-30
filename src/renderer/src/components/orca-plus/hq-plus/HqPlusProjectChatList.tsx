// Custom build (hq-plus-all-projects): one project's chats inside HQ+ — «New chat», the chats open as
// tabs and its past chats from History; a click opens the chat on the right without leaving HQ+
// (owner, 30.10: «open an existing chat of a project, not only a new one»).
import { translate } from '@/i18n/i18n'
import type { HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'
import { HqProjectHistoryList } from '../hq/HqProjectHistoryList'
import { startHqChat } from '../hq/hq-new-chat'
import { useHqProjectHistory } from '../hq/use-hq-project-history'

export type HqPlusProjectTarget = { repoId: string; name: string; worktreeId: string }

function OpenRow({
  item,
  onPick
}: {
  item: HqChatItem
  onPick: (item: HqChatItem) => void
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  return (
    <button type="button" className="hqp-qi ses" onClick={() => onPick(item)}>
      <span className="hqp-dot" />
      <span className="t">{title}</span>
      <span className="ag">{translate('auto.hqPlus.history.open', 'open')}</span>
    </button>
  )
}

export function HqPlusProjectChatList({
  target,
  open,
  color,
  onPickOpen,
  onDone
}: {
  target: HqPlusProjectTarget
  /** The project's chats open as tabs. */
  open: readonly HqChatItem[]
  color: string
  onPickOpen: (item: HqChatItem) => void
  /** After any choice — a popover closes here. */
  onDone?: () => void
}): React.JSX.Element {
  const past = useHqProjectHistory(target.worktreeId, target.repoId)
  return (
    <div className="hqp-projchats">
      <button
        type="button"
        className="hqp-pill hqp-projchats-new"
        onClick={() => {
          onDone?.()
          void startHqChat(target.worktreeId)
        }}
      >
        {translate('auto.hqPlus.side.newChatHere', '+ New chat')}
      </button>
      {open.length > 0 ? (
        <>
          <div className="hqp-newchat-h">{translate('auto.hqPlus.side.openChats', 'Open')}</div>
          {open.map((item) => (
            <OpenRow
              key={item.key}
              item={item}
              onPick={(picked) => {
                onDone?.()
                onPickOpen(picked)
              }}
            />
          ))}
        </>
      ) : null}
      <div className="hqp-newchat-h">{translate('auto.hqPlus.side.pastChats', 'History')}</div>
      {past.length > 0 ? (
        <HqProjectHistoryList
          key={target.worktreeId}
          chats={past}
          projectName={target.name}
          color={color}
          onOpened={onDone}
        />
      ) : (
        <p className="hqp-empty hqp-quiet">
          {translate('auto.hqPlus.side.noPastChats', 'no past chats')}
        </p>
      )}
    </div>
  )
}
