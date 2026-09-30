import { afterEach, describe, expect, it } from 'vitest'
import type { NotificationDispatchRequest } from '../../../shared/notification-settings-types'
import { readPulseBellPaneRef } from '../../../shared/pulse-bell'
import { PulseDb } from '../pulse/pulse-db'
import {
  bindAgentFinishedInbox,
  clearAgentFinished,
  finishedAgentFromNotification,
  recordAgentFinished
} from './pulse-bell-agent-finished'

const CHAT_PANE = 'structured-agent-session-claude_ab12:7010ec49-76b3-444d-a145-21eb222e5743'

function finished(
  overrides: Partial<NotificationDispatchRequest> = {}
): NotificationDispatchRequest {
  return {
    source: 'agent-task-complete',
    surface: 'agent-session',
    paneKey: CHAT_PANE,
    worktreeId: 'repo-1::/Users/g/support-bot',
    repoLabel: 'support-bot',
    worktreeLabel: 'docs-refresh',
    terminalTitle: 'Docs refresh',
    agentType: 'claude',
    agentState: 'done',
    agentLastAssistantMessage: 'Готово: wiki обновлена,\n  тесты зелёные.',
    ...overrides
  }
}

let db: PulseDb | null = null

function bindDb(): PulseDb {
  db = new PulseDb(':memory:')
  const target = db
  bindAgentFinishedInbox({
    list: () => target.listInbox(),
    add: (input) => void target.addInboxItem(input),
    markDone: (id, action) => void target.markInboxDone(id, action)
  })
  return target
}

afterEach(() => {
  bindAgentFinishedInbox(null)
  db?.close()
  db = null
})

describe('finishedAgentFromNotification', () => {
  it('names the agent, project, worktree and chat', () => {
    expect(finishedAgentFromNotification(finished())).toEqual({
      paneKey: CHAT_PANE,
      worktreeId: 'repo-1::/Users/g/support-bot',
      agentLabel: 'Claude',
      place: 'support-bot / docs-refresh',
      sessionTitle: 'Docs refresh',
      lastMessage: 'Готово: wiki обновлена,\n  тесты зелёные.'
    })
  })

  it('shows one label when the worktree is the repo itself', () => {
    expect(finishedAgentFromNotification(finished({ worktreeLabel: 'support-bot' }))?.place).toBe(
      'support-bot'
    )
  })

  it('skips waiting, blocked, bells and pane-less requests', () => {
    expect(finishedAgentFromNotification(finished({ agentState: 'blocked' }))).toBeNull()
    expect(finishedAgentFromNotification(finished({ agentState: 'waiting' }))).toBeNull()
    expect(finishedAgentFromNotification(finished({ source: 'terminal-bell' }))).toBeNull()
    expect(finishedAgentFromNotification(finished({ paneKey: undefined }))).toBeNull()
  })
})

describe('agent-finished inbox items', () => {
  it('adds an item that says who finished and opens their pane', () => {
    const inbox = bindDb()
    recordAgentFinished(finished())
    const [item] = inbox.listInbox()
    expect(item).toMatchObject({
      kind: 'agent-finished',
      title: 'An agent finished',
      body: 'Claude · support-bot / docs-refresh · Docs refresh — Готово: wiki обновлена, тесты зелёные.',
      urgency: 'normal'
    })
    expect(item.actions.map((action) => action.id)).toEqual(['open', 'dismiss'])
    expect(readPulseBellPaneRef(item.refId)).toEqual({
      paneKey: CHAT_PANE,
      tabId: 'structured-agent-session-claude_ab12',
      worktreeId: 'repo-1::/Users/g/support-bot'
    })
  })

  it('keeps one open item per pane, showing the latest finish', () => {
    const inbox = bindDb()
    recordAgentFinished(finished({ agentLastAssistantMessage: 'first' }))
    recordAgentFinished(finished({ agentLastAssistantMessage: 'second' }))
    expect(inbox.listInbox().map((item) => item.body)).toEqual([
      'Claude · support-bot / docs-refresh · Docs refresh — second'
    ])
  })

  it('closes the item when the agent works again or the pane is seen', () => {
    const inbox = bindDb()
    recordAgentFinished(finished())
    recordAgentFinished(
      finished({ paneKey: 'tab-2:leaf-2', terminalTitle: 'Codex', agentType: 'codex' })
    )
    clearAgentFinished([CHAT_PANE], 'gone')
    expect(inbox.listInbox().map((item) => item.dedupeKey)).toEqual(['agent-finished:tab-2:leaf-2'])
    clearAgentFinished(['tab-2:leaf-2'], 'seen')
    expect(inbox.listInbox()).toEqual([])
    expect(
      inbox
        .listInbox({ includeDone: true })
        .map((item) => item.doneAction)
        .sort()
    ).toEqual(['gone', 'seen'])
  })

  it('keeps the item when the working status is the finished turn re-published late', () => {
    const inbox = bindDb()
    recordAgentFinished(finished())
    const [item] = inbox.listInbox()
    clearAgentFinished([CHAT_PANE], 'gone', item.createdAt - 5_000)
    expect(inbox.listInbox().map((open) => open.id)).toEqual([item.id])
    clearAgentFinished([CHAT_PANE], 'gone', item.createdAt + 1)
    expect(inbox.listInbox()).toEqual([])
  })

  it('does nothing before the bell is bound', () => {
    expect(() => recordAgentFinished(finished())).not.toThrow()
  })
})
