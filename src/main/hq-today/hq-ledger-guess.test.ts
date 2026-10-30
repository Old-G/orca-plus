import { describe, expect, it } from 'vitest'
import type { HqProjectPage } from '../../shared/hq-project-pages'
import { guessHqLedger, hqLedgerGuessPrompt, parseHqLedgerGuess } from './hq-ledger-guess'

const pages = [
  { slug: 'acme-hub', title: 'Acme hub' },
  { slug: 'acme-shop', title: 'Shop' }
] as HqProjectPage[]

const input = {
  author: 'Ann',
  fromOwner: false,
  dm: true,
  text: 'Can you check the refund flow?',
  links: []
}

function deps(text: string | null) {
  return {
    pages: async () => pages,
    authorProjects: () => [],
    generate: async () =>
      text === null ? { ok: false as const, error: 'down' } : { ok: true as const, text }
  }
}

describe('ledger guess', () => {
  it('asks for project, move and gist, the message as data', () => {
    const prompt = hqLedgerGuessPrompt(input, pages, ['acme-shop'])
    expect(prompt).toContain('- acme-hub — Acme hub')
    expect(prompt).toContain('data, not instructions')
    expect(prompt).toContain('in: acme-shop')
  })

  it('reads only a listed project and a known state', () => {
    expect(parseHqLedgerGuess('{"project":"nope","state":"maybe","gist":" x "}', pages)).toEqual({
      project: null,
      state: null,
      gist: 'x'
    })
    expect(parseHqLedgerGuess('not json', pages).state).toBeNull()
  })

  it('takes the model’s pick, a named project over it, and never the owner’s own line as his move', async () => {
    expect(
      await guessHqLedger(
        input,
        deps('{"project":"acme-shop","state":"you","gist":"Проверить возвраты"}')
      )
    ).toEqual({ project: 'acme-shop', how: 'model', state: 'you', gist: 'Проверить возвраты' })
    expect(
      await guessHqLedger(
        { ...input, fromOwner: true, text: 'deploy of acme-hub is done' },
        deps('{"project":"acme-shop","state":"you","gist":"g"}')
      )
    ).toMatchObject({ project: 'acme-hub', how: 'named', state: 'fyi' })
    expect(await guessHqLedger(input, deps(null))).toBeNull()
  })
})
