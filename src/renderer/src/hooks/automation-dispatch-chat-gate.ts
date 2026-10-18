// Custom build (automations-native-chat): when the agent opens as a chat, a fresh automation run opens
// as a native chat instead of a Claude terminal; it completes on the chat's done.
import { useAppStore } from '@/store'
import type { Automation } from '../../../shared/automations-types'
import { nativeChatPreferenceFor } from '../../../shared/structured-native-chat-launch-route'

/** Reuse and extra CLI arguments are terminal features, so those runs keep the terminal. An
 *  automation that names its surface (upstream's Chat/Terminal field) keeps it: a chat one never
 *  reaches the renderer, a terminal one stays a terminal. */
export function automationRunsInChat(
  automation: Pick<Automation, 'agentId' | 'reuseSession' | 'extraAgentArgs' | 'surface'>
): boolean {
  return (
    automation.surface === undefined &&
    nativeChatPreferenceFor(useAppStore.getState().settings, automation.agentId) &&
    !automation.reuseSession &&
    !automation.extraAgentArgs?.trim() &&
    (automation.agentId === 'claude' || automation.agentId === 'codex')
  )
}
