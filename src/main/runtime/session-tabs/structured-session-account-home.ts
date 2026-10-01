import type { StructuredAgentId } from '../../../shared/agent-session-provider-handle'
import { structuredAgentRuntimeMetadata } from '../structured-agent-runtime-metadata'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { OrcaRuntimeWithStructuredSessionCliWriterHost } from './structured-session-cli-writer-host'
import { resolveClaudeSubscriptionLaunchConfigDir } from '../../claude-subscriptions/claude-subscription-launch'
import { getAssignedClaudeSubscription } from '../../claude-subscriptions/claude-subscription-session-assignments'

export abstract class OrcaRuntimeWithStructuredSessionAccountHome extends OrcaRuntimeWithStructuredSessionCliWriterHost {
  /** Where a launch of `agent` finds its account, resolved on this host by the agent's own
   *  registration; null for an agent this runtime does not register, whose create is refused. */
  protected structuredAgentAccountHomeResolver(
    agent: StructuredAgentId,
    worktree: string,
    purpose: 'launch' | 'read',
    hostLaunchDirectory?: string,
    sessionId?: string
  ) {
    const registration = structuredAgentRuntimeMetadata(agent)
    if (!registration) {
      return null
    }
    return async ({ launchEnv, location }) =>
      registration.resolveAccountHome(
        {
          launchEnv,
          location: location ?? null,
          purpose,
          workspacePath:
            purpose === 'launch'
              ? async () =>
                  hostLaunchDirectory ??
                  (await this.resolveRuntimeFileTarget(worktree)).worktree.path
              : null
        },
        {
          getClaudeConfigDirectory: (target) => this.accounts.getClaudeConfigDirectory(target),
          prepareCodexLaunchHome: this.prepareCodexStructuredLaunchFn,
          readCodexLaunchHome: this.resolveCodexStructuredLaunchHomeFn,
          workspaceTrustSettings: () => this.requireStore().getSettings(),
          // The chat host's own state root (ensureStructuredAgentSessionHost).
          stateDirectory: getProfileUserDataPath(),
          claudeSubscriptionConfigDir: ({ launchEnv, wslDistro, purpose: homePurpose }) =>
            resolveClaudeSubscriptionLaunchConfigDir({
              settings: this.requireStore().getSettings(),
              env: launchEnv,
              runtime: wslDistro ? 'wsl' : 'host',
              // A read names the default subscription's dir without touching it.
              ...(homePurpose === 'read'
                ? { prepareHome: () => {} }
                : sessionId
                  ? { subscriptionId: getAssignedClaudeSubscription(sessionId) }
                  : {})
            })
        }
      )
  }
}
