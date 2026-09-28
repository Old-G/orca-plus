import type { ClaudeLimitStoppedAgent } from '../../shared/claude-limit-guard'

export type ClaudeLimitGuardApi = {
  list: () => Promise<ClaudeLimitStoppedAgent[]>
  onStopsChanged: (callback: (stops: ClaudeLimitStoppedAgent[]) => void) => () => void
}
