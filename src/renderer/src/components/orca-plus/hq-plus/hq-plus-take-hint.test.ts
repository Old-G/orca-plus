import { describe, expect, it } from 'vitest'
import {
  hqPlusTakeChatChoice,
  hqPlusTakeHint,
  hqPlusTakeHintRepo,
  noteHqPlusTakeHint
} from './hq-plus-take-hint'

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

// Custom build (A8, 28.11): a card whose work a chat already carries opens that chat, not a new one.
describe('To work opens the chat already carrying the work', () => {
  const open = ['claude_old', 'claude_live']
  it('prefers the registry’s live chat over the one the card named (a handoff moved on)', () => {
    expect(
      hqPlusTakeChatChoice({
        loaded: null,
        hinted: 'claude_old',
        live: 'claude_live',
        openSessionIds: open
      })
    ).toEqual({ sessionId: 'claude_live', fromLive: true })
  })
  it('falls back to the card’s chat when the registry knows none, and to a new chat when it is not open', () => {
    expect(
      hqPlusTakeChatChoice({ loaded: null, hinted: 'claude_old', live: null, openSessionIds: open })
    ).toEqual({ sessionId: 'claude_old', fromLive: false })
    expect(
      hqPlusTakeChatChoice({
        loaded: null,
        hinted: 'claude_gone',
        live: 'claude_closed',
        openSessionIds: open
      })
    ).toEqual({ sessionId: null, fromLive: false })
  })
  it('leaves the chat a person’s answer named to the request itself', () => {
    expect(
      hqPlusTakeChatChoice({
        loaded: 'asked',
        hinted: 'claude_old',
        live: 'claude_live',
        openSessionIds: open
      })
    ).toEqual({ sessionId: null, fromLive: false })
  })
})
