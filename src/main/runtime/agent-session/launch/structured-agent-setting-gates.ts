import { isAgentStatusHooksEnabledForAgent } from '../../../../shared/agent-hook-listener/configuration/agent-status-hooks-setting'
import { preModeChatGetsFullAccess } from '../../../../shared/agent-launch/permissions/agent-chat-permission-mode'
import { isTuiAgent } from '../../../../shared/agent-launch/catalog/tui-agent-config'
import type { StructuredAgentSessionRuntimeDeps } from '../installation/structured-agent-session-runtime-contract'
import type { RuntimeStore } from '../../construction/runtime-store-contract'
import { leanMcpDenyRules } from '../../../../shared/agent-lean-mcp'
import { nativeChatShowsPromptSuggestions } from '../../../../shared/native-chat/settings/native-chat-appearance-settings'

/** Per-agent chat gates read from this host's current settings. */
export function structuredAgentSettingGates(
  getSettings: () => ReturnType<RuntimeStore['getSettings']>
): Pick<
  StructuredAgentSessionRuntimeDeps,
  | 'resolveAgentFullAccess'
  | 'piManagedExtensionsEnabled'
  | 'nativeChatPromptSuggestions'
  | 'leanMcpDenied'
  | 'sharedCodexServers'
> {
  return {
    resolveAgentFullAccess: (agent) =>
      isTuiAgent(agent) && preModeChatGetsFullAccess(agent, getSettings(), process.platform),
    piManagedExtensionsEnabled: () => isAgentStatusHooksEnabledForAgent(getSettings(), 'pi'),
    nativeChatPromptSuggestions: () => nativeChatShowsPromptSuggestions(getSettings()),
    // Custom build (lean-mcp): read at each start, so the switch applies to the next chat.
    leanMcpDenied: (role) => leanMcpDenyRules(getSettings(), role),
    // Offered for this computer's chats only: a remote or WSL server runs plain Node, not Electron.
    sharedCodexServers: () =>
      process.versions.electron !== undefined &&
      getSettings().experimentalSharedCodexServers === true
  }
}
