// Custom build (code-chat): the Code mode's «Chat» tab in the right sidebar — a live agent chat of
// the open workspace beside its editor, picked from the workspace's chats.
import { useMemo } from 'react'
import { AgentStateDot } from '@/components/AgentStateDot'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { rememberedHqChat } from '../hq/hq-chat-open'
import { pickHqChat, type HqChatItem } from '../hq/hq-chat-list'
import { HqChatBody } from '../hq/HqChatPane'
import { useHqChatTitle } from '../hq/HqChatAvatar'
import { useHqChatList } from '../hq/use-hq-chat-list'
import { chooseCodeChat, chosenCodeChat, useCodeChatChoices } from './code-chat-panel-state'

function Notice({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
      <p className="max-w-xs">{children}</p>
    </div>
  )
}

function ChatOption({ item }: { item: HqChatItem }): React.JSX.Element {
  const title = useHqChatTitle(item)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <AgentStateDot state={item.displayState} title={null} />
      <span className="truncate">{title}</span>
    </span>
  )
}

/** The chat a workspace opens on: the one picked here, the one HQ showed, else what needs the
 *  user or works, else the latest. */
export function pickCodeChat(
  items: readonly HqChatItem[],
  chosen: string | null,
  remembered: string | null
): string | null {
  return pickHqChat(items, [chosen, remembered]) ?? items[0]?.key ?? null
}

export default function CodeChatPanel(): React.JSX.Element {
  const worktreeId = useAppStore((state) => state.activeWorktreeId)
  const { items } = useHqChatList()
  useCodeChatChoices()
  const own = useMemo(
    () => (worktreeId ? items.filter((item) => item.worktreeId === worktreeId) : []),
    [items, worktreeId]
  )
  const key = worktreeId ? pickCodeChat(own, chosenCodeChat(worktreeId), rememberedHqChat()) : null
  const item = own.find((entry) => entry.key === key) ?? null
  // Why: a second live view of a chat the editor area already shows would fight it for input.
  const inEditor = useAppStore(
    (state) =>
      item?.kind === 'chat' &&
      (state.groupsByWorktree[item.worktreeId] ?? []).some(
        (group) => group.activeTabId === item.tab.id
      )
  )
  if (!worktreeId || !item) {
    return (
      <Notice>{translate('auto.codeChat.empty', 'No agent chats in this workspace yet.')}</Notice>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center border-b border-border px-2 py-1.5">
        <Select value={item.key} onValueChange={(next) => chooseCodeChat(worktreeId, next)}>
          <SelectTrigger
            size="sm"
            className="w-full min-w-0"
            aria-label={translate('auto.codeChat.pick', 'Agent chat')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {own.map((entry) => (
              <SelectItem key={entry.key} value={entry.key}>
                <ChatOption item={entry} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {inEditor ? (
        <Notice>
          {translate(
            'auto.codeChat.inEditor',
            'This chat is open in the editor area. Pick another one here, or switch the editor to another tab.'
          )}
        </Notice>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <HqChatBody key={item.key} item={item} />
        </div>
      )}
    </div>
  )
}
