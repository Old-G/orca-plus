import { describe, expect, it } from 'vitest'
import type { OutgoingSentContext } from '../../../../../shared/outgoing-approval/outgoing-sent-context'
import { hqSentNames } from './hq-sent-names'

const empty: OutgoingSentContext = {
  service: 'Slack',
  operation: 'send message',
  targetName: null,
  targetId: 'D0AAAAAAAAA',
  threadTs: null,
  replyingTo: null,
  chatName: null,
  agentSessionId: null,
  worktreeId: null,
  project: null,
  head: null,
  taskId: null,
  taskUrl: null,
  taskName: null,
  ref: null,
  footer: null
}

describe('hqSentNames', () => {
  it('prefers the kept names', () => {
    expect(
      hqSentNames({ ...empty, targetName: '#acme-agents', chatName: 'Ядро', replyingTo: 'Петя' })
    ).toEqual({ target: '#acme-agents', chat: 'Ядро', replyingTo: 'Петя' })
  })

  it("reads an older card's first line, and falls back to the raw id", () => {
    expect(
      hqSentNames({
        ...empty,
        head: 'Slack · send message → DM with Петя · in a thread, replying to Петя: «когда?» · from «Выгрузка» (Billing)'
      })
    ).toEqual({ target: 'DM with Петя', chat: 'Выгрузка', replyingTo: 'Петя: «когда?»' })
    expect(hqSentNames(empty)).toEqual({ target: 'D0AAAAAAAAA', chat: null, replyingTo: null })
  })
})
