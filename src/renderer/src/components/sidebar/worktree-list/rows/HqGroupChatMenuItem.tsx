import React from 'react'
import { MessagesSquare } from 'lucide-react'
import { toast } from 'sonner'
import { DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { activateAndRevealFolderWorkspace } from '@/lib/workspace/activation/worktree-activation'
import { submitFolderWorkspaceCreate } from '@/components/sidebar/workspace-creation/folder/folder-workspace-composer-submit'
import { useAppStore } from '@/store'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import { findHqGroupChatWorkspace } from '../../../../../../shared/hq-group-chat'
import { isTuiAgentEnabled } from '../../../../../../shared/agent-launch/catalog/tui-agent-selection'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnvWithSubscription
} from '../../../../../../shared/agent-launch/choices/tui-agent-launch-defaults'

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
    (entry) => entry.id === groupId && getRepoExecutionHostId(entry) === LOCAL_EXECUTION_HOST_ID
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
      agentArgs: agent ? resolveTuiAgentLaunchArgs(agent, settings) : undefined,
      agentEnv: agent ? resolveTuiAgentLaunchEnvWithSubscription(agent, settings) : undefined,
      terminalWindowsShell: settings?.terminalWindowsShell,
      launchSource: 'sidebar',
      // Why: the chat must open on HQ's folder, not on the group's own parent path.
      createFolderWorkspace: (input) =>
        // HQ lives on this Mac, so the chat is created locally.
        useAppStore
          .getState()
          .createFolderWorkspace(
            { ...input, folderPath: result.path },
            { runtimeEnvironmentId: null }
          ),
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
