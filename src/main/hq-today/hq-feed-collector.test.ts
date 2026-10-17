import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HqFeedItem } from '../../shared/hq-feed'
import type { PulseDecision } from '../../shared/pulse-types'
import { collectHqFeed } from './hq-feed-collector'

const NOW = Date.parse('2026-10-17T12:00:00Z')
let hq: string

beforeEach(() => {
  hq = mkdtempSync(join(tmpdir(), 'hq-feed-'))
  mkdirSync(join(hq, 'slack-scout'))
})
afterEach(() => rmSync(hq, { recursive: true, force: true }))

function write(name: string, value: unknown): void {
  writeFileSync(join(hq, 'slack-scout', name), JSON.stringify(value))
}

const decision = (over: Partial<PulseDecision>): PulseDecision => ({
  id: 'd1',
  kind: 'approval',
  title: 'Slack · send message',
  body: 'Петя, готово',
  outcome: 'approved',
  project: null,
  personId: null,
  draftId: null,
  source: 'outgoing-approval',
  decidedAt: NOW - 1_000,
  mirroredPath: null,
  sentContext: null,
  ...over
})

describe('collectHqFeed', () => {
  it('turns every source into feed rows with person and project, skipping what was not sent', async () => {
    write('drafts.json', {
      drafts: [
        {
          id: 'D1:1.1',
          channelName: 'DM Вера',
          author: 'Вера',
          permalink: 'https://lev.slack.com/archives/D1/p11',
          quote: 'проверь тикеты',
          ask: 'Проверь тикеты',
          title: 'Тикеты',
          description: '',
          project: 'zenith',
          foundAt: '2026-10-17T10:00:00Z'
        }
      ]
    })
    write('topics.json', {
      topics: {
        T1: {
          id: 'T1',
          subject: 'Возвраты',
          summary: 'ждём Веру',
          people: ['Вера'],
          lastAt: '2026-10-17T11:00:00Z'
        }
      }
    })
    write('quiet.json', {
      items: [
        {
          id: 'q1',
          at: '2026-10-17T09:00:00Z',
          summary: 'Выкатили бота',
          author: 'Олег',
          permalink: 'javascript:alert(1)'
        }
      ]
    })
    write('clickup-own.json', {
      comments: [
        {
          link: 'https://app.clickup.com/t/a?comment=1',
          task: 'DEV-1 Голос',
          to: 'Петя',
          text: 'Сделаю',
          at: NOW - 5_000
        }
      ]
    })
    const upserted: HqFeedItem[][] = []
    await collectHqFeed({
      hqPath: () => hq,
      decisions: () => [decision({}), decision({ id: 'd2', outcome: 'rejected' })],
      reviews: async () => [
        {
          provider: 'gitlab',
          ref: 'acme/zenith!12',
          title: 'Fix refunds',
          url: 'https://gitlab.com/acme/zenith/-/merge_requests/12',
          author: 'Олег',
          draft: false,
          updatedAt: NOW - 2_000
        }
      ],
      upsert: (items) => upserted.push(items),
      now: () => NOW
    })
    const byId = Object.fromEntries(upserted[0].map((row) => [row.id, row]))
    expect(Object.keys(byId).sort()).toEqual([
      'clickup-own:https://app.clickup.com/t/a?comment=1',
      'git:https://gitlab.com/acme/zenith/-/merge_requests/12',
      'orca:d1',
      'request:D1:1.1',
      'slack-fyi:q1',
      'slack:T1'
    ])
    expect(byId['request:D1:1.1']).toMatchObject({
      source: 'slack',
      person: 'Вера',
      project: 'zenith'
    })
    expect(byId['slack:T1']).toMatchObject({ kind: 'conversation', person: 'Вера' })
    expect(byId['slack-fyi:q1'].url).toBeNull()
    expect(byId['clickup-own:https://app.clickup.com/t/a?comment=1']).toMatchObject({
      person: 'Петя'
    })
    expect(byId['git:https://gitlab.com/acme/zenith/-/merge_requests/12'].project).toBe(
      'acme/zenith'
    )
  })

  it('still lands the files when the reviews cannot be read, and nothing without HQ', async () => {
    const upserted: HqFeedItem[][] = []
    const deps = {
      decisions: () => [],
      reviews: async () => {
        throw new Error('gh down')
      },
      upsert: (items: HqFeedItem[]) => upserted.push(items),
      now: () => NOW
    }
    write('topics.json', { topics: { T1: { id: 'T1', subject: 'Возвраты' } } })
    await collectHqFeed({ ...deps, hqPath: () => hq })
    await collectHqFeed({ ...deps, hqPath: () => null })
    expect(upserted.map((items) => items.length)).toEqual([1, 0])
  })
})
