import { describe, expect, it } from 'vitest'
import type { OutgoingSentContext } from '../../../../../shared/outgoing-approval/outgoing-sent-context'
import { hqSentNames } from './hq-sent-names'

const empty: OutgoingSentContext = {
  service: 'Slack',
  operation: 'send message',
  targetName: null,
  targetId: 'D097YTXQEE8',
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
      hqSentNames({ ...empty, targetName: '#lh-agents', chatName: 'Ядро', replyingTo: 'Женя' })
    ).toEqual({ target: '#lh-agents', chat: 'Ядро', replyingTo: 'Женя' })
  })

  it("reads an older card's first line, and falls back to the raw id", () => {
    expect(
      hqSentNames({
        ...empty,
        head: 'Slack · send message → DM with Женя · in a thread, replying to Женя: «когда?» · from «Выгрузка» (FlowBridge)'
      })
    ).toEqual({ target: 'DM with Женя', chat: 'Выгрузка', replyingTo: 'Женя: «когда?»' })
    expect(hqSentNames(empty)).toEqual({ target: 'D097YTXQEE8', chat: null, replyingTo: null })
  })
})
