// Custom build (google-disconnect-forget)
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HQ_MAIL_KEEP_MS } from '../orca-plus/pulse/pulse-ledger-forget'

const gmail = vi.hoisted(() => ({ listeners: new Set<() => void>() }))
vi.mock('../gmail/gmail-api', () => ({
  onGmailDisconnected: (listener: () => void) => {
    gmail.listeners.add(listener)
    return () => gmail.listeners.delete(listener)
  }
}))

const { forgetHqMailIntakeSeen, registerHqMailForget } = await import('./hq-mail-forget')

const NOW = Date.parse('2026-11-25T12:00:00Z')
let hq = ''
const stateFile = () => join(hq, 'slack-scout', 'mail-state.json')

beforeEach(async () => {
  hq = await mkdtemp(join(tmpdir(), 'hq-mail-forget-'))
  await mkdir(join(hq, 'slack-scout'))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(hq, { recursive: true, force: true })
})

describe('forgetHqMailIntakeSeen', () => {
  it('drops the mailbox message ids and keeps when it last looked', async () => {
    await writeFile(stateFile(), JSON.stringify({ lastCheckAt: NOW, seen: ['m1', 'm2'] }))
    await forgetHqMailIntakeSeen(hq)
    expect(JSON.parse(await readFile(stateFile(), 'utf-8'))).toEqual({ lastCheckAt: NOW, seen: [] })
  })

  it('rewrites a damaged state without ids, and writes none where there is none', async () => {
    await forgetHqMailIntakeSeen(hq)
    await expect(readFile(stateFile())).rejects.toThrow()
    await writeFile(stateFile(), '{"seen":["m1"')
    await forgetHqMailIntakeSeen(hq)
    expect(JSON.parse(await readFile(stateFile(), 'utf-8'))).toEqual({
      lastCheckAt: null,
      seen: []
    })
  })
})

describe('registerHqMailForget', () => {
  it('forgets all mail on a disconnect and quiet mail on its timer, until stopped', async () => {
    vi.useFakeTimers({ now: NOW })
    await writeFile(stateFile(), JSON.stringify({ lastCheckAt: NOW, seen: ['m1'] }))
    const forgetLedgerMail = vi.fn((_before?: number) => ({ conversations: 2, messages: 3 }))
    const resetReader = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const stop = registerHqMailForget({
      hqPath: () => hq,
      forgetLedgerMail,
      resetReader,
      now: Date.now
    })
    try {
      for (const listener of gmail.listeners) {
        listener()
      }
      expect(resetReader).toHaveBeenCalledTimes(1)
      expect(forgetLedgerMail).toHaveBeenLastCalledWith()
      await vi.waitFor(async () =>
        expect(JSON.parse(await readFile(stateFile(), 'utf-8')).seen).toEqual([])
      )

      await vi.advanceTimersByTimeAsync(90_000)
      expect(forgetLedgerMail).toHaveBeenLastCalledWith(NOW + 90_000 - HQ_MAIL_KEEP_MS)
      await vi.advanceTimersByTimeAsync(6 * 60 * 60_000)
      expect(forgetLedgerMail).toHaveBeenCalledTimes(3)
    } finally {
      stop()
      log.mockRestore()
    }
    expect(gmail.listeners.size).toBe(0)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60_000)
    expect(forgetLedgerMail).toHaveBeenCalledTimes(3)
  })
})
