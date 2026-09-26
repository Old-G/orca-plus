import { describe, expect, it } from 'vitest'
import { parseClaudeStatusLineContextWindow } from './claude-statusline-context-window'

const NOW = 1_790_000_000_000

function formBody(payload: unknown, paneKey = 'tab-1:leaf'): Record<string, string> {
  return { paneKey, payload: JSON.stringify(payload) }
}

describe('parseClaudeStatusLineContextWindow', () => {
  it('reads the reported percentage and window size', () => {
    const parsed = parseClaudeStatusLineContextWindow(
      formBody({
        context_window: { used_percentage: 42.5, context_window_size: 1_000_000 },
        rate_limits: { five_hour: { used_percentage: 3 } }
      }),
      NOW
    )
    expect(parsed).toEqual({
      paneKey: 'tab-1:leaf',
      contextWindow: { usedPercentage: 42.5, windowTokens: 1_000_000, observedAt: NOW }
    })
  })

  it('falls back to the last request usage while used_percentage is null', () => {
    const parsed = parseClaudeStatusLineContextWindow(
      formBody({
        context_window: {
          used_percentage: null,
          context_window_size: 200_000,
          current_usage: {
            input_tokens: 1_000,
            output_tokens: 9_999,
            cache_creation_input_tokens: 9_000,
            cache_read_input_tokens: 40_000
          }
        }
      }),
      NOW
    )
    // (1k + 9k + 40k) / 200k; output tokens are not context.
    expect(parsed?.contextWindow.usedPercentage).toBe(25)
  })

  it('keeps an over-limit reading above 100', () => {
    const parsed = parseClaudeStatusLineContextWindow(
      formBody({ context_window: { used_percentage: 104, context_window_size: 200_000 } }),
      NOW
    )
    expect(parsed?.contextWindow.usedPercentage).toBe(104)
  })

  it('returns null without a pane, a window size, or any usage', () => {
    const context = { context_window: { used_percentage: 10, context_window_size: 200_000 } }
    expect(parseClaudeStatusLineContextWindow(formBody(context, '  '), NOW)).toBeNull()
    expect(parseClaudeStatusLineContextWindow({ payload: JSON.stringify(context) }, NOW)).toBeNull()
    expect(
      parseClaudeStatusLineContextWindow(formBody({ context_window: { used_percentage: 10 } }), NOW)
    ).toBeNull()
    expect(
      parseClaudeStatusLineContextWindow(
        formBody({ context_window: { used_percentage: 10, context_window_size: 0 } }),
        NOW
      )
    ).toBeNull()
    expect(
      parseClaudeStatusLineContextWindow(
        formBody({ context_window: { used_percentage: null, context_window_size: 200_000 } }),
        NOW
      )
    ).toBeNull()
    expect(parseClaudeStatusLineContextWindow(formBody({ rate_limits: {} }), NOW)).toBeNull()
  })

  it('rejects malformed bodies without throwing', () => {
    expect(parseClaudeStatusLineContextWindow(null, NOW)).toBeNull()
    expect(parseClaudeStatusLineContextWindow('raw', NOW)).toBeNull()
    expect(parseClaudeStatusLineContextWindow({ paneKey: 'p', payload: 'nope' }, NOW)).toBeNull()
    expect(
      parseClaudeStatusLineContextWindow(
        formBody({ context_window: { used_percentage: -5, context_window_size: 200_000 } }),
        NOW
      )
    ).toBeNull()
  })
})
