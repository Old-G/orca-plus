// Custom build (claude-subscriptions): what a new-tab launch carries for the Claude subscription it runs on.
import { withClaudeSubscriptionLaunchEnv } from '../../../shared/claude-subscriptions'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import { resolveTuiAgentLaunchEnv } from '../../../shared/tui-agent-launch-defaults'
import type { TuiAgent } from '../../../shared/tui-agent'

export type LaunchArgs = {
  /** Claude only: the subscription (its own sign-in) this session runs on; absent = the default. */
  claudeSubscriptionId?: string
}

export function agentEnv(
  agent: TuiAgent,
  settings: GlobalSettings | null | undefined,
  subscriptionId: string | undefined
): Record<string, string> {
  const env = resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv)
  return withClaudeSubscriptionLaunchEnv(agent, env, settings, subscriptionId)
}

export function structuredArgs(
  agent: TuiAgent,
  subscriptionId: string | undefined
): { claudeSubscriptionId?: string } {
  return agent === 'claude' && subscriptionId ? { claudeSubscriptionId: subscriptionId } : {}
}
