// Custom build (claude-subscriptions): what a new-tab launch carries for the Claude subscription it runs on.
import { withClaudeSubscriptionLaunchEnv } from '../../../shared/claude-subscriptions'
import type { GlobalSettings } from '../../../shared/global-settings-types'
import type { TuiAgent } from '../../../shared/tui-agent'

export type LaunchArgs = {
  /** Claude only: the subscription (its own sign-in) this session runs on; absent = the default. */
  claudeSubscriptionId?: string
}

/** The launch's plan inputs with the picked subscription in their env (absent = the default). */
export function withPickedSubscription<Inputs extends { agent: TuiAgent; agentEnv: Record<string, string> }>(
  inputs: Inputs,
  settings: GlobalSettings | null | undefined,
  subscriptionId: string | undefined
): Inputs {
  return {
    ...inputs,
    agentEnv: withClaudeSubscriptionLaunchEnv(inputs.agent, inputs.agentEnv, settings, subscriptionId)
  }
}

export function structuredArgs(
  agent: TuiAgent,
  subscriptionId: string | undefined
): { claudeSubscriptionId?: string } {
  return agent === 'claude' && subscriptionId ? { claudeSubscriptionId: subscriptionId } : {}
}
