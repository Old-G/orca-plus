import { describe, expect, it } from 'vitest'
import { slackSharedText } from './slack-ledger-api'

// Custom build (hq-ledger-context, owner 03.11).
describe('slackSharedText', () => {
  it('reads a forwarded message with its author and channel, and ignores link previews', () => {
    expect(
      slackSharedText({
        attachments: [
          {
            is_share: true,
            author_name: 'Bob',
            channel_name: 'acme-bugs',
            from_url: 'https://acme.slack.com/archives/C1/p1',
            text: 'order 146 opened 2 packages'
          },
          { title: 'A link preview', text: 'not a forward' }
        ]
      })
    ).toBe(
      '↪ Bob in #acme-bugs (https://acme.slack.com/archives/C1/p1): order 146 opened 2 packages'
    )
    expect(slackSharedText({})).toBe('')
  })
})
