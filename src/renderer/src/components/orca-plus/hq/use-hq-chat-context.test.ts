import { describe, expect, it } from 'vitest'
import { hqChatTask } from './use-hq-chat-context'

describe('hqChatTask', () => {
  it("reads the workspace's own ClickUp link", () => {
    expect(
      hqChatTask(
        {
          id: 'wt-1',
          linkedWorkItem: {
            provider: 'clickup',
            type: 'issue',
            number: 0,
            title: 'DEV-1043 Fix refunds',
            url: 'https://app.clickup.com/t/abc',
            clickupIdentifier: 'DEV-1043'
          }
        },
        undefined
      )
    ).toEqual({ label: 'DEV-1043', title: 'Fix refunds', url: 'https://app.clickup.com/t/abc' })
  })

  it("falls back to the task HQ's «Take» started the workspace from", () => {
    expect(
      hqChatTask(
        { id: 'wt-2', linkedWorkItem: null },
        {
          other: { decision: 'taken', at: 1, worktreeId: 'wt-9' },
          hidden: { decision: 'hidden', at: 1, worktreeId: 'wt-2' },
          '86c0x': { decision: 'taken', at: 2, worktreeId: 'wt-2' }
        }
      )
    ).toEqual({ label: 'ClickUp 86c0x', title: null, url: 'https://app.clickup.com/t/86c0x' })
    expect(hqChatTask({ id: 'wt-3', linkedWorkItem: null }, {})).toBeNull()
  })
})
