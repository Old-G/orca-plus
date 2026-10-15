// Custom build (hq-chats): the open chat in HQ — its header (project, branch, state, «Open
// project») over the live chat: a native chat with its composer, or a terminal agent's live
// terminal. It is the same conversation the workspace tab shows; sends and drafts are shared.
import { memo, useMemo } from 'react'
import { ArrowLeft, SquareArrowOutUpRight } from 'lucide-react'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent } from '@/lib/agent-status'
import {
  structuredAgentSessionOwnerForTab,
  structuredAgentSessionTargetForHost
} from '@/runtime/structured-agent-session-owner'
import { useAppStore } from '@/store'
import type { Tab } from '../../../../../shared/tab-types'
import type { AgentType } from '../../../../../shared/agent-status-types'
import NativeChatView from '../../native-chat/NativeChatView'
import { AgentTerminalPreview } from '../../dashboard-popout/AgentTerminalPreview'
import { terminalPreviewUnavailableMessage } from '../../dashboard-popout/terminal-preview-unavailable-message'
import type { HqChatItem } from './hq-chat-list'
import { HqChatAvatar, useHqChatTitle } from './HqChatAvatar'
import { HqAgentMapButton } from './HqAgentMap'

function Notice({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-xs text-muted-foreground">
      <p className="max-w-sm">{children}</p>
    </div>
  )
}

/** The live native chat, read from the host recorded on its tab. No group: HQ is not a split
 *  group, so the chat's pane commands must not act on the workspace's tabs. */
const HqNativeChat = memo(function HqNativeChat({
  tab,
  agent
}: {
  tab: Tab
  agent: AgentType
}): React.JSX.Element {
  const owner = useAppStore((state) => structuredAgentSessionOwnerForTab(state, tab))
  const target = useMemo(() => structuredAgentSessionTargetForHost(owner), [owner])
  if (!target) {
    return (
      <Notice>
        {translate(
          'auto.hq.chats.noHost',
          'This chat runs on a host HQ cannot reach from here. Open its project to see it.'
        )}
      </Notice>
    )
  }
  return (
    <NativeChatView
      mode="structured"
      tabId={tab.id}
      sessionId={tab.entityId}
      agent={agent}
      isVisible
      isFocusedGroup
      target={target}
    />
  )
})

/** The live chat itself, also shown by the Code mode's Chat tab. */
export function HqChatBody({ item }: { item: HqChatItem }): React.JSX.Element {
  if (item.kind === 'chat') {
    return <HqNativeChat tab={item.tab} agent={item.agentType} />
  }
  const { card } = item
  if (!card.ptyId) {
    return <Notice>{terminalPreviewUnavailableMessage({ hostKind: card.hostKind })}</Notice>
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col p-2">
      <AgentTerminalPreview
        ptyId={card.ptyId}
        terminalInput={card.terminalInput ?? null}
        className="h-auto min-h-0 flex-1"
      />
    </div>
  )
}

export function HqChatPane({
  item,
  color,
  onOpenProject,
  onBack
}: {
  item: HqChatItem
  color: string | undefined
  onOpenProject: (item: HqChatItem) => void
  /** Back to the list where the screen is too narrow to show both. */
  onBack: () => void
}): React.JSX.Element {
  const title = useHqChatTitle(item)
  const stateLabel =
    item.group === 'quiet' && item.card === null
      ? translate('auto.hq.chats.state.new', 'No turns yet')
      : agentStateLabel(item.displayState)
  return (
    <section aria-label={title} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-center gap-2.5 border-b border-border px-3 py-2.5">
        {/* Why: on the Button itself its own display rule outranks the container query. */}
        <span className="@min-3xl/hq:hidden">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label={translate('auto.hq.chats.back', 'Back to chats')}
          >
            <ArrowLeft />
          </Button>
        </span>
        <HqChatAvatar item={item} color={color} />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {/* Why first: from HQ the project is the first thing to know about an opened chat. */}
          <div className="flex min-w-0 items-center gap-1.5 text-xs">
            <span
              aria-hidden
              className="size-2 shrink-0 rounded-full bg-muted-foreground"
              style={color ? { backgroundColor: color } : undefined}
            />
            <span className="truncate font-semibold">{item.projectName}</span>
            <span aria-hidden className="text-muted-foreground">
              ›
            </span>
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {item.worktreeName}
            </span>
          </div>
          <h2 className="truncate text-sm leading-tight font-semibold">{title}</h2>
          <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="inline-flex shrink-0">
              <AgentIcon agent={agentTypeToIconAgent(item.agentType)} size={12} />
            </span>
            <AgentStateDot state={item.displayState} title={null} />
            <span className="shrink-0">{stateLabel}</span>
          </div>
        </div>
        <HqAgentMapButton item={item} />
        <Button type="button" variant="outline" size="xs" onClick={() => onOpenProject(item)}>
          <SquareArrowOutUpRight className="size-3" />
          {translate('auto.hq.chats.openProject', 'Open project')}
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col">
        <HqChatBody key={item.key} item={item} />
      </div>
    </section>
  )
}
