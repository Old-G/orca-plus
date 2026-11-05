import { describe, expect, it } from 'vitest'
import {
  hqBrainDays,
  hqBrainGroupCounts,
  hqBrainGroupOf,
  hqBrainModeOf,
  hqBrainVisibleRows,
  isHqBrainCommandTitle,
  readHqBrainSearch,
  readHqBrainTimeline,
  splitHqBrainEntities,
  type HqBrainRow
} from './hq-brain'

function row(partial: Partial<HqBrainRow> & { key: string; ts: string }): HqBrainRow {
  return {
    day: partial.ts.slice(0, 10),
    source: 'orca-chat',
    project: null,
    title: null,
    link: null,
    atom: null,
    mentions: 1,
    text: '',
    id: `${partial.key}@${partial.ts.slice(0, 10)}`,
    at: Date.parse(partial.ts),
    group: 'chat',
    status: null,
    person: null,
    target: null,
    chat: null,
    command: false,
    ...partial
  }
}

describe('readHqBrainTimeline', () => {
  it('reads the script rows and drops broken ones', () => {
    const parsed = readHqBrainTimeline({
      entity: 'DEV-123',
      matched_by: 'id',
      ms: 12.5,
      rows: [
        {
          ts: '2026-10-27T20:08:26+03:00',
          day: '2026-10-27',
          key: 'waitings:w1',
          source: 'pulse:waitings',
          project: 'acme',
          title: 'Wait',
          link: null,
          atom: null,
          mentions: 2,
          text: 'DEV-123: ok?'
        },
        { key: 'no-ts' }
      ]
    })
    expect(parsed?.matchedBy).toBe('id')
    expect(parsed?.rows).toHaveLength(1)
    expect(parsed?.rows[0]).toMatchObject({ key: 'waitings:w1', mentions: 2, project: 'acme' })
  })

  it('is null for output that is not a timeline', () => {
    expect(readHqBrainTimeline({ hits: [] })).toBeNull()
  })
})

describe('readHqBrainSearch', () => {
  it('maps hits to rows, the snippet as the text and the day from the time', () => {
    const parsed = readHqBrainSearch({
      ms: 3,
      hits: [
        {
          key: 'k',
          source: 'gitlab',
          project: null,
          title: 'MR',
          ts: '2026-10-29T21:48:56+03:00',
          snippet: 'found here',
          link: 'https://gitlab.example/mr/1'
        }
      ]
    })
    expect(parsed?.rows[0]).toMatchObject({ day: '2026-10-29', text: 'found here', mentions: 1 })
  })
})

describe('hqBrainModeOf', () => {
  it('sends an id, a project or a name to the timeline and longer free text to the search', () => {
    expect(hqBrainModeOf('DEV-12345')).toBe('timeline')
    expect(hqBrainModeOf('Ann Lee')).toBe('timeline')
    expect(hqBrainModeOf('dry run on the prod copy')).toBe('search')
  })
})

describe('groups and command approvals', () => {
  it('puts each source under its chip', () => {
    expect(hqBrainGroupOf('orca-chat')).toBe('chat')
    expect(hqBrainGroupOf('pulse:decisions')).toBe('sent')
    expect(hqBrainGroupOf('pulse:waitings')).toBe('wait')
    expect(hqBrainGroupOf('pulse:clickup')).toBe('clickup')
    expect(hqBrainGroupOf('docs')).toBe('code')
    expect(hqBrainGroupOf('mail')).toBe('other')
  })

  it('tells a shell command approval from a message', () => {
    expect(
      isHqBrainCommandTitle('remote · delete on a server or database — DEV-1 — approved')
    ).toBe(true)
    expect(isHqBrainCommandTitle('git · push')).toBe(true)
    expect(isHqBrainCommandTitle('HTTP · curl request')).toBe(true)
    expect(isHqBrainCommandTitle('HTTP · message')).toBe(false)
    expect(isHqBrainCommandTitle('Slack · send message')).toBe(false)
    expect(isHqBrainCommandTitle(null)).toBe(false)
  })

  it('hides command approvals from the rows and the counts until asked', () => {
    const rows = [
      row({ key: 'a', ts: '2026-10-27T10:00:00+03:00', group: 'sent', command: true }),
      row({ key: 'b', ts: '2026-10-27T11:00:00+03:00', group: 'sent' }),
      row({ key: 'c', ts: '2026-10-27T12:00:00+03:00', group: 'chat' })
    ]
    expect(hqBrainVisibleRows(rows, 'all', false).map((r) => r.key)).toEqual(['b', 'c'])
    expect(hqBrainVisibleRows(rows, 'sent', true).map((r) => r.key)).toEqual(['a', 'b'])
    expect(hqBrainGroupCounts(rows, false)).toMatchObject({ all: 2, sent: 1, chat: 1 })
    expect(hqBrainGroupCounts(rows, true)).toMatchObject({ all: 3, sent: 2 })
  })
})

describe('hqBrainDays', () => {
  it('groups by day, newest day and newest row first', () => {
    const days = hqBrainDays([
      row({ key: 'old', ts: '2026-10-26T18:22:00+03:00' }),
      row({ key: 'early', ts: '2026-10-27T10:37:00+03:00' }),
      row({ key: 'late', ts: '2026-10-27T20:08:00+03:00' })
    ])
    expect(days.map((d) => d.day)).toEqual(['2026-10-27', '2026-10-26'])
    expect(days[0].rows.map((r) => r.key)).toEqual(['late', 'early'])
  })
})

describe('splitHqBrainEntities', () => {
  it('finds task ids, MRs and repo MRs, and asks for a repo MR without its group', () => {
    const parts = splitHqBrainEntities(
      'DEV-12345 split out, see acme/billing-api!23 and !19; SPEC-PAY-021 and E8 are not tasks'
    )
    expect(parts.filter((p) => p.kind === 'entity')).toEqual([
      { kind: 'entity', text: 'DEV-12345', entity: 'DEV-12345' },
      {
        kind: 'entity',
        text: 'acme/billing-api!23',
        entity: 'billing-api!23'
      },
      { kind: 'entity', text: '!19', entity: '!19' }
    ])
    expect(parts.map((p) => p.text).join('')).toContain('SPEC-PAY-021 and E8 are not tasks')
  })

  it('leaves plain text whole', () => {
    expect(splitHqBrainEntities('nothing here!')).toEqual([{ kind: 'text', text: 'nothing here!' }])
  })
})
