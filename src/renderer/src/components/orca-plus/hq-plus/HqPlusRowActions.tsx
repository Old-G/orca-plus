// Custom build (T5e): the board row's hover buttons.
import { translate } from '@/i18n/i18n'
import type { HqChatItem } from '../hq/hq-chat-list'
import { HqPlusCloseChat } from './HqPlusCloseChat'
import { HqPlusNewChatMenu } from './HqPlusNewChatMenu'
import type { HqPlusWorkActions } from './HqPlusWork'

/** T5e (board): «+» starts a chat in the row's project, «×» closes the row's chat. */
export function HqPlusRowActions({
  item,
  title,
  actions
}: {
  item: HqChatItem
  title: string
  actions: Pick<HqPlusWorkActions, 'closerOf' | 'newChatWorktreeOf' | 'slugOf'>
}): React.JSX.Element | null {
  const closer = actions.closerOf?.(item) ?? null
  const worktreeId = actions.newChatWorktreeOf?.(item) ?? null
  if (!closer && !worktreeId) {
    return null
  }
  return (
    <span className="hqw-acts">
      {worktreeId ? (
        <HqPlusNewChatMenu worktreeId={worktreeId} align="end">
          <button
            type="button"
            className="hqp-x hqw-plus"
            aria-label={translate('auto.hqPlus.board.newChatIn', 'New chat in {{project}}', {
              project: actions.slugOf(item)
            })}
            title={translate('auto.hqPlus.board.newChatIn', 'New chat in {{project}}', {
              project: actions.slugOf(item)
            })}
          >
            +
          </button>
        </HqPlusNewChatMenu>
      ) : null}
      {closer ? <HqPlusCloseChat closer={closer} name={title} /> : null}
    </span>
  )
}
