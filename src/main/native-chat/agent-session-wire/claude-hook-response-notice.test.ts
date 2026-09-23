import { describe, expect, it } from 'vitest'
import { unhandledProviderFrameJournalItem } from './unhandled-provider-frame'

const failedHook = {
  type: 'system',
  subtype: 'hook_response',
  hook_name: 'SessionStart:startup',
  hook_event: 'SessionStart',
  output: '{"continue":true}\n{"continue":true}\n',
  stderr:
    'Hook output looks like a JSON object but is not valid JSON. Emit the payload with a JSON encoder.',
  exit_code: 0,
  outcome: 'error'
}

describe('Claude hook_response notices', () => {
  it('shows a failed hook as one warning line, like the CLI, not an error card', () => {
    const item = unhandledProviderFrameJournalItem(
      'claude',
      'message:system:hook_response',
      failedHook
    )
    expect(item?.classification).toBe('timeline-substantive')
    expect(item?.body).toMatchObject({
      kind: 'status',
      tone: 'warning',
      text: 'SessionStart:startup hook error: Hook output looks like a JSON object but is not valid JSON.'
    })
  })

  it('keeps successful hook responses out of the timeline', () => {
    expect(
      unhandledProviderFrameJournalItem('claude', 'message:system:hook_response', {
        ...failedHook,
        outcome: 'success'
      })
    ).toBeNull()
  })
})
