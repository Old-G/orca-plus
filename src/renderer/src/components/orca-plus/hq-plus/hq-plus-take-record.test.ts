import { describe, expect, it, vi } from 'vitest'

vi.mock('./use-hq-plus-data', () => ({ hqPlusCall: vi.fn() }))

import { hqPlusTakeChat, hqPlusTakeKey } from './hq-plus-take-record'

const item = (kind: string, ref: Record<string, unknown>) => ({
  id: 'item-1',
  kind,
  title: 'Request',
  body: null,
  urgency: 'normal' as const,
  refKind: null,
  refId: JSON.stringify(ref),
  actions: [],
  dedupeKey: null,
  createdAt: 1,
  readAt: null,
  doneAt: null,
  doneAction: null
})

// Custom build (hq-attribution-log, owner 03.11).
describe('what To work records', () => {
  it('names the conversation by the card, else by the place its item names', () => {
    const mention = item('hq-intake', {
      channel: 'C0ACME1234',
      ts: '1700000001.2',
      threadTs: '1700000000.1'
    })

    expect(hqPlusTakeKey(mention, 'clickup:DEV-1')).toBe('clickup:DEV-1')
    expect(hqPlusTakeKey(mention, null)).toBe('slack:C0ACME1234:1700000000.1')
    expect(hqPlusTakeKey(item('decision', {}), null)).toBeNull()
  })

  it('keeps a chat as its session id and a new chat as «new»', () => {
    expect(hqPlusTakeChat('chat:claude_abc')).toBe('claude_abc')
    expect(hqPlusTakeChat('new')).toBe('new')
  })
})
