import type {
  ClaudeHandoffLaunchResult,
  ClaudeHandoffOffer
} from '../../shared/claude-handoff-file'

export type ClaudeHandoffApi = {
  list: () => Promise<ClaudeHandoffOffer[]>
  /** Custom build (claude-handoff-launch): `keepOld` leaves the chat that wrote the handoff open. */
  launch: (id: string, keepOld?: boolean) => Promise<ClaudeHandoffLaunchResult>
  dismiss: (id: string) => Promise<void>
  /**
   * Custom build (chat-continue-new): starts a chat that continues the native chat `tabId` with `prompt`,
   * on its model, effort, role and thread, and closes the old one.
   */
  continueChat: (
    worktreeId: string,
    tabId: string,
    prompt: string
  ) => Promise<ClaudeHandoffLaunchResult>
  onOffersChanged: (callback: (offers: ClaudeHandoffOffer[]) => void) => () => void
  /** Custom build (claude-handoff-launch): main asks the window to close a handed-off chat's tab. */
  onCloseChat: (callback: (tabId: string) => void) => () => void
}
