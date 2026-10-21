import { describe, expect, it } from 'vitest'
import { clickUpCommentForOwner, slackMessageForOwner } from './hq-reply-addressee'

describe('clickUpCommentForOwner', () => {
  it('skips a comment that asks someone else', () => {
    expect(clickUpCommentForOwner('@Ivan Petrov создай на меня задачу', 'Alex Owner')).toBe(false)
  })

  it('keeps a plain answer and one that mentions the owner too', () => {
    expect(clickUpCommentForOwner('Готово, проверь', 'Alex Owner')).toBe(true)
    expect(clickUpCommentForOwner('@Alex Owner @Ivan Petrov готово', 'Alex Owner')).toBe(true)
    expect(clickUpCommentForOwner('пиши на ivan@example.com', 'Alex Owner')).toBe(true)
  })

  it('skips a sync bot copying the owner’s own Slack words, keeps one copying someone else', () => {
    expect(
      clickUpCommentForOwner('[Slack Sync] 💬 @Alex Owner (Slack): ща поправлю', 'Alex Owner')
    ).toBe(false)
    expect(
      clickUpCommentForOwner('[Slack Sync] 💬 @Anna Levi (Slack): поправил', 'Alex Owner')
    ).toBe(true)
  })
})

describe('slackMessageForOwner', () => {
  it('skips a message that mentions only others', () => {
    expect(slackMessageForOwner('<@U2> глянь', 'UOWNER')).toBe(false)
    expect(slackMessageForOwner('<@U2> <@UOWNER> глянь', 'UOWNER')).toBe(true)
    expect(slackMessageForOwner('готово', 'UOWNER')).toBe(true)
  })
})
