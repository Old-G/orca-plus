// Custom build (hq-new-chat): «+» on a project in HQ — a new agent chat in its workspace, opened in
// HQ as soon as its tab appears, so starting one never leaves HQ.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { launchAgentInNewTab } from '@/lib/launch-agent-in-new-tab'
import { parsePaneKey } from '../../../../../shared/stable-pane-id'
import { openChatInShownHq } from './hq-chat-open'
import { agentPaneKeys, waitForNewAgentPane } from './hq-today-actions'

export async function startHqChat(worktreeId: string): Promise<void> {
  const before = agentPaneKeys(worktreeId)
  const launched = launchAgentInNewTab({
    requestId: newAgentLaunchRequestId(),
    agent: 'claude',
    worktreeId,
    launchSource: 'unknown'
  })
  if (!launched) {
    toast.error(translate('auto.hq.chats.newChatFailed', "Couldn't start a new chat here."))
    return
  }
  const paneKey = await waitForNewAgentPane(worktreeId, before)
  const tabId = paneKey ? parsePaneKey(paneKey)?.tabId : undefined
  openChatInShownHq(worktreeId, tabId)
}
