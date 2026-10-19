// Custom build (chat-auto-effort): what Settings shows about the per-message effort switch.
export type ChatAutoEffortOutcome = {
  at: number
  /** The effort the message went with: the pick, or the chat's own on a miss. */
  effort: string | null
  result: 'picked' | 'no-key' | 'no-answer' | 'no-effort-control'
  message: string
}

export type ChatAutoEffortStatus = {
  configured: boolean
  /** False when a saved key cannot be decrypted, e.g. it was saved by another build of Orca. */
  readable: boolean
  /** Newest first. */
  recent: readonly ChatAutoEffortOutcome[]
}
