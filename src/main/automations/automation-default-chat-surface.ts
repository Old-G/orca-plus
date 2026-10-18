// Custom build (automations-native-chat): when the agent opens as a chat, an automation that does not
// name its surface runs as a native chat (upstream's chat launcher) instead of a terminal.
import type { Automation } from '../../shared/automations/automation-definition'
import {
  nativeChatPreferenceFor,
  type NativeChatDefaultSettings
} from '../../shared/structured-native-chat-launch-route'

type SurfaceFields = Pick<Automation, 'agentId' | 'reuseSession' | 'extraAgentArgs' | 'surface'>

/** Reuse and extra CLI arguments are terminal features, so those runs keep the terminal. An
 *  automation that names its surface (the Chat/Terminal field) keeps it. */
export function automationDispatchSurface(
  automation: SurfaceFields,
  settings: NativeChatDefaultSettings | null | undefined
): Automation['surface'] {
  if (automation.surface !== undefined) {
    return automation.surface
  }
  return nativeChatPreferenceFor(settings, automation.agentId) &&
    !automation.reuseSession &&
    !automation.extraAgentArgs?.trim() &&
    (automation.agentId === 'claude' || automation.agentId === 'codex')
    ? 'chat'
    : undefined
}

/** The automation as it dispatches: the stored definition stays untouched, so change checks still match. */
export function withAutomationDispatchSurface<T extends SurfaceFields>(
  automation: T,
  store: { getSettings?: () => NativeChatDefaultSettings | null | undefined }
): T {
  const surface = automationDispatchSurface(automation, store.getSettings?.())
  return surface === automation.surface ? automation : { ...automation, surface }
}
