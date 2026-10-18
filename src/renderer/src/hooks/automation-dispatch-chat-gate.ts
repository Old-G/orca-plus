// Custom build (automations-native-chat): with the Chat UI switch on, a fresh automation run opens
// as a native chat instead of a Claude terminal; it completes on the chat's done.
import { useAppStore } from '@/store'
import type { Automation } from '../../../shared/automations-types'
import { isNativeChatEnabled } from '../../../shared/structured-native-chat-launch-route'

/** Reuse and extra CLI arguments are terminal features, so those runs keep the terminal. */
export function automationRunsInChat(
  automation: Pick<Automation, 'agentId' | 'reuseSession' | 'extraAgentArgs'>
): boolean {
  return (
    isNativeChatEnabled(useAppStore.getState().settings) &&
    !automation.reuseSession &&
    !automation.extraAgentArgs?.trim() &&
    (automation.agentId === 'claude' || automation.agentId === 'codex')
  )
}
