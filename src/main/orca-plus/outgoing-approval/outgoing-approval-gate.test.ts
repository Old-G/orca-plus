import { afterEach, describe, expect, it } from 'vitest'
import { PulseDb } from '../pulse/pulse-db'
import { OutgoingApprovalGate, type GateReply } from './outgoing-approval-gate'

const open: PulseDb[] = []

afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

function setup(options: { holdMs?: number; abandonAfterMs?: number } = {}) {
  let now = 1_000_000
  const db = new PulseDb(':memory:')
  open.push(db)
  let changes = 0
  const gate = new OutgoingApprovalGate({
    db: () => db,
    now: () => now,
    holdMs: options.holdMs ?? 1_000,
    abandonAfterMs: options.abandonAfterMs,
    onChanged: () => {
      changes += 1
    }
  })
  return {
    db,
    gate,
    advance: (ms: number) => {
      now += ms
    },
    changes: () => changes
  }
}

function slackHook(toolUseId = 'toolu_1') {
  return {
    hook: {
      session_id: 'sess-1',
      cwd: '/repo',
      hook_event_name: 'PreToolUse',
      tool_name: 'mcp__claude_ai_Slack__slack_send_message',
      tool_input: { channel_id: 'D1', message: 'Привет, Анна' },
      tool_use_id: toolUseId
    },
    agent: 'claude',
    paneKey: 'tab-1:leaf-1',
    agentSessionId: null
  }
}

function pendingId(reply: GateReply): string {
  if (reply.state !== 'pending') {
    throw new Error(`expected pending, got ${reply.state}`)
  }
  return reply.id
}

function output(reply: GateReply) {
  if (reply.state !== 'final') {
    throw new Error(`expected final, got ${reply.state}`)
  }
  return reply.output.hookSpecificOutput
}

describe('OutgoingApprovalGate', () => {
  it('lets a push to main through and holds a force push', () => {
    const { gate } = setup()
    const push = (command: string, toolUseId: string) =>
      gate.submit({
        ...slackHook(toolUseId),
        hook: {
          session_id: 'sess-1',
          hook_event_name: 'PreToolUse',
          tool_name: 'Bash',
          tool_input: { command },
          tool_use_id: toolUseId
        }
      })

    expect(push('git push origin main', 'toolu_a')).toEqual({ state: 'pass' })
    expect(push('git push --force origin main', 'toolu_b').state).toBe('pending')
  })

  it('passes calls that do not leave the machine', () => {
    const { gate, db } = setup()
    const reply = gate.submit({
      ...slackHook(),
      hook: {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'git status' }
      }
    })
    expect(reply).toEqual({ state: 'pass' })
    expect(db.listDrafts()).toEqual([])
  })

  it('passes non-PreToolUse payloads and malformed input', () => {
    const { gate } = setup()
    expect(gate.submit({ ...slackHook(), hook: { hook_event_name: 'PostToolUse' } })).toEqual({
      state: 'pass'
    })
    expect(gate.submit({ ...slackHook(), hook: 'not json' })).toEqual({ state: 'pass' })
  })

  it('holds an outgoing call as a pending draft with the call attached', () => {
    const { gate, db, changes } = setup()
    const id = pendingId(gate.submit(slackHook()))
    const draft = db.getDraft(id)
    expect(draft).toMatchObject({
      kind: 'message',
      status: 'pending',
      source: 'gate',
      target: 'D1',
      body: 'Привет, Анна',
      title: 'Slack · send message'
    })
    expect(draft?.call).toMatchObject({
      toolUseId: 'toolu_1',
      paneKey: 'tab-1:leaf-1',
      editField: 'message'
    })
    expect(changes()).toBe(1)
    expect(gate.pending().map((d) => d.id)).toEqual([id])
  })

  it('finds the same draft when the hook re-submits after a reconnect', () => {
    const { gate, db } = setup()
    const first = pendingId(gate.submit(slackHook()))
    expect(pendingId(gate.submit(slackHook()))).toBe(first)
    expect(db.listDrafts()).toHaveLength(1)
  })

  it('answers a waiting hook with allow once approved, and records the approval', async () => {
    const { gate, db } = setup({ holdMs: 60_000 })
    const id = pendingId(gate.submit(slackHook()))
    const waiting = gate.wait(id)
    gate.decide(id, 'approved')
    const hook = output(await waiting)
    expect(hook).toMatchObject({
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: 'The user approved this action in the Orca+ bell.'
    })
    expect(String(hook.additionalContext)).toMatch(
      /pulse wait add --direction on-them[\s\S]*message link from the tool result[\s\S]*channel is D1/
    )
    expect(db.getDraft(id)?.status).toBe('sent')
    expect(db.listDecisions().map((d) => [d.kind, d.outcome, d.draftId])).toEqual([
      ['approval', 'approved', id]
    ])
  })

  it('names the thread an approved reply waits in, and adds nothing to other services', async () => {
    const { gate } = setup()
    const threaded = slackHook('toolu_t')
    const id = pendingId(
      gate.submit({
        ...threaded,
        hook: {
          ...threaded.hook,
          tool_input: { ...threaded.hook.tool_input, thread_ts: '1700.0001' }
        }
      })
    )
    gate.decide(id, 'approved')
    expect(String(output(await gate.wait(id)).additionalContext)).toMatch(
      /--source-ref "slack:D1:1700\.0001"/
    )
    const comment = pendingId(
      gate.submit({
        ...slackHook('toolu_c'),
        hook: {
          ...slackHook('toolu_c').hook,
          tool_name: 'mcp__claude_ai_Gmail__send_message',
          tool_input: { to: 'ann@example.com', body: 'Готово' }
        }
      })
    )
    gate.decide(comment, 'approved')
    expect(output(await gate.wait(comment)).additionalContext).toBeUndefined()
  })

  it('runs the edited text in place of the original field', async () => {
    const { gate } = setup()
    const id = pendingId(gate.submit(slackHook()))
    gate.decide(id, 'edited', 'Привет! Напоминаю про макеты.')
    expect(output(await gate.wait(id)).updatedInput).toEqual({
      channel_id: 'D1',
      message: 'Привет! Напоминаю про макеты.'
    })
  })

  it('ends an approved message with its footer, without calling it an edit', async () => {
    const { gate } = setup()
    const id = pendingId(gate.submit(slackHook()))
    gate.decide(id, 'approved', undefined, undefined, { footer: '↳ hub · ref abc123' })
    const answer = output(await gate.wait(id))
    expect(answer.updatedInput).toEqual({
      channel_id: 'D1',
      message: 'Привет, Анна\n\n_↳ hub · ref abc123_'
    })
    expect(answer.permissionDecisionReason).toBe('The user approved this action in the Orca+ bell.')
  })

  it('puts an approved message into the thread the owner picked', async () => {
    const { gate } = setup()
    const id = pendingId(gate.submit(slackHook()))
    gate.decide(id, 'approved', undefined, undefined, { threadTs: '1792156555.418929' })
    expect(output(await gate.wait(id)).updatedInput).toEqual({
      channel_id: 'D1',
      message: 'Привет, Анна',
      thread_ts: '1792156555.418929'
    })
  })

  it('tells the agent where to send a moved message instead of «rejected»', async () => {
    const { gate } = setup()
    const id = pendingId(gate.submit(slackHook()))
    gate.decide(id, 'rejected', undefined, undefined, { denyReason: 'Post it in DEV-1 instead.' })
    const answer = output(await gate.wait(id))
    expect(answer.permissionDecision).toBe('deny')
    expect(answer.permissionDecisionReason).toBe('Post it in DEV-1 instead.')
  })

  it('denies a rejected call and tells the agent not to retry', async () => {
    const { gate, db } = setup()
    const id = pendingId(gate.submit(slackHook()))
    gate.decide(id, 'rejected')
    const hook = output(await gate.wait(id))
    expect(hook.permissionDecision).toBe('deny')
    expect(String(hook.permissionDecisionReason)).toMatch(/rejected.*Do not retry/)
    expect(db.listDecisions()[0]?.outcome).toBe('rejected')
  })

  it('keeps answering the same way when the hook asks again', async () => {
    const { gate } = setup()
    const id = pendingId(gate.submit(slackHook()))
    gate.decide(id, 'approved')
    expect(output(await gate.wait(id)).permissionDecision).toBe('allow')
    expect(output(await gate.wait(id)).permissionDecision).toBe('allow')
  })

  it('returns pending again when nobody decides within one hold', async () => {
    const { gate } = setup({ holdMs: 5 })
    const id = pendingId(gate.submit(slackHook()))
    expect(await gate.wait(id)).toEqual({ state: 'pending', id })
  })

  it('refuses edits for a call without editable text', () => {
    const { gate } = setup()
    const id = pendingId(
      gate.submit({
        ...slackHook(),
        hook: {
          hook_event_name: 'PreToolUse',
          tool_name: 'mcp__claude_ai_ClickUp__clickup_delete_task',
          tool_input: { task_id: '86a', list_id: '901' },
          tool_use_id: 'toolu_2'
        }
      })
    )
    expect(() => gate.decide(id, 'edited', 'x')).toThrow(/no editable text/)
  })

  it('denies an unknown id and anything that is not a gate draft', async () => {
    const { gate, db } = setup()
    expect(output(await gate.wait('nope')).permissionDecision).toBe('deny')
    const { record } = db.addDraft({ kind: 'message', body: 'from an agent', source: 'agent' })
    expect(output(await gate.wait(record.id)).permissionDecision).toBe('deny')
    expect(() => gate.decide(record.id, 'approved')).toThrow(/not a held call/)
  })

  it('abandons a pending call whose hook stopped polling, and only that one', async () => {
    const { gate, db, advance } = setup({ abandonAfterMs: 120_000, holdMs: 1 })
    const stale = pendingId(gate.submit(slackHook('toolu_old')))
    for (let step = 0; step < 4; step += 1) {
      advance(30_000)
      expect(gate.sweepAbandoned()).toBe(0)
    }
    const live = pendingId(gate.submit(slackHook('toolu_new')))
    advance(30_000)
    expect(gate.sweepAbandoned()).toBe(1)
    expect(db.getDraft(stale)?.status).toBe('rejected')
    expect(db.getDraft(live)?.status).toBe('pending')
    expect(db.listDecisions()).toEqual([])
    const hook = output(await gate.wait(stale))
    expect(String(hook.permissionDecisionReason)).toMatch(/stopped asking/)
    expect(String(hook.permissionDecisionReason)).not.toMatch(/rejected/)
  })

  it('keeps every card through a machine sleep, when hooks were frozen too', () => {
    const { gate, db, advance } = setup({ abandonAfterMs: 120_000, holdMs: 1 })
    const held = pendingId(gate.submit(slackHook('toolu_sleep')))
    advance(30_000)
    expect(gate.sweepAbandoned()).toBe(0)
    advance(16 * 60_000)
    expect(gate.sweepAbandoned()).toBe(0)
    expect(db.getDraft(held)?.status).toBe('pending')
    advance(30_000)
    expect(gate.sweepAbandoned()).toBe(0)
    expect(db.getDraft(held)?.status).toBe('pending')
  })
})
