import { describe, expect, it, vi } from 'vitest'
import { syncWithStartupRetry } from './runtime-auth-startup-retry'

const timeout = (): Error =>
  Object.assign(new Error('security timed out after 3000ms'), { code: 'ETIMEDOUT' })

function run(results: (Error | null)[]) {
  const sync = vi.fn(async () => {
    const next = results.shift()
    if (next) {
      throw next
    }
  })
  const wait = vi.fn(async () => {})
  const warn = vi.fn()
  return { sync, wait, warn, done: syncWithStartupRetry(sync, { delaysMs: [5, 15], wait, warn }) }
}

describe('the startup Claude auth sync', () => {
  it('retries a Keychain timeout until the selection lands', async () => {
    const { sync, wait, done } = run([timeout(), timeout(), null])
    await done
    expect(sync).toHaveBeenCalledTimes(3)
    expect(wait.mock.calls).toEqual([[5], [15]])
  })

  it('gives up after the last delay and reports it once as a failure', async () => {
    const { sync, warn, done } = run([timeout(), timeout(), timeout(), null])
    await done
    expect(sync).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls.at(-1)?.[0]).toBe(
      '[claude-runtime-auth] Failed to sync runtime auth state:'
    )
  })

  it('does not retry a refusal that is not a timeout', async () => {
    const { sync, wait, done } = run([new Error('User canceled'), null])
    await done
    expect(sync).toHaveBeenCalledTimes(1)
    expect(wait).not.toHaveBeenCalled()
  })
})
