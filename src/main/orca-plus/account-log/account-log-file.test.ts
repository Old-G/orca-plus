import { describe, expect, it } from 'vitest'
import { toAccountLogRecord } from './account-log-file'

const now = new Date('2026-09-30T12:00:00.000Z')

describe('toAccountLogRecord', () => {
  it('keeps account-service lines and flattens their arguments', () => {
    expect(
      toAccountLogRecord(
        'warn',
        ['[claude-runtime-auth] Failed to sync runtime auth state:', new Error('boom')],
        now
      )
    ).toEqual({
      at: '2026-09-30T12:00:00.000Z',
      level: 'warn',
      message: '[claude-runtime-auth] Failed to sync runtime auth state: Error: boom'
    })
  })

  it('ignores everything else', () => {
    expect(toAccountLogRecord('warn', ['[pulse-bell] list failed'], now)).toBeNull()
    expect(
      toAccountLogRecord('error', [new Error('[claude-accounts] not a string')], now)
    ).toBeNull()
  })

  it('redacts secrets that reach the message', () => {
    const record = toAccountLogRecord(
      'warn',
      [
        '[claude-accounts] refresh failed',
        { refresh_token: 'sk-ant-ort01-abcdefghijklmnopqrstuvwxyz' }
      ],
      now
    )
    expect(record?.message).not.toContain('abcdefghijklmnopqrstuvwxyz')
  })
})
