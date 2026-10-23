import { describe, expect, it } from 'vitest'
import { hqPlusSlackText } from './hq-plus-slack-text'

const lookups = {
  nameOf: (id: string) => (id === 'U01ANN' ? 'Ann' : null),
  emojiOf: (code: string) => ({ blush: '😊', wave: '👋' })[code] ?? null
}

describe('hqPlusSlackText', () => {
  it('reads mentions, links and emoji the way Slack shows them', () => {
    expect(
      hqPlusSlackText(
        '<@U01ANN> see <https://acme.example/a|the doc> :blush: :wave::skin-tone-3: <@U09BOB|bob> <@U09X> :nope: 10:30:00',
        lookups
      )
    ).toBe('@Ann see [the doc](https://acme.example/a) 😊 👋🏼 @bob <@U09X> :nope: 10:30:00')
  })
})
