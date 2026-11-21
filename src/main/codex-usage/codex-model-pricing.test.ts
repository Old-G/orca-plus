import { describe, expect, it } from 'vitest'
import { MODEL_PRICING, normalizeModelForPricing } from './codex-model-pricing'

describe('gpt-6.2-sol pricing', () => {
  it('maps the model and its dated snapshots to its own rates', () => {
    expect(normalizeModelForPricing('gpt-6.2-sol')).toBe('gpt-6.2-sol')
    expect(normalizeModelForPricing('gpt-6.2-sol-2026-11-20')).toBe('gpt-6.2-sol')
    expect(normalizeModelForPricing('gpt-6.1-sol')).toBe('gpt-6.1-sol')
    expect(MODEL_PRICING['gpt-6.2-sol']).toEqual(MODEL_PRICING['gpt-6.1-sol'])
  })
})
