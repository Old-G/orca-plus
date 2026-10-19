// Custom build (hq-chats): a chat's project mark — the project's color with its initials — and the
// chat's shown name, shared by the list row and the open chat's header.
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { formatAgentTypeLabel } from '@/lib/agent-status'
import { useStructuredChatTabConversationName } from '@/runtime/structured-conversation-name'
import { useAppStore } from '@/store'
import { resolveAgentSessionTabTitle } from '../../tab-bar/tab-bar-item-model'
import { hqProjectInitials, type HqChatItem } from './hq-chat-list'

export function HqChatAvatar({
  item,
  color
}: {
  item: Pick<HqChatItem, 'projectName'>
  color: string | undefined
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          aria-label={item.projectName}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted-foreground text-[10.5px] font-bold text-background"
          style={color ? { backgroundColor: color } : undefined}
        >
          {hqProjectInitials(item.projectName)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {item.projectName}
      </TooltipContent>
    </Tooltip>
  )
}

/** The chat's name: a native chat's exactly as its workspace tab shows it, so «Open project» lands
 *  on the name the list showed; a terminal agent's from the board, else the agent. */
export function useHqChatTitle(item: HqChatItem): string {
  const conversationName = useStructuredChatTabConversationName(
    item.kind === 'chat' ? item.tab : undefined
  )
  const generatedTitlesEnabled = useAppStore((s) => s.settings?.tabAutoGenerateTitle === true)
  if (item.kind === 'chat') {
    return resolveAgentSessionTabTitle(item.tab, conversationName, generatedTitlesEnabled)
  }
  return item.card.conversationName ?? formatAgentTypeLabel(item.agentType)
}
