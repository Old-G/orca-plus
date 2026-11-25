import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  forgetGoogleAccount,
  forgetGoogleTriggerAccount,
  onGoogleAccountRemoved
} from './google-account-forget'
import { cachedFileText } from './google-drive-text-cache'
import type { GoogleTriggerState } from './google-trigger-state'

const state = (): GoogleTriggerState => ({
  accounts: {
    'ann@acme.example': { historyId: '41', calendars: { primary: { syncToken: 'ann-token' } } },
    'bob@acme.example': { historyId: '7' }
  },
  listeners: {
    'bot-1 ann@acme.example': 1_000,
    'bot-2 Ann@Acme.example': 2_000,
    'bot-1 bob@acme.example': 3_000,
    'bot-3 joann@acme.example': 4_000
  }
})

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'google-account-forget-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('forgetGoogleTriggerAccount', () => {
  it('drops only that account, whatever its case, and keeps a longer address ending in it', () => {
    expect(forgetGoogleTriggerAccount(state(), 'ANN@acme.example')).toEqual({
      accounts: { 'bob@acme.example': { historyId: '7' } },
      listeners: { 'bot-1 bob@acme.example': 3_000, 'bot-3 joann@acme.example': 4_000 }
    })
  })
})

describe('forgetGoogleAccount', () => {
  it('rewrites the trigger state, drops the Drive text and tells each listener', async () => {
    const path = join(dir, 'orca-google-triggers.json')
    writeFileSync(path, JSON.stringify(state()))
    const make = vi.fn(async () => ({ text: 'Quarterly plan', source: 'doc' }))
    const key = { account: 'ann@acme.example', id: 'file-1', modifiedTime: '2026-11-25T08:00:00Z' }
    const otherMake = vi.fn(async () => ({ text: 'Bob notes', source: 'doc' }))
    const other = {
      account: 'bob@acme.example',
      id: 'file-2',
      modifiedTime: '2026-11-25T08:00:00Z'
    }
    await cachedFileText(key, make)
    await cachedFileText(other, otherMake)

    const heard: string[] = []
    const failing = onGoogleAccountRemoved(() => {
      throw new Error('listener broke')
    })
    const stop = onGoogleAccountRemoved((email) => {
      heard.push(email)
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await forgetGoogleAccount('ann@acme.example', path)
    } finally {
      failing()
      stop()
    }

    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual(
      forgetGoogleTriggerAccount(state(), 'ann@acme.example')
    )
    expect(heard).toEqual(['ann@acme.example'])
    // A listener that throws is logged and the others still run.
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()

    await cachedFileText(key, make)
    expect(make).toHaveBeenCalledTimes(2)
    await cachedFileText(other, otherMake)
    expect(otherMake).toHaveBeenCalledTimes(1)
  })

  it('leaves a missing state file missing and stops telling an unsubscribed listener', async () => {
    const path = join(dir, 'none', 'orca-google-triggers.json')
    const listener = vi.fn()
    onGoogleAccountRemoved(listener)()
    await forgetGoogleAccount('ann@acme.example', path)
    expect(() => readFileSync(path)).toThrow()
    expect(listener).not.toHaveBeenCalled()
  })
})
