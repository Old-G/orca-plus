import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { PulseDb } from '../../../orca-plus/pulse/pulse-db'
import { RuntimePulseCommands } from '../../runtime-pulse-commands'
import { RpcDispatcher } from '../dispatcher'
import { PULSE_METHODS } from './pulse'

const open: PulseDb[] = []

function setup() {
  const commands = new RuntimePulseCommands(() => {
    const db = new PulseDb(':memory:')
    open.push(db)
    return db
  })
  const host = {
    getRuntimeId: () => 'runtime-test',
    getSubscriptionRegistrationVersion: () => 0,
    pulseSnapshot: () => commands.pulseSnapshot(),
    pulseEvents: (afterSeq?: number, limit?: number) => commands.pulseEvents(afterSeq, limit),
    pulseUpsertPerson: commands.pulseUpsertPerson.bind(commands),
    pulseListPeople: commands.pulseListPeople.bind(commands),
    pulseAddWaiting: commands.pulseAddWaiting.bind(commands),
    pulseCloseWaiting: commands.pulseCloseWaiting.bind(commands),
    pulseListWaitings: commands.pulseListWaitings.bind(commands),
    pulseAddDraft: commands.pulseAddDraft.bind(commands),
    pulseListDrafts: commands.pulseListDrafts.bind(commands),
    pulseLogDecision: commands.pulseLogDecision.bind(commands),
    pulseListDecisions: commands.pulseListDecisions.bind(commands),
    pulseAddInboxItem: commands.pulseAddInboxItem.bind(commands),
    pulseListInbox: commands.pulseListInbox.bind(commands),
    pulseMarkInboxRead: commands.pulseMarkInboxRead.bind(commands),
    pulseMarkInboxDone: commands.pulseMarkInboxDone.bind(commands)
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the dispatcher reads only the two ids above and PULSE_METHODS only the pulse* methods listed.
  const runtime = host as unknown as OrcaRuntimeService
  const dispatcher = new RpcDispatcher({ runtime, methods: PULSE_METHODS })
  const call = async (method: string, params?: unknown) => {
    const response = await dispatcher.dispatch({ id: randomUUID(), authToken: '', method, params })
    if (!response.ok) {
      throw new Error(`${response.error.code}: ${response.error.message}`)
    }
    return response.result
  }
  return { call, dispatcher }
}

afterEach(() => {
  for (const db of open.splice(0)) {
    db.close()
  }
})

describe('pulse RPC methods', () => {
  it('records a waiting and shows it in the snapshot and the event feed', async () => {
    const { call } = setup()
    const person = await call('pulse.upsertPerson', { name: 'Ann', slackUserId: 'U1' })
    const waiting = await call('pulse.addWaiting', {
      direction: 'on-them',
      title: 'Contract',
      personId: Reflect.get(Object(person), 'id'),
      source: 'agent'
    })
    const snapshot = await call('pulse.snapshot')
    expect(snapshot).toMatchObject({
      people: [{ name: 'Ann' }],
      waitings: [{ title: 'Contract', status: 'open' }],
      latestSeq: 2
    })
    await call('pulse.closeWaiting', {
      id: Reflect.get(Object(waiting), 'id'),
      status: 'resolved',
      resolution: 'signed'
    })
    const feed = await call('pulse.events', { afterSeq: 2 })
    expect(feed).toMatchObject({ events: [{ kind: 'waiting.resolved' }], latestSeq: 3 })
    expect(await call('pulse.listWaitings', { status: 'open' })).toEqual([])
  })

  it('dedupes drafts and inbox items through the RPC as well', async () => {
    const { call } = setup()
    const draft = { kind: 'message', body: 'Any news?', source: 'agent', fingerprint: 'f1' }
    expect(await call('pulse.addDraft', draft)).toMatchObject({ created: true })
    expect(await call('pulse.addDraft', draft)).toMatchObject({ created: false })
    expect(await call('pulse.listDrafts', { status: 'pending' })).toHaveLength(1)
    const item = { kind: 'limit', title: 'A at 90%', dedupeKey: 'limit:A' }
    const added = await call('pulse.addInboxItem', item)
    expect(await call('pulse.addInboxItem', item)).toMatchObject({ created: false })
    const id = Reflect.get(Object(Reflect.get(Object(added), 'record')), 'id')
    await call('pulse.markInboxDone', { id, action: 'switch' })
    expect(await call('pulse.listInbox')).toEqual([])
  })

  it('logs and lists decisions', async () => {
    const { call } = setup()
    await call('pulse.logDecision', { title: 'Ship Monday', source: 'agent' })
    expect(await call('pulse.listDecisions', { limit: 5 })).toMatchObject([
      { kind: 'decision', title: 'Ship Monday' }
    ])
  })

  it('rejects bad params before they reach the database', async () => {
    const { call } = setup()
    await expect(call('pulse.addWaiting', { direction: 'sideways', title: 'x' })).rejects.toThrow()
    await expect(call('pulse.addDraft', { kind: 'message', source: 'agent' })).rejects.toThrow(
      /Draft body is required/
    )
  })

  it('refuses a forged approval card, which only the outgoing gate may raise', async () => {
    const { call } = setup()
    await expect(
      call('pulse.addInboxItem', {
        kind: 'outgoing-approval',
        title: 'Approve an outgoing action',
        body: 'Slack · send message\nhi',
        refKind: 'draft',
        refId: 'real-draft-with-other-text'
      })
    ).rejects.toThrow(/only from the outgoing gate/)
    expect(await call('pulse.listInbox')).toEqual([])
  })

  it('offers no way to approve a draft or report its delivery', async () => {
    const { dispatcher } = setup()
    for (const method of ['pulse.decideDraft', 'pulse.markDraftDelivery']) {
      const response = await dispatcher.dispatch({ id: randomUUID(), authToken: '', method })
      expect(response.ok).toBe(false)
    }
    expect(PULSE_METHODS.map((m) => m.name).filter((n) => /decide|deliver/i.test(n))).toEqual([])
  })
})
