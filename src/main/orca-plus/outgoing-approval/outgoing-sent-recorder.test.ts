import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runProcess } from '@orca/process-host'
import { AgentHookServer } from '../../agent-hooks/server'
import { PulseDb } from '../pulse/pulse-db'
import { OutgoingApprovalGate } from './outgoing-approval-gate'
import { createOutgoingGateRequestHandler, type OutgoingSentReport } from './outgoing-gate-http'
import { buildOutgoingSentScript } from './outgoing-sent-hook-script'
import { recordOutgoingSent } from './outgoing-sent-recorder'

const posix = process.platform !== 'win32'
const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0).toReversed()) {
    cleanup()
  }
})

type Case = { case: string; payload: Record<string, unknown> }
const CASES = new Map(
  readFileSync(join(__dirname, '__fixtures__', 'outgoing-sent-hooks.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Case)
    .map((entry) => [entry.case, entry.payload] as const)
)
const payload = (name: string): Record<string, unknown> => CASES.get(name)!

function openDb(): PulseDb {
  const db = new PulseDb(':memory:')
  cleanups.push(() => db.close())
  return db
}

function deps(db: PulseDb) {
  return {
    db: () => db,
    repoOfCwd: async () => 'acme/app',
    projectOf: async ({ sessionId }: { sessionId: string | null }) =>
      sessionId === 'orca-session-ann' ? 'app' : null,
    now: () => 1_792_000_000_000
  }
}

describe('recordOutgoingSent', () => {
  it('records what a finished call sent as the sending chat’s message in its project', async () => {
    const db = openDb()
    const report = { hook: payload('slack-dm-by-user-id'), agentSessionId: 'orca-session-ann' }
    expect(await recordOutgoingSent(deps(db), report)).toBe(true)
    expect(db.listLedgerConversations()).toMatchObject([
      { key: 'slack:D0ANN00002:1792614868.867139', sessionId: 'orca-session-ann', project: 'app' }
    ])
  })

  it('records nothing for a failed call, a held-back call or a read', async () => {
    const db = openDb()
    for (const name of [
      'clickup-failure-event',
      'clickup-blocked-by-a-hook',
      'a-read-is-not-a-send',
      'glab-mr-note-unique-skipped'
    ]) {
      expect(
        await recordOutgoingSent(deps(db), { hook: payload(name), agentSessionId: null })
      ).toBe(false)
    }
    expect(db.listLedgerConversations()).toEqual([])
  })
})

describe('the /outgoing-gate/sent answer', () => {
  async function startWith(sent: (report: OutgoingSentReport) => Promise<void>, waitMs?: number) {
    // Why: the clock stands just after the fixture's Slack ts, inside the pairing window.
    const db = new PulseDb(':memory:', { now: () => 1_792_614_900_000 })
    cleanups.push(() => db.close())
    const gate = new OutgoingApprovalGate({ db: () => db })
    const server = new AgentHookServer()
    server.setOutgoingGateHandler(createOutgoingGateRequestHandler(() => gate, sent, waitMs))
    await server.start({ env: 'production' })
    cleanups.push(() => server.stop())
    const env = server.buildPtyEnv()
    const post = (body: unknown) =>
      fetch(`http://127.0.0.1:${env.ORCA_AGENT_HOOK_PORT}/outgoing-gate/sent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Orca-Agent-Hook-Token': env.ORCA_AGENT_HOOK_TOKEN,
          'X-Orca-Agent-Session-Id': 'orca-session-ann'
        },
        body: JSON.stringify(body)
      }).then((response) => response.text())
    return { db, post }
  }

  it('comes once the send is in the ledger, so the waiting added next pairs with it', async () => {
    let db: PulseDb | null = null
    const started = await startWith(async (report) => {
      // Why: the project lookup is the slow part; the answer must wait for it.
      await new Promise((resolve) => setTimeout(resolve, 80))
      await recordOutgoingSent(deps(db!), report)
    })
    db = started.db
    expect(await started.post(payload('slack-dm-by-user-id'))).toBe('ok\n')
    const waiting = db.addWaiting({
      direction: 'on-them',
      title: 'Ann: Q3 file',
      source: 'slack',
      agentSessionId: 'orca-session-ann'
    })
    expect(db.getWaitingRecord(waiting.id)).toMatchObject({
      sent_text: 'Ann, can you share the Q3 file?',
      source_ref: 'slack:D0ANN00002:1792614868.867139'
    })
  })

  it('never holds the agent past its short wait, nor fails it', async () => {
    const hung = await startWith(() => new Promise<void>(() => {}), 50)
    expect(await hung.post(payload('slack-dm-by-user-id'))).toBe('ok\n')
    const failing = await startWith(() => Promise.reject(new Error('db locked')))
    expect(await failing.post(payload('slack-dm-by-user-id'))).toBe('ok\n')
  })
})

describe.skipIf(!posix)('the sent-message hook', () => {
  async function start() {
    const db = openDb()
    const reports: OutgoingSentReport[] = []
    const gate = new OutgoingApprovalGate({ db: () => db })
    const server = new AgentHookServer()
    server.setOutgoingGateHandler(
      createOutgoingGateRequestHandler(
        () => gate,
        async (report) => {
          reports.push(report)
          await recordOutgoingSent(deps(db), report)
        }
      )
    )
    await server.start({ env: 'production' })
    cleanups.push(() => server.stop())
    const dir = mkdtempSync(join(tmpdir(), 'orca-sent-test-'))
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
    const script = join(dir, 'outgoing-sent.sh')
    writeFileSync(script, buildOutgoingSentScript())
    const run = (input: unknown, env: Record<string, string>) =>
      runProcess({
        program: '/bin/sh',
        args: [script],
        input: JSON.stringify(input),
        env: { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: tmpdir(), ...env },
        timeoutMs: 20_000
      })
    return { db, reports, env: server.buildPtyEnv(), run }
  }

  async function settle(check: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100 && !check(); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  it('posts a finished send with its chat and the ledger takes it', async () => {
    const { db, reports, env, run } = await start()
    const result = await run(payload('slack-thread-reply'), {
      ...env,
      ORCA_AGENT_SESSION_ID: 'orca-session-ann'
    })
    expect(result.code).toBe(0)
    expect(result.stdout).toBe('')
    await settle(() => db.listLedgerConversations().length > 0)
    expect(reports).toHaveLength(1)
    expect(reports[0].agentSessionId).toBe('orca-session-ann')
    expect(db.listLedgerConversations()[0]).toMatchObject({
      key: 'slack:C0ACME0001:1792591322.829169',
      sessionId: 'orca-session-ann'
    })
  })

  it('stays out of the way of other tools and of a machine without Orca+', async () => {
    const { reports, env, run } = await start()
    const read = await run(
      { ...payload('slack-thread-reply'), tool_name: 'Read', tool_input: { file_path: '/x' } },
      env
    )
    const bash = await run(
      { ...payload('glab-mr-note'), tool_input: { command: 'ls' }, tool_response: { stdout: '' } },
      env
    )
    const away = await run(payload('slack-thread-reply'), {})
    for (const result of [read, bash, away]) {
      expect(result.code).toBe(0)
      expect(result.stdout).toBe('')
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(reports).toEqual([])
  })
})
