import { describe, expect, it, vi } from 'vitest'
import { hqIntakeBellItem, type HqIntake } from '../../shared/hq-slack-intake'
import type { HqProjectPage } from '../../shared/hq-project-pages'
import type { PulseBellInput } from '../../shared/pulse-bell'
import { pollHqSlackIntake, type HqSlackIntakeDeps } from './hq-slack-intake'
import { hqIntakeOfConversation } from './hq-ledger-cards'
import {
  guessHqIntake,
  hqIntakeNamedProject,
  parseHqIntakeSuggestion,
  type HqIntakeDraft
} from './hq-slack-intake-suggest'

const NOW = Date.UTC(2026, 9, 21, 18)

function draft(ts: string, overrides: Partial<HqIntakeDraft> = {}): HqIntakeDraft {
  return {
    channel: 'D0AAAAAAAAA',
    ts,
    threadTs: null,
    author: 'Анна',
    authorSlackId: 'U1',
    venue: 'dm',
    text: 'Вот реализация роутов по чату',
    links: [],
    files: [],
    permalink: null,
    at: Math.round(Number(ts) * 1000),
    ...overrides
  }
}

function page(slug: string, repoId: string): HqProjectPage {
  return { repoId, slug, title: slug, status: null, group: null, relations: [] }
}

const pages = [page('support-service', 'r1'), page('phone-bot', 'r2'), page('mcp-server-api', 'r3')]

describe('guessHqIntake', () => {
  it('takes the project a link names over the model and the author', async () => {
    expect(
      hqIntakeNamedProject(
        { text: '', links: ['https://gitlab.com/team/mcp_server_api/-/merge_requests/3'] },
        pages
      )?.slug
    ).toBe('mcp-server-api')
    const guess = await guessHqIntake(
      draft('1792600000.000100', { links: ['https://gitlab.com/team/phone-bot'] }),
      {
        pages: async () => pages,
        authorProjects: () => ['support-service'],
        generate: async () => ({
          ok: true,
          text: '{"project":"support-service","summary":"Роуты"}'
        })
      }
    )
    expect(guess).toEqual({ repoId: 'r2', project: 'phone-bot', summary: 'Роуты' })
  })

  it('falls back to the author’s project and the first line when the model fails', async () => {
    const guess = await guessHqIntake(draft('1792600000.000100'), {
      pages: async () => pages,
      authorProjects: () => ['support-service'],
      generate: async () => ({ ok: false, error: 'offline' })
    })
    expect(guess).toEqual({
      repoId: 'r1',
      project: 'support-service',
      summary: 'Вот реализация роутов по чату'
    })
  })

  it('reads only a slug from the list out of the model’s answer', () => {
    expect(parseHqIntakeSuggestion('Sure: {"project":"nope","summary":"x"}', pages)).toEqual({
      page: null,
      summary: 'x'
    })
  })
})

describe('pollHqSlackIntake', () => {
  function setup(
    drafts: HqIntakeDraft[] | null,
    raised = new Map<string, string | null>(),
    mentioned: () => Promise<HqIntakeDraft[]> = async () => [],
    complete = true
  ) {
    const synced: PulseBellInput[][] = []
    const guess = vi.fn(async () => ({
      repoId: 'r1',
      project: 'support-service',
      summary: 'Роуты'
    }))
    const deps: HqSlackIntakeDeps = {
      read: async (run) =>
        drafts === null ? null : run({ marked: async () => ({ drafts, complete }), mentioned }),
      raised: () => raised,
      guess,
      sync: (_kind, items) => void synced.push([...items]),
      now: () => NOW
    }
    return { deps, synced, guess }
  }

  it('raises each recent mark with a guessed project, and only guesses once per message', async () => {
    const known: HqIntake = {
      ...draft('1792600100.000100'),
      repoId: 'r2',
      project: 'phone-bot',
      summary: 'Уже угадано'
    }
    const old = draft(((NOW - 8 * 24 * 60 * 60_000) / 1000).toFixed(6))
    const { deps, synced, guess } = setup(
      [draft('1792600000.000100'), known, old],
      new Map([[hqIntakeBellItem(known).dedupeKey, hqIntakeBellItem(known).refId ?? null]])
    )
    expect(await pollHqSlackIntake(deps)).toBe(1)
    expect(guess).toHaveBeenCalledTimes(1)
    expect(synced[0]?.map((item) => item.title)).toEqual(['To work: Анна', 'To work: Анна'])
    expect(synced[0]?.[1]?.body).toContain('Уже угадано')
  })

  it('raises a fresh mention and keeps its card once the search no longer returns it', async () => {
    const mention = draft('1792630000.000100', {
      channel: 'C0AAAAAAAAA',
      venue: 'channel',
      via: 'mention'
    })
    const first = setup([], new Map(), async () => [mention])
    await pollHqSlackIntake(first.deps)
    const item = first.synced[0]?.[0]
    expect(item?.title).toBe('To work: Анна mentioned you')

    // Why: a failed search must not cost the 👾 marks either.
    const later = setup(
      [draft('1792600000.000100')],
      new Map([[item?.dedupeKey ?? '', item?.refId ?? null]]),
      async () => {
        throw new Error('missing_scope')
      }
    )
    await pollHqSlackIntake(later.deps)
    expect(later.synced[0]?.map((entry) => entry.title).sort()).toEqual([
      'To work: Анна',
      'To work: Анна mentioned you'
    ])
  })

  it('keeps a raised mark the read missed only while the read is partial', async () => {
    const mark = hqIntakeBellItem({
      ...draft('1792600000.000100'),
      repoId: 'r1',
      project: 'support-service',
      summary: 'Роуты'
    })
    const raised = new Map([[mark.dedupeKey, mark.refId ?? null]])
    const partial = setup([], raised, async () => [], false)
    await pollHqSlackIntake(partial.deps)
    expect(partial.synced[0]?.map((item) => item.dedupeKey)).toEqual([mark.dedupeKey])

    const full = setup([], raised)
    await pollHqSlackIntake(full.deps)
    expect(full.synced[0]).toEqual([])
  })

  it('gives no second card to a mention that already came in as the answer to a waiting', async () => {
    const mention = draft('1792630000.000100', {
      channel: 'C0AAAAAAAAA',
      venue: 'channel',
      via: 'mention'
    })
    const { deps, synced } = setup([], new Map(), async () => [mention])
    deps.answers = () => [{ channel: 'C0AAAAAAAAA', authorSlackId: 'U1', at: mention.at + 30_000 }]
    await pollHqSlackIntake(deps)
    expect(synced[0]).toEqual([])

    // Why: a partial read of the 👾 marks must not bring the answered mention's card back.
    const raised = hqIntakeBellItem({ ...mention, repoId: null, project: null, summary: '' })
    const partial = setup(
      [],
      new Map([[raised.dedupeKey, raised.refId ?? null]]),
      async () => [],
      false
    )
    partial.deps.answers = deps.answers
    await pollHqSlackIntake(partial.deps)
    expect(partial.synced[0]).toEqual([])
  })

  it('folds a burst of one person into one card, and a later one after it was handled into its own', async () => {
    const thread = { channel: 'C0AAAAAAAAA', venue: 'channel' as const, via: 'mention' as const }
    const first = draft('1792630000.000100', { ...thread, text: 'Документы не переехали' })
    const second = draft('1792630120.000100', { ...thread, text: 'Вот эти шесть' })
    const late = draft('1792630420.000100', { ...thread, text: 'Ещё одно' })
    const burst = setup([], new Map(), async () => [second, first])
    expect(await pollHqSlackIntake(burst.deps)).toBe(1)
    expect(burst.synced[0]).toHaveLength(1)
    expect(burst.synced[0]?.[0]?.body).toContain('Вот эти шесть')

    const card = burst.synced[0]?.[0]
    const again = setup([], new Map([[card?.dedupeKey ?? '', card?.refId ?? null]]), async () => [
      late,
      second,
      first
    ])
    again.deps.handled = () => new Set([card?.dedupeKey ?? ''])
    await pollHqSlackIntake(again.deps)
    expect(again.synced[0]).toHaveLength(2)
  })

  it('leaves the bell alone without a token', async () => {
    const { deps, synced } = setup(null)
    await pollHqSlackIntake(deps)
    expect(synced).toEqual([])
  })
})

describe('ledger switched on', () => {
  const row = {
    id: 'c1',
    key: 'slack:C0AAAAAAAAA:1792600000.000100',
    project: 'support-service',
    title: 'Проверить возвраты',
    lastAt: NOW - 60_000,
    messages: [
      {
        ts: '1792600000.000100',
        author: 'Анна',
        authorId: 'U1',
        text: 'Глянь возвраты',
        link: 'https://acme.slack.com/archives/C0AAAAAAAAA/p1792600000000100',
        at: NOW - 120_000
      },
      {
        ts: '1792600060.000100',
        author: 'Анна',
        authorId: 'U1',
        text: 'срочно',
        link: null,
        at: NOW - 60_000
      }
    ]
  }

  it('makes one card per conversation, keyed by its newest message and updated in place', () => {
    const intake = hqIntakeOfConversation(row)
    expect(intake).toMatchObject({
      channel: 'C0AAAAAAAAA',
      threadTs: '1792600000.000100',
      text: 'Анна: Глянь возвраты\nАнна: срочно',
      summary: 'Проверить возвраты',
      conversationId: 'c1'
    })
    const item = hqIntakeBellItem(intake as HqIntake)
    expect(item).toMatchObject({
      title: 'Анна: Проверить возвраты',
      dedupeKey: 'hq-intake:conv:c1:1792600060.000100',
      replaces: 'hq-intake:conv:c1:'
    })
    // Why: a DM talk is answered in the DM, not in a thread under its first line.
    expect(
      hqIntakeOfConversation({
        ...row,
        key: 'slack:D0AAAAAAAAA:1792600000.000100',
        messages: row.messages.map((m) => ({ ...m, link: null }))
      })?.threadTs
    ).toBeNull()
  })

  it('shows the conversation cards in place of mention cards, 👾 marks stay', async () => {
    const synced: PulseBellInput[][] = []
    const mentioned = vi.fn(async () => [draft('1792630000.000100', { via: 'mention' })])
    const oldMention: HqIntake = {
      ...draft('1792620000.000100'),
      via: 'mention',
      repoId: null,
      project: null,
      summary: 'старое'
    }
    const intake = hqIntakeOfConversation(row) as HqIntake
    await pollHqSlackIntake({
      read: async (run) =>
        run({
          marked: async () => ({ drafts: [draft('1792610000.000100')], complete: true }),
          mentioned
        }),
      raised: () =>
        new Map([
          [hqIntakeBellItem(oldMention).dedupeKey, hqIntakeBellItem(oldMention).refId ?? null]
        ]),
      guess: async () => ({ repoId: null, project: null, summary: 'метка' }),
      ledgerCards: () => [intake],
      sync: (_kind, items) => void synced.push([...items]),
      now: () => NOW
    })
    expect(mentioned).not.toHaveBeenCalled()
    expect(synced[0]?.map((item) => item.title)).toEqual([
      'To work: Анна',
      'Анна: Проверить возвраты'
    ])
  })
})
