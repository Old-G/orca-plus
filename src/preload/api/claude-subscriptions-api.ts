import type { ClaudeSubscriptionStatus } from '../../shared/claude-subscriptions'

export type ClaudeSubscriptionsApi = {
  status: (args: { id: string }) => Promise<ClaudeSubscriptionStatus>
  login: (args: { id: string }) => Promise<ClaudeSubscriptionStatus>
  /** Names the subscription a native chat opens on, before its `agentSession.create`. */
  assignSession: (args: { sessionId: string; subscriptionId: string }) => Promise<void>
}
