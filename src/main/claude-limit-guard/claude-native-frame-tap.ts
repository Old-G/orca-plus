// Custom build (claude-limit-guard): lets the limit guard watch native-chat Claude frames without
// threading a dependency through the structured-session wiring.
import type { ClaudeStructuredSessionEvent } from '../claude/claude-structured-session-state'

type ClaudeNativeFrameListener = (sessionId: string, frame: Record<string, unknown>) => void

let listener: ClaudeNativeFrameListener | null = null

export function setClaudeNativeFrameListener(next: ClaudeNativeFrameListener | null): void {
  listener = next
}

export function tapClaudeNativeFrame(event: ClaudeStructuredSessionEvent): void {
  if (event.type !== 'message' || !listener) {
    return
  }
  try {
    listener(event.sessionId, event.message)
  } catch (error) {
    console.warn('[claude-limit-guard] native frame listener threw:', error)
  }
}
