import { describe, expect, it } from 'vitest'
import { hqPlusSaid } from './hq-plus-said'

describe('hqPlusSaid', () => {
  it("drops the Approve footer under the owner's message", () => {
    const asked =
      'Can you set the API License flag?\n\n_↳ DEV-1 (https://app.example/t/1) · Acme · «SDK switch» · ref 1d1c0c_ *Sent using* <@U0AM25CLR24>'
    expect(hqPlusSaid(asked)).toEqual({ text: 'Can you set the API License flag?', files: 0 })
  })

  it('says the author once and counts files instead of «[file: …]»', () => {
    expect(
      hqPlusSaid(
        'Ann: Licence goes through support \n\nIt depends on them [file: IMG_1.png]',
        'Ann'
      )
    ).toEqual({
      text: 'Licence goes through support\n\nIt depends on them',
      files: 1
    })
  })

  it('keeps every speaker of a thread with several people', () => {
    expect(
      hqPlusSaid('Ann: page not found\nBob: same here\nAnn: [file: image.png]', 'Bob')
    ).toEqual({
      text: 'Ann: page not found\nBob: same here',
      files: 1
    })
  })

  it('strips the name from each line when only the author speaks', () => {
    expect(hqPlusSaid('Ann: first\nAnn: second', 'Ann').text).toBe('first\nsecond')
  })

  it("drops the leading tag of the owner and reads Slack's one-star bold", () => {
    expect(hqPlusSaid('Ann: <@U097YTWNSLC> *Question:* call or cancel?', 'Ann').text).toBe(
      '**Question:** call or cancel?'
    )
  })

  it('strips the author though a line of the text has a colon, and keeps Slack links short', () => {
    const said = hqPlusSaid(
      'Ann: <@U097YTWNSLC>, hi!\n\nExamples:\n\u2022\tCannot find account: #1 \u2013 Acme (https://acme.example/t/1)\nNote: soon',
      'Ann'
    )
    expect(said.text).toBe(
      'hi!\n\nExamples:\n\u2022 Cannot find account: #1 \u2013 Acme [\u2197](https://acme.example/t/1)\nNote: soon'
    )
  })
})
