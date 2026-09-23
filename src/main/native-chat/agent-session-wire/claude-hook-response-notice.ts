// A Claude hook that fails (e.g. prints two JSON objects) is a warning in the CLI's
// own UI: one dim "<hook> hook error" line. The native chat used to promote it to a
// red error card holding the raw frame; this keeps the CLI's weight and wording.

const MAX_DETAIL_CHARS = 200

export type ClaudeHookResponseNotice = { text: string; tone: 'warning' }

export function claudeHookResponseNotice(
  kind: string,
  payload: unknown
): ClaudeHookResponseNotice | null {
  if (kind !== 'message:system:hook_response' || typeof payload !== 'object' || payload === null) {
    return null
  }
  const record: { outcome?: unknown; hook_name?: unknown; stderr?: unknown } = payload
  if (record.outcome !== 'error') {
    return null
  }
  const hook = typeof record.hook_name === 'string' && record.hook_name ? record.hook_name : 'Hook'
  const stderr = typeof record.stderr === 'string' ? record.stderr.trim() : ''
  const firstSentence = stderr.split(/(?<=[.!?])\s|\n/)[0]?.slice(0, MAX_DETAIL_CHARS) ?? ''
  return {
    text: firstSentence ? `${hook} hook error: ${firstSentence}` : `${hook} hook error`,
    tone: 'warning'
  }
}
