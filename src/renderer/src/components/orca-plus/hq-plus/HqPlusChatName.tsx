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

type OnOpen = (() => void) | null | undefined

function Name({ title, onOpen }: { title: string; onOpen: OnOpen }): React.JSX.Element {
  // Custom build (hq-plus-cards): a card's chat name opens the chat.
  return onOpen ? (
    <button
      type="button"
      className="hqp-chat-name"
      data-opens="true"
      title={title}
      onClick={onOpen}
    >
      {title}
    </button>
  ) : (
    <span className="hqp-chat-name" title={title}>
      {title}
    </span>
  )
}

function ListedName({ item, onOpen }: { item: HqChatItem; onOpen: OnOpen }): React.JSX.Element {
  return <Name title={useHqChatTitle(item)} onOpen={onOpen} />
}

export function HqPlusChatName({
  chat,
  onOpen
}: {
  chat: HqPlusChatRef | null
  onOpen?: OnOpen
}): React.JSX.Element | null {
  if (chat?.item) {
    return <ListedName item={chat.item} onOpen={onOpen} />
  }
  return chat?.name ? <Name title={chat.name} onOpen={onOpen} /> : null
}
