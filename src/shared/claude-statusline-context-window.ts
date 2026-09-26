// Why: the same statusLine post that carries `rate_limits` also carries the session's
// `context_window`; reading it here gives Orca a per-pane context gauge with no transcript scan.

export type ClaudeContextWindow = {
  /** 0-100 as Claude reports it; above 100 is kept so an over-limit session reads as such. */
  usedPercentage: number
  windowTokens: number
  /** Host wall clock (ms) when the statusline post arrived. */
  observedAt: number
}

export type ClaudeStatusLineContextReport = {
  paneKey: string
  contextWindow: ClaudeContextWindow
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null
}

/** `used_percentage` is null until the first response; fall back to the last request's own usage. */
function usedPercentageFrom(
  context: Record<string, unknown>,
  windowTokens: number
): number | undefined {
  const reported = finiteNonNegative(context.used_percentage)
  if (reported !== undefined) {
    return reported
  }
  const usage = readRecord(context.current_usage)
  if (!usage) {
    return undefined
  }
  const parts = [
    usage.input_tokens,
    usage.cache_creation_input_tokens,
    usage.cache_read_input_tokens
  ].map(finiteNonNegative)
  if (parts.every((part) => part === undefined)) {
    return undefined
  }
  const used = parts.reduce<number>((sum, part) => sum + (part ?? 0), 0)
  return Math.round((used / windowTokens) * 100)
}

/**
 * Reads the pane key and context window from the form-encoded statusline post.
 * Returns null when the post names no pane or carries no measurable context.
 */
export function parseClaudeStatusLineContextWindow(
  body: unknown,
  now: number
): ClaudeStatusLineContextReport | null {
  const fields = readRecord(body)
  if (!fields || typeof fields.payload !== 'string' || typeof fields.paneKey !== 'string') {
    return null
  }
  const paneKey = fields.paneKey.trim()
  if (!paneKey) {
    return null
  }
  let payload: unknown
  try {
    payload = JSON.parse(fields.payload)
  } catch {
    return null
  }
  const context = readRecord(readRecord(payload)?.context_window)
  const windowTokens = context ? finiteNonNegative(context.context_window_size) : undefined
  if (!context || !windowTokens) {
    return null
  }
  const usedPercentage = usedPercentageFrom(context, windowTokens)
  if (usedPercentage === undefined) {
    return null
  }
  return { paneKey, contextWindow: { usedPercentage, windowTokens, observedAt: now } }
}
