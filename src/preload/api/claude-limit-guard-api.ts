import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'

export type ClaudeLimitGuardApi = {
  list: () => Promise<ClaudeLimitStoppedAgent[]>
  onStopsChanged: (callback: (stops: ClaudeLimitStoppedAgent[]) => void) => () => void
  /** Nudges the agents stopped on a rejected sign-in, after re-applying the selected account. */
  continueAuthStops: () => Promise<{ resumed: number }>
  /** Custom build (claude-subscriptions): the same chat continues on another subscription. */
  continueOnSubscription: (args: {
    sessionId: string
    subscriptionId: string
  }) => Promise<{ ok: true } | { ok: false; reason: string }>
}
