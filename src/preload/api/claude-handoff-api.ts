import type {
  ClaudeHandoffLaunchResult,
  ClaudeHandoffOffer
} from '../../shared/claude-handoff-file'

export type ClaudeHandoffApi = {
  list: () => Promise<ClaudeHandoffOffer[]>
  /** Custom build (claude-handoff-launch): `keepOld` leaves the chat that wrote the handoff open. */
  launch: (id: string, keepOld?: boolean) => Promise<ClaudeHandoffLaunchResult>
  dismiss: (id: string) => Promise<void>
  onOffersChanged: (callback: (offers: ClaudeHandoffOffer[]) => void) => () => void
}
