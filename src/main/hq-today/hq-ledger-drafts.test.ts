import { describe, expect, it } from 'vitest'
import type { HqLedgerCardRow } from '../orca-plus/pulse/pulse-ledger-cards'
import type { HqLedgerDraft } from '../orca-plus/pulse/pulse-ledger-draft'
import {
  HQ_LEDGER_DRAFTS_PER_DAY,
  hqLedgerDraftPrompt,
  parseHqLedgerDraft,
  runHqLedgerDrafts,
  type HqLedgerDraftsDeps
} from './hq-ledger-drafts'

const NOW = new Date(2026, 10, 3, 15, 0).getTime()

function card(id: string, ts: string, lastAt: number): HqLedgerCardRow {
  return {
    id,
    key: `slack:D0ANN:${ts}`,
    project: null,
    title: 'Ann asks',
    lastAt,
    messages: [
      { ts, author: 'Ann', authorId: 'U_ANN', text: 'Can you check?', link: null, at: lastAt }
    ]
  }
}

function setup(cards: HqLedgerCardRow[], answer: string | null) {
  const saved = new Map<string, HqLedgerDraft>()
  const prompts: string[] = []
  let made = 0
  const deps: HqLedgerDraftsDeps = {
    enabled: () => true,
    cards: () => cards,
    draftOf: (id) => saved.get(id) ?? null,
    madeSince: () => made,
    lines: () => [{ fromOwner: false, author: 'Ann', text: 'Can you check the """export"""?' }],
    kindOf: () => 'answer',
    tone: async () => 'Short, the point first.',
    generate: async (prompt) => {
      prompts.push(prompt)
      return answer === null ? { ok: false, error: 'down' } : { ok: true, text: answer }
    },
    save: (id, draft) => {
      made += 1
      saved.set(id, draft)
    },
    now: () => NOW
  }
  return { deps, saved, prompts }
}

const ANSWER = '{"kind": "answer", "ask": "Check the export", "draft": "Ann, checking it today."}'

// Custom build (hq-ledger-draft, plan 20.9 step 1).
describe('ledger card drafts', () => {
  it('drafts each waiting talk once for its newest message, newest talk first', async () => {
    const { deps, saved, prompts } = setup(
      [card('a', '1.1', NOW - 60_000), card('b', '2.2', NOW - 1_000)],
      ANSWER
    )
    expect(await runHqLedgerDrafts(deps, new Set())).toBe(2)
    expect([...saved.keys()]).toEqual(['b', 'a'])
    expect(saved.get('a')).toEqual({
      lastTs: '1.1',
      kind: 'answer',
      ask: 'Check the export',
      draft: 'Ann, checking it today.'
    })
    expect(await runHqLedgerDrafts(deps, new Set())).toBe(0)
    expect(prompts).toHaveLength(2)
  })

  it('does not ask again for a draft the model failed, and stops at the day’s limit', async () => {
    const failing = setup([card('a', '1.1', NOW)], null)
    const tried = new Set<string>()
    expect(await runHqLedgerDrafts(failing.deps, tried)).toBe(0)
    expect(await runHqLedgerDrafts(failing.deps, tried)).toBe(0)
    expect(failing.prompts).toHaveLength(1)

    const spent = setup([card('a', '1.1', NOW)], ANSWER)
    const atLimit = { ...spent.deps, madeSince: () => HQ_LEDGER_DRAFTS_PER_DAY }
    expect(await runHqLedgerDrafts(atLimit, new Set())).toBe(0)
    expect(spent.prompts).toHaveLength(0)
  })

  it('quotes the talk safely and carries the tone rules and the first kind', () => {
    const prompt = hqLedgerDraftPrompt(
      [{ fromOwner: false, author: 'Ann', text: 'see """ here' }],
      'a direct message',
      'do',
      'Short.'
    )
    expect(prompt).toContain('Ann: see " here')
    expect(prompt).toContain('read as "do"')
    expect(prompt).toContain('Short.')
  })

  it('reads the model’s answer, and nothing from a kind it does not know', () => {
    expect(
      parseHqLedgerDraft('```json\n{"kind": "fyi", "ask": "News", "draft": ""}\n```', '9.9')
    ).toEqual({ lastTs: '9.9', kind: 'fyi', ask: 'News', draft: null })
    expect(parseHqLedgerDraft('{"kind": "maybe", "ask": "x"}', '9.9')).toBeNull()
    expect(parseHqLedgerDraft('no json', '9.9')).toBeNull()
  })
})
