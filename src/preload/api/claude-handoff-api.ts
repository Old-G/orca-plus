import type {
  ClaudeHandoffLaunchResult,
  ClaudeHandoffOffer
} from '../../shared/claude-handoff-file'

export type ClaudeHandoffApi = {
  list: () => Promise<ClaudeHandoffOffer[]>
  launch: (id: string) => Promise<ClaudeHandoffLaunchResult>
  dismiss: (id: string) => Promise<void>
  onOffersChanged: (callback: (offers: ClaudeHandoffOffer[]) => void) => () => void
}
