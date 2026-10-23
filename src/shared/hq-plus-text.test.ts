import { describe, expect, it } from 'vitest'
import { hqPlusTextLines } from './hq-plus-text'

describe('hqPlusTextLines', () => {
  it('drops markdown marks and keeps bold, code and links as spans', () => {
    const [first, second] = hqPlusTextLines(
      'Shipped `1.4.239` — **what is in:** the screen\n- see [the page](https://acme.example/p)'
    )
    expect(first?.spans).toEqual([
      { kind: 'text', text: 'Shipped ' },
      { kind: 'code', text: '1.4.239' },
      { kind: 'text', text: ' — ' },
      { kind: 'bold', text: 'what is in:' },
      { kind: 'text', text: ' the screen' }
    ])
    expect(second).toEqual({
      bullet: true,
      spans: [
        { kind: 'text', text: 'see ' },
        { kind: 'link', text: 'the page', href: 'https://acme.example/p' }
      ]
    })
  })

  it('cuts to the asked number of lines and marks the cut', () => {
    const lines = hqPlusTextLines('# Title\none\n\ntwo\nthree', 2)
    expect(lines).toHaveLength(2)
    expect(lines[0]?.spans).toEqual([{ kind: 'text', text: 'Title' }])
    expect(lines[1]?.spans.at(-1)).toEqual({ kind: 'text', text: ' …' })
  })
})
