// Custom build (hq-closing): reads what a task's agent answered last, in full, for HQ to show.
import type { DashboardCard } from '../../../../../shared/dashboard-snapshot'
import { useAppStore } from '@/store'
import { selectNativeChatRuntimeEnvironmentId } from '../../native-chat/native-chat-runtime-owner'
import { getNativeChatSessionTransport } from '../../native-chat/native-chat-session-transport'

/** The agent's latest answer in full — the status store keeps only a one-line preview of a chat's. */
export async function readHqAgentAnswer(
  card: Pick<DashboardCard, 'paneKey' | 'tabId' | 'lastAgentMessage'>
): Promise<string | null> {
  const preview = card.lastAgentMessage?.trim() || null
  const state = useAppStore.getState()
  const entry = state.agentStatusByPaneKey[card.paneKey]
  const sessionId = entry?.providerSession?.id
  if (!entry?.agentType || !sessionId) {
    return preview
  }
  const transport = getNativeChatSessionTransport(
    selectNativeChatRuntimeEnvironmentId(state, card.tabId)
  )
  try {
    const result = await transport.readSession(entry.agentType, sessionId, 5)
    if ('error' in result) {
      return preview
    }
    const texts = result.messages
      .filter((message) => message.role === 'assistant')
      .map((message) =>
        message.blocks
          .flatMap((block) => (block.type === 'text' ? [block.text] : []))
          .join('\n\n')
          .trim()
      )
      .filter(Boolean)
    return texts.at(-1) ?? preview
  } catch {
    return preview
  }
}
