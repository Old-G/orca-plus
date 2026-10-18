// Custom build (automations-native-chat): opens a fresh automation run as a native chat in its
// workspace instead of a Claude terminal; the gate is automation-dispatch-chat-gate.ts.
import { agentPaneKeys, waitForNewAgentPane } from '@/components/orca-plus/hq/hq-today-actions'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { useAppStore } from '@/store'
import type { Automation } from '../../../shared/automations-types'
import { parsePaneKey } from '../../../shared/stable-pane-id'

/** Opens the run's chat with its prompt and resolves the chat's tab and pane. */
export async function launchAutomationChat(args: {
  automation: Pick<Automation, 'agentId' | 'prompt'>
  worktreeId: string
  title: string
}): Promise<{ tabId: string; paneKey: string }> {
  const before = agentPaneKeys(args.worktreeId)
  const launched = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent: args.automation.agentId,
    worktreeId: args.worktreeId,
    prompt: args.automation.prompt,
    promptDelivery: 'submit-after-ready',
    launchSource: 'unknown',
    activate: false
  })
  if (!launched) {
    throw new Error('Unable to build an agent launch plan.')
  }
  const paneKey = await waitForNewAgentPane(args.worktreeId, before)
  const tabId = paneKey ? parsePaneKey(paneKey)?.tabId : undefined
  if (!paneKey || !tabId) {
    throw new Error('The chat for this run did not open.')
  }
  // Why: otherwise the chat is named after the prompt's first line.
  useAppStore.getState().setTabCustomLabel(tabId, args.title, { recordInteraction: false })
  return { tabId, paneKey }
}
