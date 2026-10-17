import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../pulse/pulse-db'
import { OutgoingApprovalGate, type GateReply } from './outgoing-approval-gate'
import { decideOutgoingCall, outgoingApprovalOptions } from './outgoing-approval-decide'
import { MovedApprovals } from './outgoing-moved-approvals'

const open: PulseDb[] = []

afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

const task = { id: 'DEV-18114', url: 'https://app.clickup.com/t/9/DEV-18114', name: 'Эталоны' }
const text = 'Женя, эталоны T3-D1 готовы, глянь пожалуйста до пятницы?'

function setup() {
  const db = new PulseDb(':memory:')
  open.push(db)
  const gate = new OutgoingApprovalGate({ db: () => db, holdMs: 10 })
  const moved = new MovedApprovals()
  const deps = {
    gate,
    context: () => ({ chatName: 'Ядро lh-agents', task }),
    workspaceOf: () => 'wt-1',
    moved,
    decisions: (limit: number) => db.listDecisions({ kind: 'approval', limit }),
    waitings: () => db.listWaitings()
  }
  const submit = (toolName: string, toolInput: Record<string, unknown>, toolUseId: string) => {
    const reply = gate.submit({
      hook: {
        session_id: 's1',
        cwd: '/p/lh-agents',
        hook_event_name: 'PreToolUse',
        tool_name: toolName,
        tool_input: toolInput,
        tool_use_id: toolUseId
      },
      agent: 'claude',
      paneKey: null,
      agentSessionId: 'chat-1'
    })
    if (reply.state !== 'pending') {
      throw new Error(`expected pending, got ${reply.state}`)
    }
    return reply.id
  }
  return { db, gate, moved, deps, submit }
}

function hookOutput(reply: GateReply) {
  if (reply.state !== 'final') {
    throw new Error(`expected final, got ${reply.state}`)
  }
  return reply.output.hookSpecificOutput
}

describe('decideOutgoingCall', () => {
  it('offers the footer and the task, and sends the footer with Approve', async () => {
    const { db, gate, deps, submit } = setup()
    const id = submit(
      'mcp__claude_ai_Slack__slack_send_message',
      { channel_id: 'C0BTX61L83T', message: text },
      't1'
    )
    const draft = gate.pending()[0]
    const options = outgoingApprovalOptions(draft, deps.context(), deps)
    expect(options.footer).toBe(
      `↳ [DEV-18114](${task.url}) · lh-agents · «Ядро lh-agents» · ref ${id.replace(/-/g, '').slice(0, 6)}`
    )
    expect(options.move).toEqual({ to: 'clickup', task })
    decideOutgoingCall(deps, id, 'approved', undefined, {})
    const sent = hookOutput(await gate.wait(id)).updatedInput
    expect(sent).toMatchObject({ message: `${text}\n\n_${options.footer}_` })
    expect(db.listDecisions()[0]?.sentContext).toMatchObject({
      taskId: 'DEV-18114',
      footer: options.footer,
      movedTo: null
    })
  })

  it('moves a Slack message to the task, and lets the agent comment through once', async () => {
    const { db, gate, deps, submit } = setup()
    const id = submit(
      'mcp__claude_ai_Slack__slack_send_message',
      { channel_id: 'C0BTX61L83T', message: text },
      't1'
    )
    expect(decideOutgoingCall(deps, id, 'approved', undefined, { moveTo: 'clickup' }).outcome).toBe(
      'rejected'
    )
    const told = hookOutput(await gate.wait(id))
    expect(told.permissionDecision).toBe('deny')
    expect(told.permissionDecisionReason).toContain('entity_id DEV-18114')
    expect(db.listDecisions()[0]?.sentContext?.movedTo).toBe('clickup')

    const commentId = submit(
      'mcp__claude_ai_ClickUp__clickup_create_comment',
      { entity_id: 'DEV-18114', comment_text: `[@Женя](#user_mention#81344), ${text}` },
      't2'
    )
    const comment = gate.pending().find((held) => held.id === commentId)
    expect(comment && deps.moved.take(comment)).toEqual({ footer: true })
  })

  it('refuses a move the card did not offer', () => {
    const { deps, submit } = setup()
    const id = submit(
      'mcp__claude_ai_Slack__slack_send_message',
      { channel_id: 'C0BTX61L83T', message: text },
      't1'
    )
    expect(() => decideOutgoingCall(deps, id, 'approved', undefined, { moveTo: 'slack' })).toThrow(
      /cannot be moved/
    )
  })
})
