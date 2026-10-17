import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hqDigestSlot } from '../../shared/hq-slack-digest'
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

function run(now: Date, drafts: HqSlackScoutDraft[] = []) {
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
    now: () => now
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
})
