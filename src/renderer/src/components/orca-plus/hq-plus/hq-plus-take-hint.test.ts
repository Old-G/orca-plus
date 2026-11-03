import { describe, expect, it } from 'vitest'
import { hqPlusTakeHint, hqPlusTakeHintRepo, noteHqPlusTakeHint } from './hq-plus-take-hint'

describe('To work picks the project and chat the card showed', () => {
  it('lets the conversation fill what a folded part did not know', () => {
    noteHqPlusTakeHint('item-1', { project: null, sessionId: 'claude_part' })
    noteHqPlusTakeHint('item-1', { project: 'acme-api', sessionId: null })

    expect(hqPlusTakeHint('item-1')).toEqual({
      project: 'acme-api',
      sessionId: 'claude_part',
      key: null,
      guess: null
    })
    expect(hqPlusTakeHint('item-2')).toBeNull()
  })

  // Custom build (hq-attribution-log): the conversation's key reaches the guess → final log.
  it('keeps the conversation key the card named', () => {
    noteHqPlusTakeHint('item-3', { project: null, sessionId: null })
    noteHqPlusTakeHint('item-3', {
      project: 'acme-api',
      sessionId: null,
      key: 'slack:C0ACME:1700000000.1'
    })

    expect(hqPlusTakeHint('item-3')?.key).toBe('slack:C0ACME:1700000000.1')
  })

  it('finds the repo by HQ page slug, else by the project name in Orca', () => {
    const pages = [{ slug: 'acme-api', repoId: 'repo-1' }]
    const repos = [
      { id: 'repo-1', displayName: 'acme_api' },
      { id: 'repo-2', displayName: 'acme-web' }
    ]

    expect(hqPlusTakeHintRepo('acme-api', pages, repos)).toBe('repo-1')
    expect(hqPlusTakeHintRepo('acme-web', pages, repos)).toBe('repo-2')
    expect(hqPlusTakeHintRepo('nope', pages, repos)).toBeNull()
    expect(hqPlusTakeHintRepo(null, pages, repos)).toBeNull()
  })
})
