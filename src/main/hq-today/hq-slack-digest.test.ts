import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hqDigestSlot, type HqLedgerDigestConversation } from '../../shared/hq-slack-digest'
import type { HqSlackScoutDraft } from '../../shared/hq-slack-scout'
import type { PulseBellInput } from '../../shared/pulse-bell'
import { runHqSlackDigest } from './hq-slack-digest'

let hq: string

beforeEach(() => {
  hq = mkdtempSync(join(tmpdir(), 'hq-slack-digest-'))
  mkdirSync(join(hq, 'slack-scout'))
})

afterEach(() => rmSync(hq, { recursive: true, force: true }))

const at = (hour: number, minute = 5): Date => new Date(2026, 9, 17, hour, minute)

const draft = (id: string): HqSlackScoutDraft => ({
  id,
  channelName: 'DM Вера',
  author: 'Вера',
  permalink: '',
  quote: '',
  title: 'Нет автоответа',
  description: '',
  foundAt: '',
  ask: 'почини автоответ'
})

function write(file: string, value: unknown): void {
  writeFileSync(join(hq, 'slack-scout', file), JSON.stringify(value))
}

function run(
  now: Date,
  drafts: HqSlackScoutDraft[] = [],
  ledger?: () => HqLedgerDigestConversation[]
) {
  const synced: PulseBellInput[][] = []
  const posted = runHqSlackDigest({
    hqPath: () => hq,
    enabled: () => true,
    readScout: async () => ({
      ok: true,
      configured: true,
      lastRunAt: null,
      failedAt: null,
      drafts
    }),
    sync: (_kind, items) => synced.push([...items]),
    now: () => now,
    ledger
  })
  return { posted, synced }
}

describe('Slack digest', () => {
  it('names the latest digest hour reached today', () => {
    expect(hqDigestSlot(at(9), [10, 14, 18])).toBeNull()
    expect(hqDigestSlot(at(14, 30), [10, 14, 18])).toBe('2026-10-17 14')
    expect(hqDigestSlot(at(23), [10, 14, 18])).toBe('2026-10-17 18')
  })

  it('only marks where it starts on its first run', async () => {
    const first = run(at(14, 30), [draft('a')])
    expect(await first.posted).toBe(false)
    expect(first.synced).toEqual([])
  })

  it('sums up what waits and what went by quietly since the last digest, once per hour slot', async () => {
    write('digest-state.json', { slot: '2026-10-17 10', at: at(10).toISOString() })
    write('quiet.json', {
      items: [
        { id: 'q-old', at: at(9).toISOString(), author: 'Петя', summary: 'старое' },
        {
          id: 'q1',
          at: at(12).toISOString(),
          author: 'Петя',
          summary: 'Решение CTO: тень после доступов',
          why: 'к сведению'
        }
      ]
    })
    const digest = run(at(14, 2), [draft('a')])
    expect(await digest.posted).toBe(true)
    expect(digest.synced[0]?.[0]).toMatchObject({
      kind: 'slack-digest',
      title: 'Slack digest 14:00 — 1 for you, 1 quiet',
      body: [
        'Wait for you: 1',
        '• Вера: почини автоответ',
        'Went by quietly: 1',
        '• Петя: Решение CTO: тень после доступов (к сведению)'
      ].join('\n')
    })
    expect(await run(at(14, 40), [draft('a')]).posted).toBe(false)
  })

  it('posts nothing when nothing waits and nothing went by', async () => {
    write('digest-state.json', { slot: '2026-10-17 10', at: at(10).toISOString() })
    const quiet = run(at(14, 2))
    expect(await quiet.posted).toBe(false)
    expect(quiet.synced).toEqual([])
  })

  it('reads the ledger once the scout has not run for hours, the scout while it runs', async () => {
    write('digest-state.json', { slot: '2026-10-17 10', at: at(10).toISOString() })
    const ledger = () => [
      { id: 'c1', key: 'slack:D1:1.1', state: 'you', title: 'Проверить возвраты', lastAt: +at(11) },
      { id: 'c2', key: 'slack:C1:2.2', state: 'fyi', title: 'Выкатили фикс', lastAt: +at(12) },
      { id: 'c3', key: 'slack:C1:3.3', state: 'fyi', title: 'старое', lastAt: +at(9) },
      { id: 'c4', key: 'clickup:DEV-1', state: 'you', title: 'не Slack', lastAt: +at(12) }
    ]
    write('state.json', { lastRunAt: at(9).toISOString(), seen: {} })
    const off = run(at(14, 2), [draft('a')], ledger)
    expect(await off.posted).toBe(true)
    expect(off.synced[0]?.[0]).toMatchObject({
      title: 'Slack digest 14:00 — 1 for you, 1 quiet',
      body: [
        'Wait for you: 1',
        '• Проверить возвраты',
        'Went by quietly: 1',
        '• Выкатили фикс'
      ].join('\n')
    })
    write('digest-state.json', { slot: '2026-10-17 10', at: at(10).toISOString() })
    write('state.json', { lastRunAt: at(13, 50).toISOString(), seen: {} })
    const on = run(at(14, 2), [draft('a')], ledger)
    expect(await on.posted).toBe(true)
    expect(on.synced[0]?.[0]?.body).toContain('Вера: почини автоответ')
  })
})
