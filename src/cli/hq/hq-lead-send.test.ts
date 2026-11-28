// Custom build (hq-lead-of A1, chat-send-live A2): the CLI side of `orca hq lead` and `orca chat send`.
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HandlerContext } from '../dispatch/dispatch'
import type { RuntimeClient } from '../runtime/client'
import { HQ_HANDLERS } from './hq'
import { formatHqLead } from '../hq-lead-format'

type Calls = { method: string; params: unknown }[]

const LEAD = {
  plan: '2026-11-28-refunds.md',
  address: 'hq/lead-refunds-2',
  sessionId: '22222222-2222-4222-8222-222222222222',
  open: true
}

function run(command: string, flags: Record<string, string | boolean>, reply: unknown) {
  const calls: Calls = []
  const printed: string[] = []
  vi.spyOn(console, 'log').mockImplementation((line: unknown) => {
    printed.push(String(line))
  })
  const call = vi.fn(async (method: string, params?: unknown) => {
    calls.push({ method, params })
    return { id: 'r', ok: true, result: reply }
  })
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handlers only use client.call.
  const client = { call } as unknown as RuntimeClient
  const ctx: HandlerContext = {
    flags: new Map(Object.entries(flags)),
    client,
    cwd: '/tmp',
    json: false,
    rawArgs: []
  }
  return { done: HQ_HANDLERS[command](ctx), calls, printed }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('orca chat send', () => {
  const sent = {
    entry: { id: 'j1', address: 'acme-api/w-refund-cap' },
    sessionId: 's1',
    reopened: false
  }

  it('asks for an open chat only, and brings a closed one back on --revive', async () => {
    const plain = run('chat send', { address: 'lead', text: 'DONE · T1' }, sent)
    await plain.done
    expect(plain.calls[0]).toMatchObject({
      method: 'chat.send',
      params: { address: 'lead', text: 'DONE · T1', onClosed: 'refuse' }
    })
    vi.restoreAllMocks()
    const revive = run('chat send', { address: 'acme-api/w-x', text: 'Go on', revive: true }, sent)
    await revive.done
    expect(revive.calls[0]?.params).toMatchObject({ onClosed: 'revive' })
  })
})

describe('orca hq lead', () => {
  it('asks for the Lead of the caller plan or of --plan, and prints it', async () => {
    const { done, calls, printed } = run('hq lead', { plan: '2026-11-28-refunds' }, LEAD)
    await done
    expect(calls[0]).toMatchObject({ method: 'hq.lead', params: { plan: '2026-11-28-refunds' } })
    expect(printed.join('\n')).toContain(
      'Lead of 2026-11-28-refunds.md: hq/lead-refunds-2 (22222222-2222-4222-8222-222222222222) — open'
    )
  })

  it('says a closed Lead refuses sends, and names the chat a handoff moved from', () => {
    const text = formatHqLead({ ...LEAD, open: false, handedOffFrom: 'old-session' })
    expect(text).toContain('— closed')
    expect(text).toContain('The plan names old-session; it handed off to this chat.')
    expect(text).toContain('--revive')
    expect(formatHqLead({ ...LEAD, address: null, open: null })).toBe(
      `Lead of 2026-11-28-refunds.md: ${LEAD.sessionId}\nSend to it: orca chat send lead "…"`
    )
  })
})
