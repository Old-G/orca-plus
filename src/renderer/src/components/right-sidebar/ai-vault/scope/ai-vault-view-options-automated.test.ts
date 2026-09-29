import { describe, expect, it } from 'vitest'
import {
  createDefaultAiVaultViewOptions,
  normalizeAiVaultViewOptions
} from './ai-vault-view-options-persistence'

// Custom build (ai-vault-automated-sessions): kept apart from the suite upstream removed (#36717).
describe('AI Vault automated-session option', () => {
  it('hides automated sessions by default and when the stored value is malformed', () => {
    expect(createDefaultAiVaultViewOptions().hideAutomatedSessions).toBe(true)
    expect(normalizeAiVaultViewOptions({ hideAutomatedSessions: 'no' }).hideAutomatedSessions).toBe(
      true
    )
  })

  it('keeps a stored choice', () => {
    expect(normalizeAiVaultViewOptions({ hideAutomatedSessions: false }).hideAutomatedSessions).toBe(
      false
    )
  })
})
