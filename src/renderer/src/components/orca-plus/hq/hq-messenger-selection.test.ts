import { describe, expect, it } from 'vitest'
import { HQ_PINNED_IDS, hqSelectionForRequest } from './hq-messenger-selection'

describe('hqSelectionForRequest', () => {
  it('opens the Feed for a request to the History it replaced', () => {
    expect(HQ_PINNED_IDS).not.toContain('history')
    expect(hqSelectionForRequest('history')).toEqual({ kind: 'pinned', id: 'feed' })
    expect(hqSelectionForRequest('reports')).toEqual({ kind: 'pinned', id: 'reports' })
    expect(hqSelectionForRequest('chats')).toEqual({ kind: 'chat' })
    expect(hqSelectionForRequest('nope')).toBeNull()
  })
})
