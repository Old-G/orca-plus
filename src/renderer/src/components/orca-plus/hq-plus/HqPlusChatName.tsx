// Custom build (hq-plus-links): a card names its chat the way the Chats list on the left does, so the
// owner sees which chat a card, a person's answer or an open question belongs to.
import type { HqChatItem } from '../hq/hq-chat-list'
import { useHqChatTitle } from '../hq/HqChatAvatar'

export type HqPlusChatRef = {
  /** The chat as the list shows it; null once its tab is closed. */
  item: HqChatItem | null
  /** The session's own name, for a chat the list no longer has. */
  name: string | null
}

function ListedName({ item }: { item: HqChatItem }): React.JSX.Element {
  const title = useHqChatTitle(item)
  return (
    <span className="hqp-chat-name" title={title}>
      {title}
    </span>
  )
}

export function HqPlusChatName({ chat }: { chat: HqPlusChatRef | null }): React.JSX.Element | null {
  if (chat?.item) {
    return <ListedName item={chat.item} />
  }
  return chat?.name ? (
    <span className="hqp-chat-name" title={chat.name}>
      {chat.name}
    </span>
  ) : null
}
