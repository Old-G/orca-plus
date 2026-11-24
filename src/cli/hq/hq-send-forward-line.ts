// Custom build (hq-lead-reassign, hq-handoff-parked): what `orca chat send` says when the message went
// to another chat than the one named — the chat's Lead now, or the chat that continues a handed-off one.
import type { HqChatSendResult } from '../../shared/hq-journal'

export function hqSendForwardLine(result: HqChatSendResult): string {
  if (!result.forwardedFrom) {
    return ''
  }
  return result.handedOff
    ? `${result.forwardedFrom} handed off; the message went to the chat that continues it, ${result.sessionId}. `
    : `${result.forwardedFrom} is not this chat's Lead any more; the message went to its Lead now, ${result.entry.address}. `
}
