import { afterEach, describe, expect, it, vi } from 'vitest'
import { PulseDb } from '../pulse/pulse-db'
import { OutgoingApprovalGate } from './outgoing-approval-gate'
import { untaggedClickUpNudge } from './outgoing-untagged-nudge'

vi.mock('../../clickup/clickup-tasks', () => ({ getClickUpViewerId: async () => '1' }))

const open: PulseDb[] = []
afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function commentHook(text: string, toolUseId: string) {
  return {
    hook: {
      session_id: 'sess-1',
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__claude_ai_ClickUp__clickup_create_comment',
      tool_input: { entity_id: 'DEV-1', comment_text: text },
      tool_use_id: toolUseId
    },
    agent: 'claude',
    paneKey: null,
    agentSessionId: null
  }
}

function setup() {
  const db = new PulseDb(':memory:')
  open.push(db)
  db.upsertPerson({ name: 'Лиза', clickupUserId: '91000001' })
  db.upsertPerson({ name: 'владелец', clickupUserId: '1' })
  const gate = new OutgoingApprovalGate({
    db: () => db,
    nudge: untaggedClickUpNudge(() => db.listPeople())
  })
  return { gate, db }
}

describe('untagged ClickUp nudge', () => {
  it('hands an untagged comment back once, then lets the same call through', async () => {
    const { gate } = setup()
    await Promise.resolve()
    const first = gate.submit(commentHook('Ждём от Лизы эталоны', 'toolu_1'))
    expect(first.state).toBe('final')
    const reason =
      first.state === 'final'
        ? String(first.output.hookSpecificOutput.permissionDecisionReason)
        : ''
    expect(reason).toContain('[@Лиза](#user_mention#91000001)')
    expect(gate.submit(commentHook('Ждём от Лизы эталоны', 'toolu_2'))).toEqual({
      state: 'pass'
    })
  })

  it('holds the tagged retry for approval as a message to a person', () => {
    const { gate } = setup()
    const reply = gate.submit(
      commentHook('Ждём от [@Лиза](#user_mention#91000001) эталоны', 'toolu_3')
    )
    expect(reply.state).toBe('pending')
  })

  it('does not nudge a comment naming only the owner', async () => {
    const { gate } = setup()
    await Promise.resolve()
    expect(gate.submit(commentHook('владелец проверил', 'toolu_4'))).toEqual({ state: 'pass' })
  })
})
