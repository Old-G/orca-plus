// Custom build (chat-auto-effort): what Settings shows about the per-message effort switch.
export type ChatAutoEffortOutcome = {
  at: number
  /** The effort the message went with: the pick, or the chat's own on a miss. */
  effort: string | null
  // Custom build (chat-auto-effort-roles): 'role' — the chat's role fixed it; 'relayed' — another
  // chat or a lead sent it, the chat kept its effort.
  result: 'picked' | 'no-answer' | 'no-effort-control' | 'role' | 'relayed'
  message: string
}

export type ChatAutoEffortStatus = {
  /** Newest first. */
  recent: readonly ChatAutoEffortOutcome[]
}
