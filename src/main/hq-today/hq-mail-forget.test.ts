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
const { collectHqMailIntake } = await import('./hq-mail-intake')

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
  it('forgets all mail on a disconnect and quiet mail at most every 6 hours, until stopped', async () => {
    await writeFile(stateFile(), JSON.stringify({ lastCheckAt: NOW, seen: ['m1'] }))
    let now = NOW
    const forgetLedgerMail = vi.fn((_before?: number) => ({ conversations: 2, messages: 3 }))
    const resetReader = vi.fn()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const forget = registerHqMailForget({
      hqPath: () => hq,
      forgetLedgerMail,
      resetReader,
      now: () => now
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

      forget.sweepQuiet()
      expect(forgetLedgerMail).toHaveBeenLastCalledWith(NOW - HQ_MAIL_KEEP_MS)
      now += 6 * 60 * 60_000 - 1
      forget.sweepQuiet()
      expect(forgetLedgerMail).toHaveBeenCalledTimes(2)
      now += 1
      forget.sweepQuiet()
      expect(forgetLedgerMail).toHaveBeenCalledTimes(3)
    } finally {
      forget.stop()
      log.mockRestore()
    }
    expect(gmail.listeners.size).toBe(0)
  })
})

describe('an intake pass in flight at a disconnect', () => {
  it('writes none of the old mailbox ids back', async () => {
    const before = { lastCheckAt: NOW - 60_000, seen: ['m1'] }
    await writeFile(stateFile(), JSON.stringify(before))
    let asked = false
    let release = (): void => {}
    const listed = new Promise<string[]>((resolve) => {
      release = () => resolve(['m2'])
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const forget = registerHqMailForget({
      hqPath: () => hq,
      forgetLedgerMail: () => ({ conversations: 0, messages: 0 }),
      resetReader: () => {},
      now: () => NOW
    })
    try {
      const pass = collectHqMailIntake(hq, {
        listMailIds: () => {
          asked = true
          return listed
        },
        getMail: async () => null,
        getTask: async () => null,
        listComments: async () => [],
        listReplies: async () => [],
        viewer: async () => ({ id: 'u1', username: 'ann' }),
        projectForList: () => null,
        mrMerged: () => {},
        now: () => NOW
      })
      await vi.waitFor(() => expect(asked).toBe(true))
      for (const listener of gmail.listeners) {
        listener()
      }
      await vi.waitFor(async () =>
        expect(JSON.parse(await readFile(stateFile(), 'utf-8')).seen).toEqual([])
      )
      release()
      await expect(pass).resolves.toBe(0)
      expect(JSON.parse(await readFile(stateFile(), 'utf-8'))).toEqual({
        lastCheckAt: NOW,
        seen: []
      })
    } finally {
      forget.stop()
      log.mockRestore()
    }
  })
})
