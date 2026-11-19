// Custom build (hq-plus-new-chat-menu): HQ+'s «+ New chat» opens the menu Orca's «+» opens — New
// Terminal, then every agent (Claude, Codex, …, as a chat or in a terminal) and Agent settings — so a
// Codex chat starts from HQ+ too, not only Claude (owner 19.11). The chat it starts opens on HQ+'s right;
// a plain terminal is no chat HQ+ lists, so New Terminal opens it in the project in Orca.
import { useRef } from 'react'
import { TerminalSquare } from 'lucide-react'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  ProjectedAgentMenuItems,
  useTabAgentMenuLaunch
} from '@/components/agent/launch-menu/AgentMenuItems'
import { useNewTabAgentMenuRows } from '@/components/agent/launch-menu/use-new-tab-agent-menu-rows'
import { useAgentDetectionTargetForWorktree } from '@/lib/agent-session/launch/inventory/useAgentDetectionTarget'
import { createNewTerminalTab } from '@/components/terminal/tab-lifecycle/terminal-tab-create'
import { activateAndRevealWorkspaceWithOutcome } from '@/lib/workspace/activation/worktree-activation'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { parsePaneKey } from '../../../../../shared/workspace-layout/stable-pane-id'
import { openChatInShownHq } from '../hq/hq-chat-open'
import { showHqProjectIfHidden } from '../hq/hq-chat-actions'
import { getRepoIdFromWorktreeId } from '../../../../../shared/worktree/id'
import { agentPaneKeys, waitForNewAgentPane } from '../hq/hq-today-actions'

/** New Terminal: in the project in Orca, where a terminal is seen. */
export function openHqPlusNewTerminal(worktreeId: string): void {
  // Why: the workspace-aware entry refuses a folder workspace whose path is missing or offline;
  // a terminal there would start in a folder that is not there (AGENTS.md: folder workspaces).
  const outcome = activateAndRevealWorkspaceWithOutcome(worktreeId)
  if ('refused' in outcome) {
    if (!outcome.refused.failureNotified) {
      toast.error(
        translate('auto.hqPlus.newChatMenu.terminalFailed', "Couldn't open a terminal here.")
      )
    }
    return
  }
  createNewTerminalTab(worktreeId, undefined, {
    onSettled: (started) => {
      if (!started) {
        toast.error(
          translate('auto.hqPlus.newChatMenu.terminalFailed', "Couldn't open a terminal here.")
        )
      }
    }
  })
}

function HqPlusNewChatItems({
  worktreeId,
  onPicked
}: {
  worktreeId: string
  onPicked?: () => void
}): React.JSX.Element {
  const groupId = useAppStore((state) => state.activeGroupIdByWorktree[worktreeId]) ?? worktreeId
  const detectionTarget = useAgentDetectionTargetForWorktree(worktreeId)
  // Why: mounted only while the menu is open, so the agents are asked for only then.
  const model = useNewTabAgentMenuRows(worktreeId, true, detectionTarget, { wakeOnOpen: true })
  // Why: the chat is listed once its pane shows up; the panes before the launch are not it.
  const before = useRef<ReadonlySet<string>>(new Set())
  const openWhenListed = (tabId: string | null): void => {
    void waitForNewAgentPane(worktreeId, before.current).then((paneKey) => {
      openChatInShownHq(worktreeId, tabId ?? (paneKey ? parsePaneKey(paneKey)?.tabId : undefined))
    })
  }
  const launch = useTabAgentMenuLaunch({
    worktreeId,
    groupId,
    launchSource: 'unknown',
    onFocusChat: openWhenListed,
    onFocusTerminal: openWhenListed,
    onFocusHostTerminal: () => openWhenListed(null)
  })
  const runLaunch: typeof launch = (...args) => {
    before.current = agentPaneKeys(worktreeId)
    const launched = launch(...args)
    if (launched !== false) {
      showHqProjectIfHidden(getRepoIdFromWorktreeId(worktreeId))
      onPicked?.()
    }
    return launched
  }
  return (
    <>
      <DropdownMenuItem
        variant="launch"
        onSelect={() => {
          openHqPlusNewTerminal(worktreeId)
          onPicked?.()
        }}
      >
        <TerminalSquare className="size-3.5" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">
          {translate('auto.components.tab.bar.TabBar.d364f3c8d4', 'New Terminal')}
        </span>
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <ProjectedAgentMenuItems model={model} runLaunch={runLaunch} worktreeId={worktreeId} />
    </>
  )
}

export function HqPlusNewChatMenu({
  worktreeId,
  onPicked,
  align = 'start',
  children
}: {
  worktreeId: string
  /** After a terminal or an agent was started — a popover around the trigger closes here. */
  onPicked?: () => void
  align?: 'start' | 'end'
  /** The trigger: one button. */
  children: React.ReactElement
}): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        sideOffset={6}
        className="w-72 max-w-[calc(100vw-1rem)] rounded-[11px] border-border/80 p-1 shadow-[0_16px_36px_rgba(0,0,0,0.24)]"
      >
        <HqPlusNewChatItems worktreeId={worktreeId} onPicked={onPicked} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
