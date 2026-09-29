import {
  type AiVaultSessionTitle,
  isAiVaultTitleAgent
} from '../../../../../../shared/ai-vault/contracts/ai-vault-session-title'
import type { AppState } from '@/store/types'
import {
  type AgentPaneConversation,
  collectAgentPaneConversations
} from '../../identity/pane-agent-conversations'

export type AiVaultTitleRequest = AgentPaneConversation<AiVaultSessionTitle['agent']>

export function collectAiVaultTitleRequests(state: AppState): AiVaultTitleRequest[] {
  // Custom build (native-chat-titles): native-chat tabs carry a conversation title too.
  return collectAgentPaneConversations(state, isAiVaultTitleAgent, {
    skipHostNamedTabs: true,
    includeChatTabs: true
  })
}
