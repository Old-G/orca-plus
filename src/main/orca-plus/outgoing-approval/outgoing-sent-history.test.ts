import { afterEach, describe, expect, it } from 'vitest'
import { outgoingApprovalBellItem } from '../../../shared/outgoing-approval/outgoing-approval-bell'
import { outgoingSentContext } from '../../../shared/outgoing-approval/outgoing-sent-context'
import { PulseDb } from '../pulse/pulse-db'
import { backfillLegacySentContext, withLegacySentContext } from './outgoing-sent-history'

const open: PulseDb[] = []

afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function setup() {
  let tick = 1_000_000
  let id = 0
  const db = new PulseDb(':memory:', { now: () => (tick += 1_000), newId: () => `id-${++id}` })
  open.push(db)
  const call = {
    agent: 'claude',
    toolName: 'mcp__claude_ai_Slack__slack_send_message',
    toolInput: { channel_id: 'D097YTXQEE8', message: 'Женя, выгрузка готова?', thread_ts: '1.5' },
    toolUseId: 't1',
    sessionId: 's1',
    cwd: '/Users/me/Projects/FlowBridge',
    paneKey: null,
    agentSessionId: 'chat-1',
    service: 'Slack',
    operation: 'send message',
    editField: 'message'
  }
  const { record: draft } = db.addDraft({
    kind: 'message',
    target: 'D097YTXQEE8',
    title: 'Slack · send message',
    body: 'Женя, выгрузка готова?',
    source: 'gate',
    call
  })
  return { db, draft }
}

describe('sent history', () => {
  it('keeps where an approved call went and who sent it with the decision', () => {
    const { db, draft } = setup()
    const { decision } = db.decideDraft(
      draft.id,
      'approved',
      undefined,
      outgoingSentContext(
        draft,
        { targetName: 'DM with Женя', chatName: 'Выгрузка', replyingTo: 'Женя: «когда?»' },
        { worktreeId: 'wt-1' }
      )
    )
    expect(db.listDecisions()[0]?.sentContext).toMatchObject({
      targetName: 'DM with Женя',
      threadTs: '1.5',
      chatName: 'Выгрузка',
      agentSessionId: 'chat-1',
      worktreeId: 'wt-1',
      project: 'FlowBridge'
    })
    expect(decision.sentContext?.replyingTo).toBe('Женя: «когда?»')
  })

  it('gives an older approval its context back from the call and its card', () => {
    const { db, draft } = setup()
    db.addInboxItem(
      outgoingApprovalBellItem(draft, { targetName: 'DM with Женя', chatName: 'Выгрузка' })
    )
    db.decideDraft(draft.id, 'approved')
    const [decision] = withLegacySentContext(db.listDecisions(), {
      getDraft: (id) => db.getDraft(id),
      approvalCards: (since) =>
        db.listInbox({ includeDone: true, kind: 'outgoing-approval', since })
    })
    expect(decision?.sentContext).toMatchObject({
      project: 'FlowBridge',
      agentSessionId: 'chat-1',
      threadTs: '1.5',
      head: 'Slack · send message → DM with Женя · in a thread · from «Выгрузка» (FlowBridge)'
    })
  })

  it('names an older approval once, the way a card names a new call, and keeps it', async () => {
    const { db, draft } = setup()
    db.addInboxItem(outgoingApprovalBellItem(draft))
    db.decideDraft(draft.id, 'approved')
    const sources = {
      getDraft: (id: string) => db.getDraft(id),
      approvalCards: (since: number) =>
        db.listInbox({ includeDone: true, kind: 'outgoing-approval', since }),
      describe: async () => ({ targetName: 'DM with Женя', chatName: 'Выгрузка' }),
      workspaceOf: () => 'wt-1',
      save: (id: string, context: Parameters<PulseDb['setDecisionContext']>[1]) =>
        db.setDecisionContext(id, context)
    }
    expect(await backfillLegacySentContext(db.listDecisions(), sources)).toBe(1)
    expect(db.listDecisions()[0]?.sentContext).toMatchObject({
      targetName: 'DM with Женя',
      chatName: 'Выгрузка',
      worktreeId: 'wt-1',
      threadTs: '1.5',
      head: 'Slack · send message → D097YTXQEE8 · in a thread · from FlowBridge'
    })
    expect(await backfillLegacySentContext(db.listDecisions(), sources)).toBe(0)
  })

  it('leaves an older approval to retry when nothing could be named', async () => {
    const { db, draft } = setup()
    db.decideDraft(draft.id, 'approved')
    const saved = await backfillLegacySentContext(db.listDecisions(), {
      getDraft: (id) => db.getDraft(id),
      approvalCards: () => [],
      describe: async () => ({}),
      workspaceOf: () => null,
      save: (id, context) => db.setDecisionContext(id, context)
    })
    expect(saved).toBe(0)
    expect(db.listDecisions()[0]?.sentContext).toBeNull()
  })
})
