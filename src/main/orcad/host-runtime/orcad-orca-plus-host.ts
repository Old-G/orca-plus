// Custom build (hq-chat-roles, claude-background-pause): a headless orcad owns its chats and schedules,
// so a remote `agent.launch --role` gets ORCA_CHAT_ROLE here and the schedules ask this host's gate.
// The desktop does the same in its own startup; this host never runs that path.
import type { Store } from '../../persistence/loading-store/store'
import type { RateLimitService } from '../../rate-limits/service/rate-limit-service'
import { bindChatRoleLookupToRuntime } from '../../orca-plus/chat-roles/chat-role-env'
import { getAppEnvironment } from '../../../shared/app-lifecycle/app-environment'
import { installClaudeBackgroundGate } from '../../claude-limit-guard/claude-background-gate-host'

export function installOrcadOrcaPlusHost(
  runtime: Parameters<typeof bindChatRoleLookupToRuntime>[0],
  store: Pick<Store, 'getSettings'>,
  /** Null on a WSL host, whose accounts and readings stay with the desktop. */
  rateLimits: RateLimitService | null,
  registerCleanup: (cleanup: () => void) => void
): void {
  bindChatRoleLookupToRuntime(runtime)
  if (!rateLimits) {
    return
  }
  const environment = getAppEnvironment()
  const gate = installClaudeBackgroundGate({
    store,
    rateLimits,
    userDataPath: environment.getPath('userData'),
    isPackaged: environment.isPackaged()
  })
  registerCleanup(() => gate.stop())
}
