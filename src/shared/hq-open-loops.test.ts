import { describe, expect, it } from 'vitest'
import {
  hqLoopAnswer,
  hqLoopTimelineOf,
  hqOpenLoop,
  type HqLoopMessage,
  type HqLoopOwner,
  type HqLoopTimeline
} from './hq-open-loops'

const HOUR = 60 * 60_000
const T0 = Date.UTC(2026, 10, 2, 9)
const owner: HqLoopOwner = { slackIds: ['UOWNER'], names: ['Olga Owner'] }

type Line = [hours: number, who: 'owner' | 'ann' | 'bob', text: string, key?: string]

function timeline(key: string, lines: Line[]): HqLoopTimeline {
  const messages: HqLoopMessage[] = lines.map(([hours, who, text, at], index) => ({
    key: at ?? key,
    ts: `${1_790_000_000 + index}.000100`,
    at: T0 + hours * HOUR,
    fromOwner: who === 'owner',
    author: who === 'owner' ? 'Olga Owner' : who === 'ann' ? 'Ann Lee' : 'Bob Stone',
    authorId: who === 'owner' ? 'UOWNER' : who === 'ann' ? 'UANN' : 'UBOB',
    text,
    link: `https://acme.example/m/${index}`
  }))
  return { ...hqLoopTimelineOf(key), messages }
}

describe('hqOpenLoop', () => {
  it('opens on the owner when a DM to him stays unanswered, a day from its first line', () => {
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [
        [0, 'ann', 'Can you send the export?'],
        [20, 'ann', 'ping']
      ]),
      owner
    )
    expect(loop).toMatchObject({ direction: 'on-me', person: 'Ann Lee', personId: 'UANN' })
    expect(loop?.dueAt).toBe(T0 + 24 * HOUR)
  })

  it('waits on nobody after a status or report that asks nothing', () => {
    const loop = hqOpenLoop(
      timeline('slack:C1:1.1', [[0, 'ann', '<@UOWNER> deployed, the import works again']]),
      owner
    )
    expect(loop).toBeNull()
  })

  it('takes a joke with a question mark for no question', () => {
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [[0, 'owner', 'я не знаю) о чем мы вообще тут?))']]),
      owner
    )
    expect(loop).toBeNull()
  })

  it('waits on nobody after his answer to her question, unless he asks back', () => {
    const asked: Line[] = [[0, 'ann', 'Could you check why the import failed?']]
    expect(
      hqOpenLoop(
        timeline('slack:D1:1.1', [...asked, [1, 'owner', 'Fixed, please check it on your side']]),
        owner
      )
    ).toBeNull()
    expect(
      hqOpenLoop(
        timeline('slack:D1:1.1', [...asked, [1, 'owner', 'Fixed. Which file did you use?']]),
        owner
      )
    ).toMatchObject({ direction: 'on-them' })
  })

  it('takes a write-up with headings for a document, not an ask', () => {
    const loop = hqOpenLoop(
      timeline('clickup:abc1', [
        [0, 'ann', 'Please run the eval'],
        [
          1,
          'owner',
          '## Eval result\n**Owner:** @olga\nAll 5 passed.\n## Open questions\nShall we ship it?'
        ]
      ]),
      owner
    )
    expect(loop).toBeNull()
  })

  it('waits on nobody once the one who asked says thanks', () => {
    const loop = hqOpenLoop(
      timeline('clickup:abc1', [
        [0, 'ann', '@Olga Owner could you clarify the pause rule?'],
        [1, 'owner', '@Ann Lee it stays at 30 days. Does that work for you?'],
        [2, 'owner', '@Ann Lee got it, thank you']
      ]),
      owner
    )
    expect(loop).toBeNull()
  })

  it('waits on nobody after a question quoted in the text, a conditional request or a withdrawn ask', () => {
    const say = (text: string) =>
      hqOpenLoop(
        timeline('slack:C1:1.1', [
          [0, 'ann', 'hi'],
          [1, 'owner', text]
        ]),
        owner
      )
    expect(say('<@UANN> the question is in the doc: «why can’t a paused user log in?»')).toBeNull()
    expect(say('<@UANN> fixed it. If anything breaks, let me know')).toBeNull()
    expect(say('<@UANN> can you check if the import works?')).toMatchObject({
      direction: 'on-them'
    })
    expect(
      hqOpenLoop(
        timeline('slack:C1:1.1', [
          [0, 'ann', 'hi'],
          [1, 'owner', '<@UANN> can you take this?'],
          [2, 'owner', 'вопрос снимаю, сделал сам']
        ]),
        owner
      )
    ).toBeNull()
  })

  it('leaves an ask tied to a time of today to the evening check', () => {
    const loop = hqOpenLoop(
      timeline('slack:C1:1.1', [
        [0, 'ann', '<@UOWNER> I set the call for 15.30, does that work for you?']
      ]),
      owner
    )
    expect(loop).toMatchObject({ direction: 'on-me', disputed: 'time-bound' })
  })

  it('keeps a wait on the owner when someone else in the thread says ok', () => {
    const loop = hqOpenLoop(
      timeline('slack:C1:1.1', [
        [0, 'ann', '<@UOWNER> можешь глянуть логи?'],
        [1, 'bob', 'ок']
      ]),
      owner
    )
    expect(loop).toMatchObject({ direction: 'on-me', personId: 'UANN' })
  })

  it('waits on nobody after their thanks', () => {
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [
        [0, 'ann', 'Can you send the export?'],
        [1, 'owner', 'Here: https://acme.example/export.csv'],
        [2, 'ann', 'Спасибо большое! :pray:']
      ]),
      owner
    )
    expect(loop).toBeNull()
  })

  it('keeps the clock of his first question through his bump', () => {
    const loop = hqOpenLoop(
      timeline('slack:C1:1.1', [
        [0, 'ann', 'Deploy is done'],
        [1, 'owner', '<@UANN> when can we get the keys?'],
        [49, 'owner', '<@UANN> bump']
      ]),
      owner
    )
    expect(loop).toMatchObject({ direction: 'on-them', personId: 'UANN', disputed: null })
    expect(loop?.dueAt).toBe(T0 + 73 * HOUR)
  })

  it('does not take «ок» for an answer to his question', () => {
    const line = timeline('slack:D1:1.1', [
      [0, 'owner', 'Когда будет доступ?'],
      [3, 'ann', 'ок, понял 👍']
    ])
    const loop = hqOpenLoop(line, owner)
    expect(loop).toMatchObject({ direction: 'on-them', person: 'Ann Lee' })
    expect(loop && hqLoopAnswer(loop, line, owner)).toMatchObject({
      kind: 'disputed',
      why: 'ack-reply'
    })
  })

  it('sees no question in a question mark inside a link', () => {
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [
        [0, 'ann', 'Where is the filter?'],
        [1, 'owner', 'Here https://acme.example/search?q=boxes&page=2']
      ]),
      owner
    )
    expect(loop).toBeNull()
  })

  it('leaves a question only inside a forwarded message to the evening check', () => {
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [
        [0, 'ann', 'hi'],
        [1, 'owner', 'Look at this\n↪ Bob Stone in #dev: why does the build fail?']
      ]),
      owner
    )
    expect(loop).toMatchObject({ direction: 'on-them', disputed: 'quoted-question' })
  })

  it('marks a question to two people as disputed', () => {
    const loop = hqOpenLoop(
      timeline('slack:C1:1.1', [[0, 'owner', '<@UANN> <@UBOB> who can take this?']]),
      owner
    )
    expect(loop).toMatchObject({ direction: 'on-them', disputed: 'many-addressees' })
  })

  it('opens on the owner for a thread reply right after him, not for one to someone else', () => {
    const toOwner = timeline('slack:C1:1.1', [
      [0, 'owner', 'Shipped the fix'],
      [1, 'ann', 'It still fails for me, can you look?']
    ])
    expect(hqOpenLoop(toOwner, owner)).toMatchObject({ direction: 'on-me', personId: 'UANN' })
    const toBob = timeline('slack:C1:1.1', [
      [0, 'owner', 'Shipped the fix'],
      [1, 'ann', '<@UBOB> can you check it on staging?']
    ])
    expect(hqOpenLoop(toBob, owner)).toBeNull()
  })

  it('opens on the owner for a ClickUp comment that tags him by name', () => {
    const loop = hqOpenLoop(
      timeline('clickup:abc1', [[0, 'ann', '@Olga Owner please confirm the price list']]),
      owner
    )
    expect(loop).toMatchObject({ direction: 'on-me', person: 'Ann Lee' })
  })

  it('reads a ClickUp tag in its markup as the person asked', () => {
    const loop = hqOpenLoop(
      timeline('clickup:abc1', [
        [0, 'ann', 'The export is ready'],
        [1, 'owner', '[@Bob Stone](#user_mention#42) can you confirm the price list?']
      ]),
      owner
    )
    expect(loop).toMatchObject({ direction: 'on-them', person: 'Bob Stone' })
  })

  it('marks a long thread as disputed', () => {
    const lines: Line[] = Array.from({ length: 16 }, (_, index) => [
      index,
      index % 2 ? 'owner' : 'ann',
      `step ${index}`
    ])
    lines.push([17, 'ann', '<@UOWNER> and the last one?'])
    expect(hqOpenLoop(timeline('slack:C1:1.1', lines), owner)).toMatchObject({
      direction: 'on-me',
      disputed: 'long-thread'
    })
  })
})

describe('hqLoopAnswer', () => {
  it('closes his question on «сделаю» in the same talk, with that message', () => {
    const line = timeline('slack:D1:1.1', [
      [0, 'owner', 'Can you rotate the token?'],
      [0.2, 'ann', 'сделаю сегодня']
    ])
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [[0, 'owner', 'Can you rotate the token?']]),
      owner
    )
    expect(loop && hqLoopAnswer(loop, line, owner)).toMatchObject({
      kind: 'answer',
      message: { text: 'сделаю сегодня' }
    })
  })

  it('leaves a DM reply in a later talk to the evening check', () => {
    const line = timeline('slack:D1:1.1', [
      [0, 'owner', 'Can you rotate the token?'],
      [26, 'ann', 'сделаю сегодня', 'slack:D1:9.9']
    ])
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [[0, 'owner', 'Can you rotate the token?']]),
      owner
    )
    expect(loop && hqLoopAnswer(loop, line, owner)).toMatchObject({
      kind: 'disputed',
      why: 'dm-later'
    })
  })

  it('leaves a reply that came after he asked again to the evening check', () => {
    const asked: Line[] = [
      [0, 'owner', '<@UANN> can you rotate the token?'],
      [2, 'owner', '<@UANN> and is the old one still used anywhere?']
    ]
    const loop = hqOpenLoop(timeline('slack:C1:1.1', asked), owner)
    const line = timeline('slack:C1:1.1', [...asked, [5, 'ann', 'no, only staging']])
    expect(loop && hqLoopAnswer(loop, line, owner)).toMatchObject({
      kind: 'disputed',
      why: 'several-asks'
    })
  })

  it('leaves a question back undecided instead of taking it for the answer', () => {
    const line = timeline('slack:D1:1.1', [
      [0, 'owner', 'Можешь перевыпустить токен?'],
      [2, 'ann', 'А какой именно, прод или стейдж?']
    ])
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [[0, 'owner', 'Можешь перевыпустить токен?']]),
      owner
    )
    expect(loop && hqLoopAnswer(loop, line, owner)).toMatchObject({
      kind: 'disputed',
      why: 'counter-question'
    })
  })

  it('closes his question on a voice note or a file (a message with no text)', () => {
    const line = timeline('slack:D1:1.1', [
      [0, 'owner', 'Пришли, пожалуйста, выгрузку'],
      [5, 'ann', '']
    ])
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [[0, 'owner', 'Пришли, пожалуйста, выгрузку']]),
      owner
    )
    expect(loop?.direction).toBe('on-them')
    expect(loop && hqLoopAnswer(loop, line, owner)).toMatchObject({ kind: 'answer' })
  })

  it('takes another person’s reply in a thread as disputed, not as the answer', () => {
    const asked = timeline('slack:C1:1.1', [[0, 'owner', '<@UANN> can you rotate the token?']])
    const loop = hqOpenLoop(asked, owner)
    const line = timeline('slack:C1:1.1', [
      [0, 'owner', '<@UANN> can you rotate the token?'],
      [5, 'bob', 'Ann is away, I can do it tomorrow']
    ])
    expect(loop && hqLoopAnswer(loop, line, owner)).toMatchObject({
      kind: 'disputed',
      why: 'other-answered',
      message: { authorId: 'UBOB' }
    })
  })

  it('closes a wait on the owner with his next message', () => {
    const line = timeline('slack:D1:1.1', [
      [0, 'ann', 'Can you send the export?'],
      [30, 'owner', 'ok']
    ])
    const loop = hqOpenLoop(
      timeline('slack:D1:1.1', [[0, 'ann', 'Can you send the export?']]),
      owner
    )
    expect(loop && hqLoopAnswer(loop, line, owner)).toMatchObject({
      kind: 'answer',
      message: { fromOwner: true }
    })
  })
})
