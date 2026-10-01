import React from 'react'
import { MessagesSquare } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { activateAndRevealFolderWorkspace } from '@/lib/worktree-activation'
import { resolveInitialNativeChatSessionOptions } from '@/components/native-chat/native-chat-launch-session-options'
import { isNativeChatTranscriptLocalReadable } from '@/lib/native-chat-transcript-readability'
import { submitFolderWorkspaceCreate } from '@/components/sidebar/folder-workspace-composer-submit'
import { useAppStore } from '@/store'
import { getProjectGroupHostId } from '@/store/slices/project-group-owner-routing'
import {
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import { findHqGroupChatWorkspace } from '../../../../../../shared/hq-group-chat'
import { isTuiAgentEnabled } from '../../../../../../shared/tui-agent-selection'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../../../../shared/tui-agent-launch-defaults'

function showFailure(description: string): void {
  toast.error(translate('auto.hqGroupChat.failed', 'Could not open the group chat'), {
    description
  })
}

async function openHqGroupChat(groupId: string): Promise<void> {
  const result = await window.api.hqGroupChat.prepare(groupId)
  if (!result.ok) {
    showFailure(result.error)
    return
  }
  const state = useAppStore.getState()
  const existing = findHqGroupChatWorkspace(state.folderWorkspaces, groupId, result.path)
  if (existing) {
    activateAndRevealFolderWorkspace(existing.id)
    return
  }
  const group = state.projectGroups.find(
    (entry) => entry.id === groupId && getProjectGroupHostId(entry) === LOCAL_EXECUTION_HOST_ID
  )
  if (!group) {
    return
  }
  const { settings } = state
  const agent = isTuiAgentEnabled('claude', settings?.disabledTuiAgents ?? []) ? 'claude' : null
  try {
    await submitFolderWorkspaceCreate({
      projectGroup: group,
      name: translate('auto.hqGroupChat.workspaceName', 'Group chat'),
      lastAutoName: '',
      linkedWorkItem: null,
      note: '',
      quickAgent: agent,
      autoRenameBranchFromWork: false,
      agentCmdOverrides: settings?.agentCmdOverrides,
      agentArgs: agent ? resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs) : undefined,
      agentEnv: agent
        ? resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv, settings)
        : undefined,
      sessionOptions: agent
        ? resolveInitialNativeChatSessionOptions(
            {
              experimentalNativeChat: settings?.experimentalNativeChat,
              openAgentTabsInChatByDefault: settings?.openAgentTabsInChatByDefault,
              nativeChatSessionOptions: settings?.nativeChatSessionOptions
            },
            {
              agent,
              nativeChatTranscriptIsLocalReadable: isNativeChatTranscriptLocalReadable(null)
            }
          )
        : undefined,
      terminalWindowsShell: settings?.terminalWindowsShell,
      launchSource: 'sidebar',
      // Why: the chat must open on HQ's folder, not on the group's own parent path.
      createFolderWorkspace: (input) =>
        useAppStore.getState().createFolderWorkspace({ ...input, folderPath: result.path }),
      onOpenChange: () => {}
    })
  } catch (error) {
    showFailure(error instanceof Error ? error.message : String(error))
  }
}

/**
 * Custom build (hq-group-chat): opens the group's chat — a folder workspace on HQ's
 * chats/<group>/, where Claude sees every project of the group. A second click reopens it.
 */
export function HqGroupChatMenuItem({
  groupId,
  hostId
}: {
  groupId: string
  hostId?: ExecutionHostId
}): React.JSX.Element | null {
  const hqConfigured = useAppStore((s) => Boolean(s.settings?.hqPath?.trim()))
  if (!hqConfigured || (hostId !== undefined && hostId !== LOCAL_EXECUTION_HOST_ID)) {
    return null
  }
  return (
    <DropdownMenuItem onSelect={() => void openHqGroupChat(groupId)}>
      <MessagesSquare className="size-3.5" />
      {translate('auto.hqGroupChat.menu', 'Group chat')}
    </DropdownMenuItem>
  )
}
