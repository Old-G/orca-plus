// Custom build (claude-account-restart): the startup sync runs while Orca+ is still busy launching, and
// a Keychain read that times out then left the Claude CLI on the last session's login until the next
// manual switch. Only timeouts are retried: a real refusal would fail the same way again.

export const STARTUP_SYNC_RETRY_DELAYS_MS: readonly number[] = [5_000, 15_000, 45_000, 120_000]

export function isKeychainTimeout(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  const code: unknown = Reflect.get(error, 'code')
  const message: unknown = Reflect.get(error, 'message')
  return code === 'ETIMEDOUT' || (typeof message === 'string' && message.includes('timed out'))
}

export async function syncWithStartupRetry(
  sync: () => Promise<void>,
  deps: {
    delaysMs?: readonly number[]
    wait?: (ms: number) => Promise<void>
    warn?: (message: string, error: unknown) => void
  } = {}
): Promise<void> {
  const delays = deps.delaysMs ?? STARTUP_SYNC_RETRY_DELAYS_MS
  const wait = deps.wait ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const warn = deps.warn ?? ((message, error) => console.warn(message, error))
  for (let attempt = 0; ; attempt += 1) {
    try {
      await sync()
      return
    } catch (error) {
      const delay = delays[attempt]
      if (!isKeychainTimeout(error) || delay === undefined) {
        warn('[claude-runtime-auth] Failed to sync runtime auth state:', error)
        return
      }
      warn(`[claude-runtime-auth] Keychain timed out at startup; retrying in ${delay} ms:`, error)
      await wait(delay)
    }
  }
}
