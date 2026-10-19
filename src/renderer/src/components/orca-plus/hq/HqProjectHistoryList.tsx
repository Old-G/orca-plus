// Custom build (hq-project-history): «History» in the panel beside an HQ chat — the workspace's past
// chats in the «Other chats here» row format; a click reopens one in HQ with its conversation.
import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { structuredAgentSessionTabId } from '../../../../../shared/structured-agent-session-projection'
import { useAiVaultSessionDisplayTitle } from '../../right-sidebar/use-ai-vault-session-display-title'
import { openHqHistoryEntry } from './hq-history-open'
import { HqChatAvatar } from './HqChatAvatar'
import type { HqHistoryChat } from './use-hq-project-history'

const SHOWN_FIRST = 8

function HistoryChat({
  chat,
  projectName,
  color
}: {
  chat: HqHistoryChat
  projectName: string
  color: string
}): React.JSX.Element {
  const title = useAiVaultSessionDisplayTitle(chat)
  const { workspaceId, sessionId } = chat.structuredSession
  return (
    <li>
      <button
        type="button"
        onClick={() =>
          void openHqHistoryEntry({
            worktreeId: workspaceId,
            tabId: structuredAgentSessionTabId(sessionId),
            sessionId
          })
        }
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <HqChatAvatar item={{ projectName }} color={color} />
        <span className="min-w-0 flex-1 truncate">{title}</span>
      </button>
    </li>
  )
}

/** Keyed by workspace, so a list shown in full folds again for the next one. */
export function HqProjectHistoryList({
  chats,
  projectName,
  color
}: {
  chats: readonly HqHistoryChat[]
  projectName: string
  color: string
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const shown = expanded ? chats : chats.slice(0, SHOWN_FIRST)
  return (
    <ul className="flex flex-col gap-px">
      {shown.map((chat) => (
        <HistoryChat key={chat.id} chat={chat} projectName={projectName} color={color} />
      ))}
      {chats.length > shown.length ? (
        <li>
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            {translate('auto.hq.context.moreHistory', 'Show {{count}} more', {
              count: chats.length - shown.length
            })}
          </button>
        </li>
      ) : null}
    </ul>
  )
}
