import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'

export type ClaudeLimitGuardApi = {
  list: () => Promise<ClaudeLimitStoppedAgent[]>
  onStopsChanged: (callback: (stops: ClaudeLimitStoppedAgent[]) => void) => () => void
  /** Custom build (claude-subscriptions): the same chat continues on another subscription. */
  continueOnSubscription: (args: {
    sessionId: string
    subscriptionId: string
  }) => Promise<{ ok: true } | { ok: false; reason: string }>
}
