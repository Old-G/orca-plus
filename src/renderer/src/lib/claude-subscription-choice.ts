import {
  BASE_CLAUDE_SUBSCRIPTION_ID,
  type ClaudeSubscriptionSettings
} from '../../../shared/claude-subscriptions'
import { CLAUDE_SUBSCRIPTIONS_ENABLED } from '../../../shared/claude-subscriptions-switch'

export type ClaudeSubscriptionChoice = { id: string; label: string }

/** The default subscription and the others a Claude launch can pick; null with none configured. */
export function listClaudeSubscriptionChoices(
  settings: ClaudeSubscriptionSettings | null | undefined,
  baseLabel: string
): { defaultChoice: ClaudeSubscriptionChoice; others: ClaudeSubscriptionChoice[] } | null {
  const subscriptions = settings?.claudeSubscriptions ?? []
  if (!CLAUDE_SUBSCRIPTIONS_ENABLED || subscriptions.length === 0) {
    return null
  }
  const all = [
    { id: BASE_CLAUDE_SUBSCRIPTION_ID, label: baseLabel },
    ...subscriptions.map(({ id, label }) => ({ id, label }))
  ]
  const defaultId = settings?.defaultClaudeSubscriptionId ?? BASE_CLAUDE_SUBSCRIPTION_ID
  const defaultChoice = all.find((choice) => choice.id === defaultId) ?? all[0]
  return { defaultChoice, others: all.filter((choice) => choice.id !== defaultChoice.id) }
}

const pendingSessionChoices = new Map<string, string>()

/** A native chat opened on a picked subscription; the host learns it just before the create. */
export function rememberClaudeSubscriptionForSession(
  sessionId: string,
  subscriptionId: string
): void {
  pendingSessionChoices.set(sessionId, subscriptionId)
}

export async function sendPendingClaudeSubscriptionChoice(sessionId: string): Promise<void> {
  const subscriptionId = pendingSessionChoices.get(sessionId)
  if (!subscriptionId) {
    return
  }
  pendingSessionChoices.delete(sessionId)
  try {
    await window.api.claudeSubscriptions.assignSession({ sessionId, subscriptionId })
  } catch (error) {
    // The chat still opens, on the default subscription.
    console.warn('[claude-subscriptions] Could not pass the subscription choice:', error)
  }
}
