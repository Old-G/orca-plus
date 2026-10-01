import { describe, expect, it } from 'vitest'
import {
  readClaudeSubscriptionSettings,
  setClaudeSubscriptionSettingsSource
} from './claude-subscription-settings-source'

describe('claude subscription settings source', () => {
  it('is empty until main registers the store, then reads it live', () => {
    expect(readClaudeSubscriptionSettings()).toBeNull()
    let settings = { claudeSubscriptions: [{ id: 'work', label: 'Work', configDir: '/w' }] }
    setClaudeSubscriptionSettingsSource(() => settings)
    expect(readClaudeSubscriptionSettings()?.claudeSubscriptions?.[0]?.id).toBe('work')
    settings = { claudeSubscriptions: [] }
    expect(readClaudeSubscriptionSettings()?.claudeSubscriptions).toEqual([])
  })
})
