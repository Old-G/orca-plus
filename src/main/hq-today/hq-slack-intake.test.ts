import { describe, expect, it, vi } from 'vitest'
import { hqIntakeBellItem, type HqIntake } from '../../shared/hq-slack-intake'
import type { HqProjectPage } from '../../shared/hq-project-pages'
import type { PulseBellInput } from '../../shared/pulse-bell'
import { pollHqSlackIntake, type HqSlackIntakeDeps } from './hq-slack-intake'
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

const pages = [
  page('support-service', 'r1'),
  page('phone-bot', 'r2'),
  page('mcp-server-api', 'r3')
]

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
  function setup(drafts: HqIntakeDraft[] | null, raised = new Map<string, string | null>()) {
    const synced: PulseBellInput[][] = []
    const guess = vi.fn(async () => ({
      repoId: 'r1',
      project: 'support-service',
      summary: 'Роуты'
    }))
    const deps: HqSlackIntakeDeps = {
      read: async (run) => (drafts === null ? null : run({ marked: async () => drafts })),
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

  it('leaves the bell alone without a token', async () => {
    const { deps, synced } = setup(null)
    await pollHqSlackIntake(deps)
    expect(synced).toEqual([])
  })
})
